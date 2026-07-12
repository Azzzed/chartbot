// ─── Detector de intención ────────────────────────────────────────────────────
// Determina si un mensaje es una consulta histórica que requiere buscar en BD

export type QueryIntent = 'historical' | 'general'

export interface HistoricalQuery {
  intent: 'historical'
  keywords: string[]       // Palabras clave para búsqueda de texto
  dateRange?: { from: Date; to: Date }
  proveedor?: string
}

export interface GeneralQuery {
  intent: 'general'
}

export type ParsedIntent = HistoricalQuery | GeneralQuery

// Palabras que indican consulta histórica
const HISTORICAL_TRIGGERS = [
  'busca', 'buscame', 'búscame',
  'pago', 'pagamos', 'pagué', 'pagaste',
  'factura', 'facturas',
  'proveedor', 'proveedores',
  'compra', 'compras', 'compramos',
  'transferencia', 'transferencias',
  'cobro', 'cobros',
  'registro', 'registros',
  'historial',
  'cuánto', 'cuanto',
  'cuál', 'cual',
  'quién', 'quien',
  'cuándo', 'cuando pagamos', 'cuando se pagó',
  'muéstrame', 'muestrame',
  'encuentra', 'encontrar',
  'hace cuánto', 'hace cuanto',
  'el lunes', 'el martes', 'el miércoles', 'el jueves',
  'el viernes', 'el sábado', 'el domingo',
  'ayer', 'antier', 'anteayer',
  'la semana pasada', 'semana pasada',
  'el mes pasado', 'mes pasado',
]

const DAYS_ES: Record<string, number> = {
  domingo: 0, lunes: 1, martes: 2, miércoles: 3,
  miercoles: 3, jueves: 4, viernes: 5, sábado: 6, sabado: 6,
}

/**
 * Analiza el mensaje y determina si es una consulta histórica o general.
 */
export function detectIntent(message: string): ParsedIntent {
  const lower = message.toLowerCase()

  const isHistorical = HISTORICAL_TRIGGERS.some((t) => lower.includes(t))
  if (!isHistorical) return { intent: 'general' }

  // Extraer rango de fechas del mensaje
  const dateRange = parseDateRange(lower)

  // Extraer posible nombre de proveedor (palabras después de "proveedor", "a ", "de ")
  const proveedor = extractProveedor(lower)

  // Palabras clave para búsqueda de texto completo (excluir stopwords)
  const keywords = extractKeywords(lower)

  return { intent: 'historical', dateRange, proveedor, keywords }
}

// ─── Parser de fechas en español ─────────────────────────────────────────────

function parseDateRange(text: string): { from: Date; to: Date } | undefined {
  const now = new Date()

  // "ayer" / "antier"
  if (text.includes('ayer')) {
    return dayRange(addDays(now, -1))
  }
  if (text.includes('antier') || text.includes('anteayer')) {
    return dayRange(addDays(now, -2))
  }

  // "la semana pasada" / "semana pasada"
  if (text.includes('semana pasada')) {
    const startOfLastWeek = startOfWeek(addDays(now, -7))
    const endOfLastWeek = addDays(startOfLastWeek, 6)
    endOfLastWeek.setHours(23, 59, 59, 999)
    return { from: startOfLastWeek, to: endOfLastWeek }
  }

  // "el mes pasado"
  if (text.includes('mes pasado')) {
    const firstOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const lastOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999)
    return { from: firstOfLastMonth, to: lastOfLastMonth }
  }

  // "el [día] pasado" → ej: "el domingo pasado"
  // Nota: 'pasado' se eliminó de HISTORICAL_TRIGGERS para evitar falsos positivos.
  // Aquí solo se evalúa si el texto contiene "pasado" combinado con un día específico.
  for (const [dayName, dayNum] of Object.entries(DAYS_ES)) {
    if (text.includes(dayName)) {
      const lastOccurrence = lastWeekday(now, dayNum)

      if (text.includes('pasado') || text.includes(`el ${dayName}`)) {
        return dayRange(lastOccurrence)
      }
      break // Solo evaluar el primer día que aparezca en el mensaje
    }
  }

  // Fecha explícita "3 de junio", "el 3 de junio"
  const explicitDate = parseExplicitDate(text)
  if (explicitDate) return dayRange(explicitDate)

  // Si no encontró fecha específica pero hay trigger histórico, buscar últimos 30 días
  return {
    from: addDays(now, -30),
    to: now,
  }
}

function extractProveedor(text: string): string | undefined {
  // Buscar patrón: "proveedor X", "a X", "de X" donde X es nombre propio
  const patterns = [
    /proveedor\s+([a-záéíóúüñ\s]{3,30})/i,
    /(?:pago|pagamos|pagué)\s+a\s+([a-záéíóúüñ\s]{3,30})/i,
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.[1]) return match[1].trim()
  }
  return undefined
}

function extractKeywords(text: string): string[] {
  const stopwords = new Set([
    'el', 'la', 'los', 'las', 'un', 'una', 'de', 'del', 'en', 'y', 'o',
    'a', 'que', 'por', 'con', 'se', 'me', 'bot', 'quiero', 'saber',
    'cuál', 'cual', 'qué', 'que', 'fue', 'hizo', 'pasado', 'pasada',
    'puedo', 'puede', 'ver', 'dame', 'dime', 'muestra', 'busca',
  ])

  return text
    .replace(/[¿?¡!.,;:]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !stopwords.has(w))
    .slice(0, 8) // máximo 8 keywords
}

// ─── Helpers de fecha ─────────────────────────────────────────────────────────

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function dayRange(date: Date): { from: Date; to: Date } {
  const from = new Date(date)
  from.setHours(0, 0, 0, 0)
  const to = new Date(date)
  to.setHours(23, 59, 59, 999)
  return { from, to }
}

function startOfWeek(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  d.setDate(d.getDate() - day)
  d.setHours(0, 0, 0, 0)
  return d
}

function lastWeekday(from: Date, targetDay: number): Date {
  const d = new Date(from)
  const current = d.getDay()
  let diff = current - targetDay
  if (diff <= 0) diff += 7
  d.setDate(d.getDate() - diff)
  return d
}

const MONTHS_ES: Record<string, number> = {
  enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
  julio: 6, agosto: 7, septiembre: 8, octubre: 9, noviembre: 10, diciembre: 11,
}

function parseExplicitDate(text: string): Date | undefined {
  const match = text.match(/(\d{1,2})\s+de\s+([a-záéíóú]+)(?:\s+(?:de\s+)?(\d{4}))?/)
  if (!match) return undefined

  const day = parseInt(match[1])
  const month = MONTHS_ES[match[2].toLowerCase()]
  const year = match[3] ? parseInt(match[3]) : new Date().getFullYear()

  if (month === undefined || isNaN(day)) return undefined

  return new Date(year, month, day)
}
