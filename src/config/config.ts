import dotenv from 'dotenv'

dotenv.config()

const required = (key: string): string => {
  const value = process.env[key]
  if (!value) throw new Error(`Variable de entorno requerida: ${key}`)
  return value
}

export const config = {
  groq: {
    apiKey: required('GROQ_API_KEY'),
    model: process.env.GROQ_MODEL ?? 'llama-3.1-8b-instant',
  },
  mongodb: {
    uri: required('MONGODB_URI'),
    dbName: process.env.MONGODB_DB_NAME ?? 'chat-empresarial',
  },
  whatsapp: {
    sessionName: process.env.WA_SESSION_NAME ?? 'chat-empresarial-session',
    botPrefix: process.env.BOT_PREFIX ?? '!bot',
    mainGroupId: process.env.MAIN_GROUP_ID ?? '',
  },
  app: {
    env: process.env.NODE_ENV ?? 'development',
    logLevel: process.env.LOG_LEVEL ?? 'info',
    isDev: process.env.NODE_ENV !== 'production',
  },
} as const

export type Config = typeof config
