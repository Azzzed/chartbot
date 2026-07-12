import Groq from 'groq-sdk'
import { config } from '../config/config'
import { ConversationMessage } from '../types'
import { IStructuredData } from '../database/models/PdfRecord'
import { logger } from '../utils/logger'

const client = new Groq({ apiKey: config.groq.apiKey })

const SYSTEM_PROMPT = `Eres un asistente de gestión empresarial inteligente integrado en un grupo de trabajo de WhatsApp.

Tu nombre es ChatBot Empresarial. Tu rol es:
- Responder preguntas del equipo sobre tareas, proyectos y procesos internos
- Analizar documentos (PDFs, Excel, Word) que el equipo comparte en el grupo
- Ayudar a organizar información, generar reportes y resumir datos
- Mantener un tono profesional pero amigable
- Responder siempre en español, de forma clara y concisa
- Cuando analices documentos, extrae los datos más relevantes para la gestión

Restricciones:
- No compartas información confidencial con personas fuera del grupo
- Si no sabes algo, dilo claramente en lugar de inventar
- Prioriza respuestas accionables y concretas`

// ─── Retry con backoff ───────────────────────────────────────────────────────
async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

const RETRYABLE_CODES = new Set([429, 500, 502, 503, 504])

async function createChatCompletion(
  model: string,
  messages: Array<{ role: string; content: string }>,
  max_tokens: number,
  temperature: number,
  retries = 3,
): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      const completion = await client.chat.completions.create({
        model,
        messages: messages as any,
        max_tokens,
        temperature,
      } as any)

      const response = completion as { choices?: Array<{ message?: { content?: string | null } }> }
      return response.choices?.[0]?.message?.content ?? 'No pude generar una respuesta.'
    } catch (err: any) {
      const status = err?.status ?? err?.statusCode ?? 0
      if (RETRYABLE_CODES.has(status) && attempt < retries) {
        const delay = Math.min(1000 * 2 ** attempt + Math.random() * 1000, 10_000)
        logger.warn({ status, attempt: attempt + 1, retries, delay }, 'Reintentando llamada a Cerebras API')
        await sleep(delay)
        continue
      }
      throw err
    }
  }
}

export async function askLlama(
  userMessage: string,
  history: ConversationMessage[] = []
): Promise<string> {
  try {
    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history.slice(-6).map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      { role: 'user', content: userMessage },
    ]

    return await createChatCompletion(config.groq.model, messages, 1024, 0.7)
  } catch (err) {
    logger.error({ err }, 'Error llamando a Cerebras API')
    return '⚠️ Ocurrió un error al procesar tu mensaje. Intenta de nuevo.'
  }
}

/**
 * Parsea una fecha en múltiples formatos comunes en Latinoamérica.
 * Soporta: YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY, "DD de MES de YYYY"
 */
function parseFlexibleDate(dateStr: string): Date | undefined {
  if (!dateStr) return undefined

  // YYYY-MM-DD (ISO)
  const isoMatch = dateStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (isoMatch) {
    const d = new Date(parseInt(isoMatch[1]), parseInt(isoMatch[2]) - 1, parseInt(isoMatch[3]))
    return isNaN(d.getTime()) ? undefined : d
  }

  // DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY
  const localMatch = dateStr.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/)
  if (localMatch) {
    const d = new Date(parseInt(localMatch[3]), parseInt(localMatch[2]) - 1, parseInt(localMatch[1]))
    return isNaN(d.getTime()) ? undefined : d
  }

  // "DD de MES de YYYY" — español
  const esMatch = dateStr.match(/^(\d{1,2})\s+de\s+([a-záéíóú]+)(?:\s+de\s+(\d{4}))?$/i)
  if (esMatch) {
    const MONTHS_ES: Record<string, number> = {
      enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
      julio: 6, agosto: 7, septiembre: 8, octubre: 9, noviembre: 10, diciembre: 11,
    }
    const month = MONTHS_ES[esMatch[2].toLowerCase()]
    if (month === undefined) return undefined
    const day = parseInt(esMatch[1])
    const year = esMatch[3] ? parseInt(esMatch[3]) : new Date().getFullYear()
    const d = new Date(year, month, day)
    return isNaN(d.getTime()) ? undefined : d
  }

  return undefined
}

// ─── Extracción de datos estructurados de un documento ───────────────────────
export async function extractStructuredData(
  extractedText: string,
  fileName: string
): Promise<IStructuredData> {
  const prompt = `Analiza el siguiente documento financiero/empresarial y extrae los datos estructurados.
Responde ÚNICAMENTE con un objeto JSON válido con estos campos (usa null si no encuentras el dato):

{
  "proveedor": "nombre del proveedor o empresa emisora",
  "monto": número total (solo el número, sin símbolos),
  "moneda": "COP|USD|EUR|otro",
  "fechaPago": "YYYY-MM-DD (fecha del pago o del documento)",
  "tipoPago": "transferencia|efectivo|cheque|tarjeta|otro",
  "numeroDocumento": "número de factura, orden de pago, o referencia",
  "concepto": "descripción breve del servicio o producto pagado",
  "banco": "nombre del banco si aparece"
}

Nombre del archivo: ${fileName}

Documento:
${extractedText.slice(0, 6000)}`

  try {
    const raw = await createChatCompletion(config.groq.model, [{ role: 'user', content: prompt }], 512, 0.1)

    // Extraer el JSON de la respuesta (Llama a veces añade texto alrededor)
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return {}

    const parsed = JSON.parse(jsonMatch[0])

    // Convertir fechaPago a Date si existe (soporta múltiples formatos)
    if (parsed.fechaPago && typeof parsed.fechaPago === 'string') {
      parsed.fechaPago = parseFlexibleDate(parsed.fechaPago)
    }

    // Limpiar nulls (los strings vacíos se conservan)
    Object.keys(parsed).forEach((k) => {
      if (parsed[k] === null) delete parsed[k]
    })

    logger.info({ structured: parsed, fileName }, '🏗️  Datos estructurados extraídos')
    return parsed as IStructuredData

  } catch (err) {
    logger.warn({ err, fileName }, 'No se pudieron extraer datos estructurados')
    return {}
  }
}
