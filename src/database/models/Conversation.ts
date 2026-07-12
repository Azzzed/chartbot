import mongoose, { Document, Schema } from 'mongoose'

// ─── Sub-documento: mensaje individual ────────────────────────────────────────
export interface IMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

const MessageSchema = new Schema<IMessage>(
  {
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
  },
  { _id: false }
)

// ─── Documento principal: conversación por usuario en un chat ─────────────────
export interface IConversation extends Document {
  chatId: string
  userId: string
  userName: string
  // Ventana de contexto activa — se pasa a Llama en cada request
  // Se borra con "!bot olvida" para reiniciar el contexto
  contextWindow: IMessage[]
  // Historial permanente — nunca se borra, disponible para consultas históricas
  history: IMessage[]
  lastActivity: Date
}

const ConversationSchema = new Schema<IConversation>(
  {
    chatId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    userName: { type: String, default: 'Usuario' },
    contextWindow: { type: [MessageSchema], default: [] },
    history: { type: [MessageSchema], default: [] },
    lastActivity: { type: Date, default: Date.now },
  },
  { timestamps: true }
)

ConversationSchema.index({ chatId: 1, userId: 1 }, { unique: true })

export const Conversation = mongoose.model<IConversation>(
  'Conversation',
  ConversationSchema
)
