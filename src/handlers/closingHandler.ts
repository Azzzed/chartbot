import fs from 'fs'
import { WASocket } from '../whatsapp/socket'
import { IncomingMessage } from '../types'
import { askLlama } from '../ai/groq'
import { getPdfsOfToday } from '../database/services/pdfRecordService'
import { generateClosingExcel } from '../utils/excelGenerator'
import { cleanupFile } from '../utils/fileDownloader'
import { logger } from '../utils/logger'

// Frases que activan el cierre del día
const CLOSING_TRIGGERS = [
  'cierre del día', 'cierre del dia',
  'cierre de hoy', 'cierre diario',
  'resumen del día', 'resumen del dia',
  'resumen de hoy',
  'cierre',
]

/**
 * Detecta si el mensaje es un comando de cierre del día.
 */
export function isClosingCommand(content: string): boolean {
  const lower = content.toLowerCase().trim()
  return CLOSING_TRIGGERS.some((t) => lower.includes(t))
}

/**
 * Ejecuta el cierre del día: resumen de Llama + Excel + envío al grupo.
 */
export async function handleClosing(
  sock: WASocket,
  msg: IncomingMessage
): Promise<void> {
  const chatId = msg.groupId ?? msg.from

  logger.info({ chatId }, '📊 Iniciando cierre del día')

  // Aviso de inicio
  await sock.sendMessage(chatId, {
    text: '📊 Generando el cierre del día, un momento...',
  }, { quoted: msg.rawMessage as any })

  // Obtener PDFs del día
  const entries = await getPdfsOfToday(chatId)

  if (entries.length === 0) {
    await sock.sendMessage(chatId, {
      text: '📭 No se analizaron documentos hoy. No hay datos para generar el cierre.',
    }, { quoted: msg.rawMessage as any })
    return
  }

  const today = new Date().toLocaleDateString('es-CO', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })

  // ─── Generar resumen ejecutivo con Llama ─────────────────────────────────────
  const docsContext = entries.map((e, i) => {
    const s = e.structured ?? {}
    return [
      `Documento ${i + 1}: ${e.fileName}`,
      `  Enviado por: ${e.userName}`,
      `  Descripción: ${e.userQuery || '—'}`,
      s.proveedor       ? `  Proveedor: ${s.proveedor}` : '',
      s.monto           ? `  Monto: ${s.monto} ${s.moneda ?? ''}`.trim() : '',
      s.fechaPago       ? `  Fecha pago: ${new Date(s.fechaPago).toLocaleDateString('es-CO')}` : '',
      s.tipoPago        ? `  Tipo pago: ${s.tipoPago}` : '',
      s.numeroDocumento ? `  N° doc: ${s.numeroDocumento}` : '',
      s.concepto        ? `  Concepto: ${s.concepto}` : '',
      `  Resumen: ${e.summary.slice(0, 300)}`,
    ].filter(Boolean).join('\n')
  }).join('\n\n')

  const prompt = `Eres el asistente empresarial del grupo. Hoy es ${today}.
Se analizaron ${entries.length} documentos financieros/empresariales durante el día.

${docsContext}

Genera un RESUMEN EJECUTIVO DE CIERRE DEL DÍA con:
1. Total de documentos procesados
2. Listado de proveedores con sus montos (si aplica)
3. Monto total del día (suma de todos los pagos/facturas con monto conocido)
4. Observaciones relevantes o puntos de atención
5. Breve conclusión

Usa formato claro con emojis para facilitar la lectura en WhatsApp. Responde en español.`

  const summary = await askLlama(prompt)

  // ─── Generar Excel ────────────────────────────────────────────────────────────
  let excelPath: string | null = null
  try {
    excelPath = await generateClosingExcel(entries)
    logger.info({ excelPath }, '📁 Excel generado')
  } catch (err) {
    logger.error({ err }, 'Error generando Excel')
  }

  // ─── Enviar resumen de texto ──────────────────────────────────────────────────
  await sock.sendMessage(chatId, { text: summary }, { quoted: msg.rawMessage as any })

  // ─── Enviar Excel como archivo adjunto ───────────────────────────────────────
  if (excelPath && fs.existsSync(excelPath)) {
    const today_str = new Date().toISOString().slice(0, 10)
    const excelBuffer = fs.readFileSync(excelPath)

    await sock.sendMessage(chatId, {
      document: excelBuffer,
      mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileName: `Cierre_${today_str}.xlsx`,
      caption: `📎 Reporte detallado del ${today}`,
    })

    cleanupFile(excelPath)
    logger.info({ chatId }, '✅ Cierre del día enviado')
  }
}
