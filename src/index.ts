import { createWASocket, getActiveSock, WASocket } from './whatsapp/socket'
import { parseMessage } from './middleware/messageParser'
import { handleMessage } from './handlers/messageHandler'
import { connectDatabase } from './database/connection'
import { logger } from './utils/logger'
import { proto } from 'baileys'

async function onMessage(sock: WASocket, msg: proto.IWebMessageInfo) {
  const botJid = sock.user?.id ?? ''
  const parsed = parseMessage(msg, botJid)
  if (parsed) {
    await handleMessage(sock, parsed)
  }
}

async function main() {
  logger.info('🚀 Iniciando Chat Empresarial...')

  await connectDatabase()

  // createWASocket almacena internamente onMessage y lo re-registra
  // automáticamente en cada reconexión o restauración de sesión
  await createWASocket(onMessage)

  logger.info('✅ Bot listo para recibir mensajes')
}

process.on('SIGINT', () => {
  logger.info('👋 Cerrando conexiones...')
  getActiveSock()?.end(undefined)
  process.exit(0)
})

process.on('SIGTERM', () => {
  logger.info('👋 Cerrando conexiones...')
  getActiveSock()?.end(undefined)
  process.exit(0)
})

main().catch((err) => {
  logger.error({ err }, 'Error fatal')
  process.exit(1)
})
