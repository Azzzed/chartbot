import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} from 'baileys'
import { Boom } from '@hapi/boom'
import path from 'path'
import fs from 'fs'
import dotenv from 'dotenv'
import { logger } from '../utils/logger'

dotenv.config()

const SESSION_NAME = process.env.WA_SESSION_NAME ?? 'chat-empresarial-session'
const AUTH_FOLDER = path.join(process.cwd(), 'auth_info', SESSION_NAME)

async function logout() {
  console.log('')
  console.log('╔══════════════════════════════════════════════╗')
  console.log('║   Cierre de Sesión — Chat Empresarial       ║')
  console.log('╚══════════════════════════════════════════════╝')
  console.log('')

  if (!fs.existsSync(AUTH_FOLDER)) {
    console.log('✅ No hay ninguna sesión activa para cerrar.')
    console.log('📱 El bot mostrará un QR directamente en el próximo inicio.')
    process.exit(0)
  }

  console.log(`📁 Sesión encontrada: ${SESSION_NAME}`)
  console.log('🔌 Intentando cerrar sesión en WhatsApp...')

  let sessionClosed = false

  try {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER)
    const { version } = await fetchLatestBaileysVersion()

    if (!state.creds?.registered) {
      console.log('⚠️  La sesión guardada no está registrada. Eliminando archivos...')
      sessionClosed = true
    } else {
      const sock = makeWASocket({
        version,
        auth: state,
        logger: logger.child({ module: 'logout' }) as any,
        connectTimeoutMs: 15_000,
        defaultQueryTimeoutMs: 10_000,
        markOnlineOnConnect: false,
        syncFullHistory: false,
      })

      sock.ev.on('creds.update', saveCreds)

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          sock.ev.removeAllListeners('connection.update')
          reject(new Error('Timeout de conexión'))
        }, 15_000)

        sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
          if (connection === 'open') {
            clearTimeout(timeout)
            resolve()
          }
          if (connection === 'close') {
            clearTimeout(timeout)
            const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode
            if (statusCode === DisconnectReason.loggedOut) {
              resolve() // Ya está desconectado
            } else {
              reject(new Error(`Conexión cerrada inesperadamente (código: ${statusCode})`))
            }
          }
        })
      })

      console.log('✅ Conectado. Enviando comando de cierre a WhatsApp...')
      await sock.logout()
      sessionClosed = true

      await new Promise((r) => setTimeout(r, 1000))
      sock.ws.close()
      sock.end(undefined)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.log(`⚠️  No se pudo cerrar sesión remotamente: ${msg}`)
    console.log('   Los archivos locales serán eliminados igualmente.')
    sessionClosed = true
  }

  if (fs.existsSync(AUTH_FOLDER)) {
    console.log('🗑️  Eliminando archivos de sesión...')
    fs.rmSync(AUTH_FOLDER, { recursive: true, force: true })

    const parentDir = path.dirname(AUTH_FOLDER)
    if (fs.existsSync(parentDir) && fs.readdirSync(parentDir).length === 0) {
      fs.rmdirSync(parentDir)
    }
  }

  console.log('')
  if (sessionClosed) {
    console.log('✅ Sesión cerrada exitosamente.')
  } else {
    console.log('✅ Archivos de sesión eliminados.')
  }
  console.log('📱 En el próximo inicio, el bot generará un QR nuevo.')
  console.log('')
  process.exit(0)
}

logout()
