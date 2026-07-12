import { WASocket } from '../whatsapp/socket'
import { IncomingMessage } from '../types'
import { askLlama, extractStructuredData } from '../ai/groq'
import { downloadFile, cleanupFile } from '../utils/fileDownloader'
import { extractText } from '../utils/fileParser'
import { getHistory, appendToHistory, clearHistory } from '../database/services/conversationService'
import { savePdfRecord, searchHistorical, clearPdfRecords } from '../database/services/pdfRecordService'
import { detectIntent } from '../middleware/intentDetector'
import { isClosingCommand, handleClosing } from './closingHandler'
import { logger } from '../utils/logger'

const FILE_TYPES = ['pdf', 'excel', 'word', 'image'] as const

function getDocumentFileName(rawMsg: unknown): string | undefined {
  if (!rawMsg || typeof rawMsg !== 'object') return undefined
  const m = rawMsg as Record<string, unknown>
  const message = m.message as Record<string, unknown> | undefined
  if (!message) return undefined

  const docMsg = message.documentMessage as Record<string, unknown> | undefined
  if (docMsg?.fileName) return docMsg.fileName as string

  const docWithCaption = message.documentWithCaptionMessage as Record<string, unknown> | undefined
  const innerDoc = (docWithCaption?.message as Record<string, unknown> | undefined)?.documentMessage as Record<string, unknown> | undefined
  if (innerDoc?.fileName) return innerDoc.fileName as string

  const imgMsg = message.imageMessage as Record<string, unknown> | undefined
  if (imgMsg?.caption) return `imagen_${(imgMsg.caption as string).slice(0, 30)}`

  return undefined
}

export async function handleMessage(sock: WASocket, msg: IncomingMessage): Promise<void> {
  const chatId = msg.groupId ?? msg.from

  logger.info(
    { from: msg.senderName, type: msg.type, content: msg.content.slice(0, 80) },
    '💬 Procesando mensaje'
  )

  try {
    await sock.sendPresenceUpdate('composing', chatId)

    // ─── Comando: cierre del día ──────────────────────────────────────────────
    const contentLower = msg.content.toLowerCase().trim()
    if (isClosingCommand(contentLower)) {
      await handleClosing(sock, msg)
      return
    }

    // ─── Comando: borrar contexto ─────────────────────────────────────────────
    const FORGET_TRIGGERS = ['olvida', 'olvida todo', '!bot olvida', '!bot olvida todo']
    if (FORGET_TRIGGERS.some(t => contentLower.includes(t))) {
      await clearHistory(chatId, msg.from)
      await clearPdfRecords(chatId, msg.from)
      await sock.sendMessage(chatId, {
        text: '🧹 Listo, reinicié el contexto de la conversación y borré los archivos que habías compartido.',
      }, { quoted: msg.rawMessage as any })
      return
    }

    // ─── Cargar historial de contexto activo ──────────────────────────────────
    const history = await getHistory(chatId, msg.from)

    let prompt = `${msg.senderName} dice: ${msg.content || 'analiza este archivo'}`
    let pdfData: { extractedText: string; fileName: string } | null = null
    let historicalContext: string | null = null
    let receivedFile: { fileName: string; type: string } | null = null

    // ─── Comando: consulta histórica explícita ─────────────────────────────
    if (contentLower.startsWith('consulta ')) {
      const query = contentLower.slice('consulta '.length).trim()
      if (query) {
        logger.info({ query }, '🔍 Consulta histórica explícita')
        const intent = detectIntent(query)
        const searchQuery: import('../middleware/intentDetector').HistoricalQuery = intent.intent === 'historical'
          ? intent
          : { intent: 'historical', keywords: query.split(/\s+/).filter(w => w.length > 2), dateRange: undefined }
        const context = await searchHistorical(chatId, searchQuery)
        if (context) {
          historicalContext = context
        } else {
          await sock.sendMessage(chatId, {
            text: '🔍 No encontré registros que coincidan con tu búsqueda. Intenta con otros términos o un rango de fechas diferente.',
          }, { quoted: msg.rawMessage as any })
          return
        }
      }
    }

    // ─── Archivo adjunto: descargar, extraer y estructurar ────────────────────
    // NOTA: los archivos NUNCA activan consultas históricas, solo se analizan
    if (FILE_TYPES.includes(msg.type as typeof FILE_TYPES[number])) {
      const fileName =
        getDocumentFileName(msg.rawMessage) ??
        `archivo_${msg.type}_${Date.now()}`

      await sock.sendMessage(chatId, {
        text: `⏳ Descargando y analizando el archivo${msg.content ? '' : ', un momento...'}`,
      }, { quoted: msg.rawMessage as any })

      const filePath = await downloadFile(msg.rawMessage as any, sock.updateMediaMessage)
      if (!filePath) {
        await sock.sendMessage(chatId, {
          text: '⚠️ No pude descargar el archivo. Intenta enviarlo de nuevo.',
        }, { quoted: msg.rawMessage as any })
        return
      }

      if (msg.type === 'image') {
        // Imagen: no extraemos texto, usamos el caption
        const fileLabel = 'IMAGEN'
        receivedFile = { fileName, type: 'image' }
        prompt = `${msg.senderName} compartió una imagen${msg.content ? ` y dice: "${msg.content}"` : ''}`
        logger.info({ fileName }, `📷 ${fileLabel} recibida`)
        cleanupFile(filePath)
      } else {
        // Documento (PDF, Excel, Word): extraer texto
        const extractedText = await extractText(filePath, msg.type)

        cleanupFile(filePath)

        if (!extractedText) {
          await sock.sendMessage(chatId, {
            text: '⚠️ No pude extraer texto del archivo. ¿Es un PDF escaneado o imagen?',
          }, { quoted: msg.rawMessage as any })
          return
        }

        pdfData = { extractedText, fileName }
        receivedFile = { fileName, type: msg.type }
        const fileLabel = msg.type.toUpperCase()
        prompt = `${msg.senderName} compartió un archivo ${fileLabel} llamado "${fileName}" y pregunta: "${msg.content || 'analiza este archivo'}"\n\nContenido del archivo:\n\n${extractedText}`
        logger.info({ chars: extractedText.length, fileName }, `📄 ${fileLabel} extraído`)
      }
    }

    // ─── Detectar intención (solo mensajes de texto, NO archivos) ──────────
    if (!receivedFile && !historicalContext && msg.content) {
      const intent = detectIntent(msg.content)
      if (intent?.intent === 'historical') {
        logger.info({ keywords: intent.keywords, dateRange: intent.dateRange }, '🔍 Consulta histórica detectada')

        const context = await searchHistorical(chatId, intent)

        if (context) {
          historicalContext = context
        } else {
          await sock.sendMessage(chatId, {
            text: '🔍 No encontré registros que coincidan con tu búsqueda. Intenta con otros términos o un rango de fechas diferente.',
          }, { quoted: msg.rawMessage as any })
          return
        }
      }
    }

    // ─── Si no hay ni archivo ni consulta histórica ni contenido, salir ────
    if (!receivedFile && !historicalContext && !msg.content) {
      return
    }

    // ─── Agregar contexto histórico al prompt si existe ───────────────────────
    if (historicalContext) {
      const baseQuery = `${msg.senderName} hace una consulta histórica: "${msg.content}"`
      const recordsSection = `A continuación están los registros encontrados en la base de datos que pueden responder su pregunta:\n\n${historicalContext}\n\nResponde de forma clara y concisa basándote ÚNICAMENTE en los registros anteriores. Si la información exacta no está en los registros, indícalo.`

      if (pdfData) {
        prompt = `${baseQuery}\n\n${recordsSection}\n\nAdicionalmente, el usuario compartió un archivo:\n\n${prompt}`
      } else {
        prompt = `${baseQuery}\n\n${recordsSection}`
      }
    }

    // ─── Llamar a Llama ───────────────────────────────────────────────────────
    const response = await askLlama(prompt, history)

    // ─── Guardar en historial (SIN el contenido completo del archivo) ─────────
    // Se guarda solo la referencia al archivo, no el texto extraído completo
    const historyPrompt = receivedFile
      ? `${msg.senderName} compartió un archivo "${receivedFile.fileName}" y dijo: "${msg.content || 'analiza este archivo'}"`
      : prompt

    await appendToHistory(chatId, msg.from, msg.senderName, historyPrompt, response)

    // ─── Si fue un archivo extraíble: guardar registro estructurado ────────────
    if (pdfData) {
      const structured = await extractStructuredData(pdfData.extractedText, pdfData.fileName)
      await savePdfRecord({
        chatId,
        userId: msg.from,
        userName: msg.senderName,
        fileName: pdfData.fileName,
        extractedText: pdfData.extractedText,
        summary: response,
        userQuery: msg.content || 'analiza este archivo',
        structured,
      })
      logger.info({ fileName: pdfData.fileName }, '💾 Registro guardado en BD')
    }

    // ─── Responder en el chat ─────────────────────────────────────────────────
    await sock.sendMessage(chatId, {
      text: response,
      ...(msg.isGroup ? { mentions: [msg.from] } : {}),
    }, { quoted: msg.rawMessage as any })

    await sock.sendPresenceUpdate('paused', chatId)
    logger.info({ chatId }, '✅ Respuesta enviada')

  } catch (err) {
    logger.error({ err }, 'Error al manejar mensaje')
    await sock.sendMessage(chatId, {
      text: '⚠️ Ocurrió un error procesando tu mensaje. Intenta de nuevo.',
    }, { quoted: msg.rawMessage as any })
  }
}
