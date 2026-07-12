import { proto } from 'baileys'
import { config } from '../config/config'
import { IncomingMessage, MessageType } from '../types'

function getContextInfo(msg: proto.IWebMessageInfo): proto.IContextInfo | null {
  const m = msg.message
  if (!m) return null

  return (
    m.extendedTextMessage?.contextInfo ??
    m.documentMessage?.contextInfo ??
    m.imageMessage?.contextInfo ??
    m.videoMessage?.contextInfo ??
    m.documentWithCaptionMessage?.message?.documentMessage?.contextInfo ??
    null
  )
}

export function parseMessage(
  msg: proto.IWebMessageInfo,
  botJid: string
): IncomingMessage | null {
  if (!msg.message) return null

  const from = msg.key.remoteJid ?? ''
  const isGroup = from.endsWith('@g.us')
  const groupId = isGroup ? from : undefined
  const senderId = isGroup
    ? (msg.key.participant ?? '')
    : from

  const body =
    msg.message.conversation ??
    msg.message.extendedTextMessage?.text ??
    msg.message.imageMessage?.caption ??
    msg.message.documentMessage?.caption ??
    msg.message.documentWithCaptionMessage?.message?.documentMessage?.caption ??
    ''

  const type = detectMessageType(msg)

  // Las respuestas del bot (fromMe=true) se filtran para evitar loops,
  // excepto en self-chat (chat 1:1 con el propio número).
  if (msg.key.fromMe && (isGroup || from !== botJid)) return null

  const contextInfo = getContextInfo(msg)
  const mentionedJids = contextInfo?.mentionedJid ?? []
  const isMentioned = mentionedJids.includes(botJid)
  const isReplyToBot =
    contextInfo?.stanzaId != null &&
    contextInfo?.participant?.split('@')[0] === botJid.split('@')[0]
  const isCommand = body.trim().toLowerCase().startsWith(config.whatsapp.botPrefix.toLowerCase())

  // Archivos (PDF, Excel, Word, imagen) siempre se procesan aunque no tengan !bot
  const isFile = type === 'pdf' || type === 'excel' || type === 'word' || type === 'image'
  if (!isCommand && !isMentioned && !isReplyToBot && !isFile) return null

  const senderName =
    (msg.pushName ?? senderId.split('@')[0] ?? 'Usuario')

  const content = isCommand
    ? body.slice(config.whatsapp.botPrefix.length).trim()
    : body.trim()

  return {
    id: msg.key.id ?? '',
    from: senderId,
    groupId,
    senderName,
    content,
    type,
    timestamp: (msg.messageTimestamp as number) ?? Date.now(),
    isGroup,
    isMentioned,
    isCommand,
    rawMessage: msg,
  }
}

function detectMessageType(msg: proto.IWebMessageInfo): MessageType {
  const m = msg.message
  if (!m) return 'unknown'

  if (m.conversation || m.extendedTextMessage) return 'text'

  if (m.imageMessage) return 'image'

  if (m.documentMessage) {
    return getMimeType(m.documentMessage.mimetype ?? '')
  }

  if (m.documentWithCaptionMessage?.message?.documentMessage) {
    return getMimeType(m.documentWithCaptionMessage.message.documentMessage.mimetype ?? '')
  }

  if (m.audioMessage) return 'audio'

  return 'unknown'
}

function getMimeType(mime: string): MessageType {
  if (mime.includes('pdf')) return 'pdf'
  if (mime.includes('spreadsheet') || mime.includes('excel') || mime.includes('csv')) return 'excel'
  if (mime.includes('word') || mime.includes('wordprocessingml')) return 'word'
  return 'unknown'
}
