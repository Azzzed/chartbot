import { PdfRecord, IStructuredData } from '../models/PdfRecord'
import { HistoricalQuery } from '../../middleware/intentDetector'
import { logger } from '../../utils/logger'

export async function clearPdfRecords(chatId: string, userId?: string): Promise<void> {
  try {
    const filter: Record<string, unknown> = { chatId }
    if (userId) filter.userId = userId
    const result = await PdfRecord.deleteMany(filter)
    logger.info({ chatId, userId, deleted: result.deletedCount }, '🧹 Registros PDF borrados')
  } catch (err) {
    logger.error({ err, chatId, userId }, 'Error borrando registros PDF')
  }
}

/**
 * Guarda el registro de un PDF analizado con sus datos estructurados.
 */
export async function savePdfRecord(data: {
  chatId: string
  userId: string
  userName: string
  fileName: string
  extractedText: string
  summary: string
  userQuery: string
  structured: IStructuredData
}): Promise<void> {
  try {
    await PdfRecord.create({ ...data, analyzedAt: new Date() })
    logger.info({ chatId: data.chatId, fileName: data.fileName }, '💾 PDF guardado en BD')
  } catch (err) {
    logger.error({ err }, 'Error guardando PDF en BD')
  }
}

/**
 * Búsqueda histórica inteligente basada en la intención detectada.
 * Combina filtros de fecha, proveedor y búsqueda de texto completo.
 */
export async function searchHistorical(
  chatId: string,
  query: HistoricalQuery
): Promise<string> {
  try {
    // Construir filtro MongoDB
    const filter: Record<string, unknown> = { chatId }

    if (query.dateRange) {
      filter.analyzedAt = {
        $gte: query.dateRange.from,
        $lte: query.dateRange.to,
      }
    }

    if (query.proveedor) {
      filter['structured.proveedor'] = {
        $regex: query.proveedor,
        $options: 'i',
      }
    }

    // Búsqueda de texto completo si hay keywords
    if (query.keywords.length > 0) {
      filter.$text = { $search: query.keywords.join(' ') }
    }

    const records = await PdfRecord.find(filter)
      .select('fileName userName summary structured analyzedAt userQuery')
      .sort({ analyzedAt: -1 })
      .limit(10)
      .lean()

    if (records.length === 0) return ''

    // Formatear los registros como contexto para Llama
    const context = records.map((r, i) => {
      const s = r.structured ?? {}
      const fecha = r.analyzedAt
        ? new Date(r.analyzedAt).toLocaleString('es-CO', { timeZone: 'America/Bogota' })
        : 'fecha desconocida'

      return [
        `--- Registro ${i + 1} ---`,
        `Archivo: ${r.fileName}`,
        `Analizado por: ${r.userName} el ${fecha}`,
        s.proveedor       ? `Proveedor: ${s.proveedor}` : '',
        s.monto           ? `Monto: ${s.monto} ${s.moneda ?? ''}`.trim() : '',
        s.fechaPago       ? `Fecha del pago: ${new Date(s.fechaPago).toLocaleDateString('es-CO')}` : '',
        s.tipoPago        ? `Tipo de pago: ${s.tipoPago}` : '',
        s.numeroDocumento ? `Número documento: ${s.numeroDocumento}` : '',
        s.concepto        ? `Concepto: ${s.concepto}` : '',
        s.banco           ? `Banco: ${s.banco}` : '',
        `Resumen: ${r.summary}`,
      ].filter(Boolean).join('\n')
    }).join('\n\n')

    logger.info({ count: records.length, chatId }, '🔍 Registros históricos encontrados')
    return context

  } catch (err) {
    logger.error({ err, chatId }, 'Error en búsqueda histórica')
    return ''
  }
}

/**
 * Obtiene todos los PDFs del día actual para el resumen de cierre.
 */
/**
 * Calcula el rango del día de hoy en Colombia (UTC-5).
 * Los documentos se almacenan en UTC en MongoDB, por lo que convertimos
 * el rango colombiano a UTC para la consulta.
 */
function getColombiaTodayRange(): { start: Date; end: Date } {
  const now = new Date()
  const colombiaOffsetMs = -5 * 60 * 60 * 1000

  const colombiaNow = new Date(now.getTime() + colombiaOffsetMs)
  const startOfDayColombia = new Date(
    Date.UTC(
      colombiaNow.getUTCFullYear(),
      colombiaNow.getUTCMonth(),
      colombiaNow.getUTCDate(),
      0, 0, 0, 0
    )
  )
  const endOfDayColombia = new Date(startOfDayColombia.getTime() + 24 * 60 * 60 * 1000 - 1)

  const startUTC = new Date(startOfDayColombia.getTime() - colombiaOffsetMs)
  const endUTC = new Date(endOfDayColombia.getTime() - colombiaOffsetMs)

  return { start: startUTC, end: endUTC }
}

export async function getPdfsOfToday(chatId: string): Promise<Array<{
  userName: string
  fileName: string
  summary: string
  userQuery: string
  structured: IStructuredData
  analyzedAt: Date
}>> {
  try {
    const { start, end } = getColombiaTodayRange()

    const records = await PdfRecord.find({
      chatId,
      analyzedAt: { $gte: start, $lte: end },
    })
      .select('userName fileName summary userQuery structured analyzedAt')
      .sort({ analyzedAt: 1 })
      .lean()

    return records.map((r) => ({
      userName: r.userName,
      fileName: r.fileName,
      summary: r.summary,
      userQuery: r.userQuery,
      structured: r.structured ?? {},
      analyzedAt: r.analyzedAt,
    }))
  } catch (err) {
    logger.error({ err, chatId }, 'Error obteniendo PDFs del día')
    return []
  }
}
