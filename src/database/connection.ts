import mongoose from 'mongoose'
import { config } from '../config/config'
import { logger } from '../utils/logger'

export async function connectDatabase(): Promise<void> {
  try {
    await mongoose.connect(config.mongodb.uri, {
      dbName: config.mongodb.dbName,
    })
    logger.info('✅ MongoDB conectado: ' + config.mongodb.dbName)
  } catch (err) {
    logger.error({ err }, '❌ Error conectando a MongoDB')
    process.exit(1)
  }
}

mongoose.connection.on('disconnected', () => {
  logger.warn('⚠️  MongoDB desconectado, intentando reconectar...')
})

mongoose.connection.on('reconnected', () => {
  logger.info('✅ MongoDB reconectado')
})
