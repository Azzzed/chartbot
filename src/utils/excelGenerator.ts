import ExcelJS from 'exceljs'
import path from 'path'
import fs from 'fs'
import { IStructuredData } from '../database/models/PdfRecord'

const TMP_DIR = path.join(process.cwd(), 'uploads', 'tmp')

if (!fs.existsSync(TMP_DIR)) {
  fs.mkdirSync(TMP_DIR, { recursive: true })
}

interface PdfEntry {
  fileName: string
  userName: string
  analyzedAt: Date
  userQuery: string
  summary: string
  structured: IStructuredData
}

/**
 * Genera un archivo Excel con el resumen del día y retorna la ruta del archivo.
 */
export async function generateClosingExcel(
  entries: PdfEntry[],
  date: Date = new Date()
): Promise<string> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'ChatBot Empresarial'
  workbook.created = new Date()

  // ─── Hoja 1: Detalle de documentos ───────────────────────────────────────────
  const detailSheet = workbook.addWorksheet('Detalle del Día')

  // Estilos
  const headerFill: ExcelJS.Fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1B4F72' },
  }
  const headerFont: Partial<ExcelJS.Font> = {
    color: { argb: 'FFFFFFFF' },
    bold: true,
    size: 11,
  }
  const altRowFill: ExcelJS.Fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFD6EAF8' },
  }

  // Título
  detailSheet.mergeCells('A1:L1')
  const titleCell = detailSheet.getCell('A1')
  titleCell.value = `Cierre del Día — ${date.toLocaleDateString('es-CO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`
  titleCell.font = { bold: true, size: 14, color: { argb: 'FF1B4F72' } }
  titleCell.alignment = { horizontal: 'center' }
  detailSheet.getRow(1).height = 28

  // Fila vacía
  detailSheet.addRow([])

  // Encabezados
  const headers = [
    'N°', 'Archivo', 'Enviado por', 'Descripción', 'Hora de análisis',
    'Proveedor', 'Monto', 'Moneda', 'Fecha Pago',
    'Tipo Pago', 'N° Documento', 'Concepto',
  ]

  const headerRow = detailSheet.addRow(headers)
  headerRow.eachCell((cell) => {
    cell.fill = headerFill
    cell.font = headerFont
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FF1B4F72' } },
    }
  })
  headerRow.height = 22

  // Anchos de columna
  detailSheet.columns = [
    { key: 'num',      width: 5  },
    { key: 'file',     width: 32 },
    { key: 'user',     width: 18 },
    { key: 'desc',     width: 28 },
    { key: 'time',     width: 20 },
    { key: 'vendor',   width: 24 },
    { key: 'amount',   width: 14 },
    { key: 'currency', width: 10 },
    { key: 'payDate',  width: 16 },
    { key: 'payType',  width: 16 },
    { key: 'docNum',   width: 20 },
    { key: 'concept',  width: 30 },
  ]

  // Filas de datos
  entries.forEach((e, i) => {
    const s = e.structured ?? {}
    const row = detailSheet.addRow([
      i + 1,
      e.fileName,
      e.userName,
      e.userQuery || '—',
      e.analyzedAt.toLocaleString('es-CO', { timeZone: 'America/Bogota' }),
      s.proveedor ?? '—',
      s.monto ?? '—',
      s.moneda ?? '—',
      s.fechaPago ? new Date(s.fechaPago).toLocaleDateString('es-CO') : '—',
      s.tipoPago ?? '—',
      s.numeroDocumento ?? '—',
      s.concepto ?? '—',
    ])

    // Fila alternada
    if (i % 2 === 1) {
      row.eachCell((cell) => { cell.fill = altRowFill })
    }

    // Formato numérico para monto
    if (s.monto) {
      const montoCell = row.getCell(6)
      montoCell.numFmt = '#,##0.00'
      montoCell.alignment = { horizontal: 'right' }
    }

    row.eachCell((cell) => {
      cell.alignment = { ...cell.alignment, vertical: 'middle' }
    })
    row.height = 18
  })

  // ─── Hoja 2: Totales por proveedor ────────────────────────────────────────────
  const summarySheet = workbook.addWorksheet('Totales por Proveedor')

  summarySheet.mergeCells('A1:D1')
  const sumTitle = summarySheet.getCell('A1')
  sumTitle.value = 'Totales por Proveedor'
  sumTitle.font = { bold: true, size: 13, color: { argb: 'FF1B4F72' } }
  sumTitle.alignment = { horizontal: 'center' }
  summarySheet.getRow(1).height = 26

  summarySheet.addRow([])

  const sumHeaders = summarySheet.addRow(['Proveedor', 'Total Documentos', 'Monto Total', 'Moneda'])
  sumHeaders.eachCell((cell) => {
    cell.fill = headerFill
    cell.font = headerFont
    cell.alignment = { horizontal: 'center' }
  })
  sumHeaders.height = 20

  summarySheet.columns = [
    { key: 'vendor', width: 28 },
    { key: 'count',  width: 18 },
    { key: 'total',  width: 18 },
    { key: 'curr',   width: 12 },
  ]

  // Agrupar por proveedor
  const byVendor = new Map<string, { count: number; total: number; moneda: string }>()
  entries.forEach((e) => {
    const s = e.structured ?? {}
    const vendor = s.proveedor ?? 'Sin proveedor'
    const prev = byVendor.get(vendor) ?? { count: 0, total: 0, moneda: s.moneda ?? '' }
    byVendor.set(vendor, {
      count: prev.count + 1,
      total: prev.total + (s.monto ?? 0),
      moneda: s.moneda ?? prev.moneda,
    })
  })

  Array.from(byVendor.entries()).forEach(([vendor, data], i) => {
    const row = summarySheet.addRow([vendor, data.count, data.total, data.moneda])
    if (i % 2 === 1) {
      row.eachCell((cell) => { cell.fill = altRowFill })
    }
    row.getCell(3).numFmt = '#,##0.00'
    row.getCell(3).alignment = { horizontal: 'right' }
    row.height = 18
  })

  // ─── Guardar archivo ──────────────────────────────────────────────────────────
  const dateStr = date.toISOString().slice(0, 10)
  const filePath = path.join(TMP_DIR, `cierre_${dateStr}_${Date.now()}.xlsx`)
  await workbook.xlsx.writeFile(filePath)

  return filePath
}
