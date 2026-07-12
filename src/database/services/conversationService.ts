import { Conversation, IMessage } from '../models/Conversation'
import { ConversationMessage } from '../../types'
import { logger } from '../../utils/logger'

// Máximo de mensajes en la ventana de contexto activa para Llama
const MAX_CONTEXT = 20

/**
 * Obtiene la ventana de contexto activa de un usuario.
 * Esto es lo que se pasa a Llama en cada request.
 */
export async function getHistory(
  chatId: string,
  userId: string
): Promise<ConversationMessage[]> {
  try {
    const conv = await Conversation.findOne({ chatId, userId })
      .select('contextWindow')
      .lean()

    if (!conv || conv.contextWindow.length === 0) return []

    return conv.contextWindow.slice(-MAX_CONTEXT).map((m) => ({
      role: m.role,
      content: m.content,
      timestamp: m.timestamp,
    }))
  } catch (err) {
    logger.error({ err, chatId, userId }, 'Error cargando contexto')
    return []
  }
}

/**
 * Guarda un par de mensajes (usuario + bot) en:
 * - contextWindow: ventana de contexto activa (limitada, se puede borrar)
 * - history: historial permanente (nunca se borra)
 */
export async function appendToHistory(
  chatId: string,
  userId: string,
  userName: string,
  userMessage: string,
  botResponse: string
): Promise<void> {
  try {
    const now = new Date()

    const newMessages: IMessage[] = [
      { role: 'user', content: userMessage, timestamp: now },
      { role: 'assistant', content: botResponse, timestamp: now },
    ]

    await Conversation.findOneAndUpdate(
      { chatId, userId },
      {
        $set: { userName, lastActivity: now },
        $push: {
          // Contexto activo: solo los últimos MAX_CONTEXT mensajes
          contextWindow: {
            $each: newMessages,
            $slice: -(MAX_CONTEXT),
          },
          // Historial permanente: acumula todo, sin límite de slice
          history: { $each: newMessages },
        },
      },
      { upsert: true, new: true }
    )
  } catch (err) {
    logger.error({ err, chatId, userId }, 'Error guardando en BD')
  }
}

/**
 * Borra SOLO la ventana de contexto activa.
 * El historial permanente se mantiene intacto en BD.
 */
export async function clearHistory(
  chatId: string,
  userId: string
): Promise<void> {
  try {
    await Conversation.findOneAndUpdate(
      { chatId, userId },
      { $set: { contextWindow: [], lastActivity: new Date() } }
    )
    logger.info({ chatId, userId }, '🧹 Contexto borrado (historial permanente intacto)')
  } catch (err) {
    logger.error({ err }, 'Error borrando contexto')
  }
}
