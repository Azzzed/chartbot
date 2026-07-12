import fs from 'fs'
import path from 'path'
import { MessageType } from '../types'
import { logger } from './logger'

const MAX_CHARS = 12000 // Límite de caracteres para no saturar el contexto de Llama

/**
 * Extrae texto de un archivo según su tipo
 */
export async function extractText(
  filePath: string,
  type: MessageType
): Promise<string> {
  try {
    switch (type) {
      case 'pdf':
        return await extractPDF(filePath)
      case 'excel':
        return await extractExcel(filePath)
      case 'word':
        return await extractWord(filePath)
      default:
        return ''
    }
  } catch (err) {
    logger.error({ err, filePath, type }, 'Error extrayendo texto del archivo')
    return ''
  }
}

// ─── PDF ──────────────────────────────────────────────────────────────────────
async function extractPDF(filePath: string): Promise<string> {
  const pdfParse = (await import('pdf-parse')).default
  const buffer = fs.readFileSync(filePath)
  const data = await pdfParse(buffer)
  return truncate(data.text, `PDF (${data.numpages} páginas)`)
}

// ─── Excel ────────────────────────────────────────────────────────────────────
async function extractExcel(filePath: string): Promise<string> {
  const ExcelJS = (await import('exceljs')).default
  const workbook = new ExcelJS.Workbook()
  const ext = path.extname(filePath).toLowerCase()

  if (ext === '.csv') {
    await workbook.csv.readFile(filePath)
  } else {
    await workbook.xlsx.readFile(filePath)
  }

  const lines: string[] = []

  workbook.eachSheet((sheet) => {
    lines.push(`\n📊 Hoja: ${sheet.name}`)
    sheet.eachRow((row, rowNum) => {
      if (rowNum > 500) return // límite de filas
      const values = (row.values as unknown[])
        .slice(1) // la primera posición es undefined en ExcelJS
        .map((v) => (v === null || v === undefined ? '' : String(v)))
        .join(' | ')
      if (values.trim()) lines.push(values)
    })
  })

  return truncate(lines.join('\n'), 'Excel')
}

// ─── Word ─────────────────────────────────────────────────────────────────────
async function extractWord(filePath: string): Promise<string> {
  const mammoth = await import('mammoth')
  const result = await mammoth.extractRawText({ path: filePath })
  return truncate(result.value, 'Word')
}

// ─── Utilidad ─────────────────────────────────────────────────────────────────
function truncate(text: string, label: string): string {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (cleaned.length > MAX_CHARS) {
    logger.warn(`Texto de ${label} truncado a ${MAX_CHARS} caracteres`)
    return cleaned.slice(0, MAX_CHARS) + '\n\n[... contenido truncado por longitud]'
  }
  return cleaned
}
