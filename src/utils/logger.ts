import pino from 'pino'
import { config } from '../config/config'

export const logger = pino({
  level: config.app.logLevel,
  transport: config.app.isDev
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
    : undefined,
})
