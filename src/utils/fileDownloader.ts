import { downloadMediaMessage } from 'baileys'
import { proto } from 'baileys'
import fs from 'fs'
import path from 'path'
import { logger } from './logger'

const TMP_DIR = path.join(process.cwd(), 'uploads', 'tmp')
const REUPLOAD_TIMEOUT = 15_000
const DOWNLOAD_TIMEOUT = 30_000

if (!fs.existsSync(TMP_DIR)) {
  fs.mkdirSync(TMP_DIR, { recursive: true })
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout: ${label} excedió ${ms}ms`)), ms)
    ),
  ])
}

async function tryDownload(msg: any, updateMediaRequest?: (msg: any) => Promise<any>): Promise<Buffer | null> {
  const buffer = await downloadMediaMessage(
    msg,
    'buffer',
    {},
    updateMediaRequest ? { reuploadRequest: updateMediaRequest, logger } : undefined,
  ) as Buffer
  return buffer
}

export async function downloadFile(
  msg: proto.IWebMessageInfo,
  updateMediaRequest?: (msg: any) => Promise<any>,
): Promise<string | null> {
  try {
    let buffer: Buffer | null = null

    try {
      buffer = await withTimeout(tryDownload(msg, updateMediaRequest), DOWNLOAD_TIMEOUT, 'Descarga inicial')
    } catch (err: any) {
      const status = err?.response?.status ?? err?.status ?? 0
      if (status !== 403 || !updateMediaRequest) {
        throw err
      }

      logger.warn('403 en descarga, solicitando reupload al teléfono...')
      let freshMsg: any
      try {
        freshMsg = await withTimeout(
          updateMediaRequest(msg as any),
          REUPLOAD_TIMEOUT,
          'Reupload (updateMediaMessage)',
        )
      } catch (reupErr) {
        logger.error({ err: reupErr }, 'Reupload falló o expiró')
        return null
      }

      if (!freshMsg) {
        logger.warn('Reupload devolvió mensaje vacío')
        return null
      }

      try {
        buffer = await withTimeout(tryDownload(freshMsg, updateMediaRequest), DOWNLOAD_TIMEOUT, 'Descarga tras reupload')
      } catch (retryErr) {
        logger.error({ err: retryErr }, 'Descarga falló incluso tras reupload')
        return null
      }
    }

    if (!buffer) return null

    const docMsg =
      msg.message?.documentMessage ??
      msg.message?.documentWithCaptionMessage?.message?.documentMessage
    const imgMsg = msg.message?.imageMessage
    const ext = imgMsg?.mimetype?.includes('png') ? 'png' : 'jpg'
    const originalName = docMsg?.fileName ?? (imgMsg ? `imagen_${Date.now()}.${ext}` : `archivo_${Date.now()}`)
    const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_')
    const filePath = path.join(TMP_DIR, `${Date.now()}_${safeName}`)

    fs.writeFileSync(filePath, buffer)
    logger.info({ filePath, size: buffer.length }, '📁 Archivo descargado')

    return filePath
  } catch (err) {
    logger.error({ err }, 'Error descargando archivo')
    return null
  }
}

export function cleanupFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
  } catch {
    // ignorar errores de limpieza
  }
}
