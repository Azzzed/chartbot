import fs from 'fs'
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
} from 'baileys'
import { proto } from 'baileys'
import { Boom } from '@hapi/boom'
import path from 'path'
import qrcode from 'qrcode-terminal'
import { logger } from '../utils/logger'
import { config } from '../config/config'

const AUTH_FOLDER = path.join(process.cwd(), 'auth_info', config.whatsapp.sessionName)
const MAX_CONSECUTIVE_FAILURES = 3
const BASE_RECONNECT_DELAY = 5_000
const MAX_RECONNECT_DELAY = 60_000

let activeSock: ReturnType<typeof makeWASocket> | null = null
let isReconnecting = false
let consecutiveFailures = 0
let reconnectAttempts = 0
let onMessageCb: ((sock: ReturnType<typeof makeWASocket>, msg: proto.IWebMessageInfo) => Promise<void>) | null = null
let lastDataTimestamp = Date.now()
let healthCheckInterval: NodeJS.Timeout | null = null

function wipeSession(reason: string) {
  stopHealthCheck()
  logger.error({ reason }, '🗑️  Eliminando sesión corrupta')
  if (fs.existsSync(AUTH_FOLDER)) {
    fs.rmSync(AUTH_FOLDER, { recursive: true, force: true })
    logger.info('✅ Archivos de sesión eliminados. Se generará QR nuevo.')
  }
  consecutiveFailures = 0
  reconnectAttempts = 0
}

function startHealthCheck(sock: ReturnType<typeof makeWASocket>) {
  stopHealthCheck()
  lastDataTimestamp = Date.now()

  const ws = sock.ws as any
  if (ws) {
    ws.on('message', () => {
      lastDataTimestamp = Date.now()
    })
  }

  healthCheckInterval = setInterval(() => {
    const elapsed = Date.now() - lastDataTimestamp
    if (elapsed > 120_000 && ws && ws.readyState === 1) {
      logger.warn({ elapsed }, '⚠️ WebSocket sin datos por 2min — forzando reconexión')
      ws.close()
    }
  }, 20_000)
}

function stopHealthCheck() {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval)
    healthCheckInterval = null
  }
}

function registerMessageHandler(sock: ReturnType<typeof makeWASocket>) {
  if (!onMessageCb) return

  // Log ALL messages.upsert events (para diagnóstico)
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    logger.info({ count: messages.length, type, fromMe: messages[0]?.key?.fromMe, jid: messages[0]?.key?.remoteJid }, '📨 messages.upsert received')
    for (const msg of messages) {
      try {
        await onMessageCb!(sock, msg)
      } catch (err) {
        logger.error({ err }, 'Error en handler de mensaje')
      }
    }
  })
}

export function getActiveSock() {
  return activeSock
}

export async function createWASocket(
  onMessage?: (sock: ReturnType<typeof makeWASocket>, msg: proto.IWebMessageInfo) => Promise<void>
): Promise<ReturnType<typeof makeWASocket>> {
  if (onMessage) {
    onMessageCb = onMessage
  }

  if (activeSock && activeSock.user) {
    logger.info('♻️  Reutilizando socket existente')
    return activeSock
  }

  if (activeSock) {
    try {
      activeSock.ws.close()
      activeSock.end(undefined)
    } catch (_) {}
    activeSock = null
  }

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER)
  const { version } = await fetchLatestBaileysVersion()

  logger.info(`Baileys versión: ${version.join('.')}`)

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger as any),
    },
    logger: logger.child({ module: 'baileys' }) as any,
    markOnlineOnConnect: true,
    syncFullHistory: false,
    fireInitQueries: false,
    defaultQueryTimeoutMs: 30_000,
    connectTimeoutMs: 60_000,
    keepAliveIntervalMs: 15_000,
  })

  activeSock = sock
  sock.ev.on('creds.update', saveCreds)
  registerMessageHandler(sock)

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log('\n📱 Escanea este QR con WhatsApp para conectar:\n')
      qrcode.generate(qr, { small: true })
    }

    if (connection === 'open') {
      consecutiveFailures = 0
      reconnectAttempts = 0
      isReconnecting = false
      lastDataTimestamp = Date.now()
      startHealthCheck(sock)
      logger.info('✅ WhatsApp conectado correctamente')
    }

    if (connection === 'close') {
      stopHealthCheck()
      if (sock !== activeSock) {
        logger.info('⏭️  Evento de socket obsoleto ignorado')
        return
      }

      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode
      logger.warn({ statusCode, reconnectAttempts }, '⚠️ Conexión cerrada')

      // loggedOut -> siempre limpiar sesión
      if (statusCode === DisconnectReason.loggedOut) {
        wipeSession('Sesión cerrada desde el teléfono')
      } else if (statusCode && statusCode !== 408 && statusCode !== 500) {
        // Timeout (408) y error de servidor (500) NO cuentan para wipe
        consecutiveFailures++
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          wipeSession(`${consecutiveFailures} fallos consecutivos — posible sesión corrupta`)
        }
      }

      if (isReconnecting) {
        logger.warn('⏳ Ya hay una reconexión en curso, ignorando...')
        return
      }

      isReconnecting = true
      activeSock = null

      // Backoff exponencial: 5s → 10s → 20s → 40s → 60s (máx)
      reconnectAttempts++
      const delay = Math.min(
        BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttempts - 1),
        MAX_RECONNECT_DELAY
      )
      logger.info(`🔄 Reconectando en ${delay / 1000}s (intento #${reconnectAttempts})...`)

      setTimeout(async () => {
        try {
          // onMessageCb se re-registra automáticamente dentro de createWASocket
          await createWASocket()
        } catch (err) {
          logger.error({ err }, '❌ Error al reconectar')
        }
        isReconnecting = false
      }, delay)
    }
  })

  await waitForConnection(sock)

  return sock
}

function waitForConnection(sock: ReturnType<typeof makeWASocket>): Promise<void> {
  const CONNECTION_TIMEOUT = 60_000

  return new Promise<void>((resolve, reject) => {
    if (sock.user) {
      resolve()
      return
    }

    const timer = setTimeout(() => {
      sock.ev.off('connection.update', onUpdate)
      reject(new Error('Timeout: no se pudo conectar a WhatsApp'))
    }, CONNECTION_TIMEOUT)

    const onUpdate = ({ connection, lastDisconnect }: any) => {
      if (connection === 'open') {
        clearTimeout(timer)
        sock.ev.off('connection.update', onUpdate)
        resolve()
      }
      if (connection === 'close') {
        clearTimeout(timer)
        sock.ev.off('connection.update', onUpdate)
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode
        if (statusCode === DisconnectReason.loggedOut) {
          reject(new Error('Sesión cerrada por WhatsApp'))
        } else {
          resolve()
        }
      }
    }

    sock.ev.on('connection.update', onUpdate)
  })
}

export type WASocket = Awaited<ReturnType<typeof createWASocket>>
