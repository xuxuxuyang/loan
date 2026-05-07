function readEnv(primary, aliases = []) {
  const keys = [primary, ...aliases]
  for (const key of keys) {
    const raw = process.env[key]
    if (raw !== undefined && String(raw).trim() !== '') {
      return String(raw).trim()
    }
  }
  return ''
}

/**
 * MongoDB 连接参数（环境变量）。
 * 仅在本文件读取 env，业务代码请使用 getMongoConfig / getMongoConfigSummary。
 */
function getMongoConfig() {
  const uri = readEnv('MONGODB_URI', ['MONGO_URI', 'DATABASE_URL'])
  const dbName = readEnv('MONGODB_DB_NAME', ['MONGO_DB_NAME'])
  const rawPool = readEnv('MONGODB_MAX_POOL_SIZE', ['MONGO_MAX_POOL_SIZE'])
  let maxPoolSize = 10
  if (rawPool) {
    const n = Number(rawPool)
    if (Number.isFinite(n) && n > 0) {
      maxPoolSize = Math.floor(n)
    }
  }
  return { uri, dbName, maxPoolSize }
}

function isMongoConfigured() {
  return Boolean(getMongoConfig().uri)
}

/** 供健康检查展示：不包含账号密码 */
function getMongoConfigSummary() {
  const { uri, dbName } = getMongoConfig()
  const configured = isMongoConfigured()
  let host = null
  let database = dbName || null
  if (configured && uri) {
    try {
      const u = new URL(uri)
      host = u.hostname || null
      if (!database && u.pathname && u.pathname.length > 1) {
        const segment = u.pathname.slice(1).split('/')[0]
        if (segment) {
          database = decodeURIComponent(segment)
        }
      }
    }
    catch {
      host = '(URI 无法解析)'
    }
  }
  return {
    configured,
    host,
    database,
  }
}

module.exports = {
  getMongoConfig,
  isMongoConfigured,
  getMongoConfigSummary,
}
