import mongoose, { Document, Schema } from 'mongoose'

// Datos estructurados extraídos del documento por Llama
export interface IStructuredData {
  proveedor?: string      // Nombre del proveedor / empresa
  monto?: number          // Monto total del pago/factura
  moneda?: string         // COP, USD, EUR, etc.
  fechaPago?: Date        // Fecha del pago o documento
  tipoPago?: string       // Transferencia, efectivo, cheque, etc.
  numeroDocumento?: string // Número de factura, orden de compra, etc.
  concepto?: string       // Descripción del pago/servicio
  banco?: string          // Banco origen o destino
}

export interface IPdfRecord extends Document {
  chatId: string
  userId: string
  userName: string
  fileName: string
  extractedText: string
  summary: string
  userQuery: string
  structured: IStructuredData   // Datos estructurados para búsquedas precisas
  analyzedAt: Date
}

const StructuredDataSchema = new Schema<IStructuredData>(
  {
    proveedor:       { type: String, index: true },
    monto:           { type: Number },
    moneda:          { type: String },
    fechaPago:       { type: Date, index: true },
    tipoPago:        { type: String },
    numeroDocumento: { type: String },
    concepto:        { type: String },
    banco:           { type: String },
  },
  { _id: false }
)

const PdfRecordSchema = new Schema<IPdfRecord>(
  {
    chatId:        { type: String, required: true, index: true },
    userId:        { type: String, required: true },
    userName:      { type: String, default: 'Usuario' },
    fileName:      { type: String, default: 'archivo.pdf' },
    extractedText: { type: String, default: '' },
    summary:       { type: String, default: '' },
    userQuery:     { type: String, default: '' },
    structured:    { type: StructuredDataSchema, default: () => ({}) },
    analyzedAt:    { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
)

// Índice de texto completo para búsquedas por palabras clave
PdfRecordSchema.index({ 'structured.proveedor': 1, analyzedAt: -1 })
PdfRecordSchema.index({ chatId: 1, analyzedAt: -1 })
PdfRecordSchema.index(
  { summary: 'text', 'structured.proveedor': 'text', 'structured.concepto': 'text' },
  { name: 'text_search' }
)

export const PdfRecord = mongoose.model<IPdfRecord>('PdfRecord', PdfRecordSchema)
