// ─── Tipos de mensajes entrantes ──────────────────────────────────────────────

export type MessageType = 'text' | 'image' | 'pdf' | 'excel' | 'word' | 'audio' | 'unknown'

export interface IncomingMessage {
  id: string
  from: string          // JID del remitente
  groupId?: string      // JID del grupo (si aplica)
  senderName: string
  content: string       // Texto del mensaje
  type: MessageType
  filePath?: string     // Ruta local si hay archivo adjunto
  timestamp: number
  isGroup: boolean
  isMentioned: boolean  // Si el bot fue mencionado
  isCommand: boolean    // Si inicia con el prefijo del bot
  rawMessage: unknown
}

// ─── Tipos de conversación / historial ────────────────────────────────────────

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: Date
}

export interface Conversation {
  groupId: string
  userId: string
  history: ConversationMessage[]
  updatedAt: Date
}

// ─── Respuesta del bot ─────────────────────────────────────────────────────────

export interface BotResponse {
  text: string
  replyToId?: string
  mentions?: string[]
}
