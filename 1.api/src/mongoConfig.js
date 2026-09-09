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
  let maxPoolSize
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

function isMongoRequired() {
  const raw = String(process.env.MONGODB_REQUIRED || process.env.DISABLE_JSON_STORE || '').trim().toLowerCase()
  return raw === 'true' || raw === '1' || raw === 'yes'
}

/** 为 true 时才允许未连通 Mongo 时使用 api/data/db.json（仅本地调试） */
function isJsonFallbackAllowed() {
  return /^true$/i.test(String(process.env.ALLOW_JSON_FALLBACK || '').trim())
}

/** 为 true 时，每个 /api 请求结束会先 await 当前作用域的 Mongo 持久化队列（含 GET）。高流量生产可仅用默认的「仅写接口」等待。 */
function isMongoAwaitPersistEnabled() {
  const raw = String(process.env.MONGO_AWAIT_PERSIST || process.env.STORE_AWAIT_MONGO_PERSIST || '').trim().toLowerCase()
  return raw === 'true' || raw === '1' || raw === 'yes'
}

/**
 * Mongo 模式下：设为 true 时关闭「POST/PUT/PATCH/DELETE 结束后等待本 tenant/workspace 队列落库」；
 * 未设置时为 false → 启用该等待，保证下一请求的 refreshScopeCacheFromMongo 与本请求写入对齐（体感接近本地 db.json 同步写）。
 */
function isMongoMutationPersistFlushSkipped() {
  const raw = String(process.env.MONGO_SKIP_MUTATION_FLUSH || '').trim().toLowerCase()
  return raw === 'true' || raw === '1' || raw === 'yes'
}

/**
 * Mongo 快照 refresh 策略（api/src/store.js refreshScopeCacheFromMongo）：
 * - version（默认）：仅 app_meta.updatedAt 变化时全量读（语义等价，显著降 Mongo 读）
 * - every_request：每个 /api 请求全量读 Mongo（紧急回滚）
 * - single_instance：单 Node 进程内跳过跨请求 refresh（仅单实例部署时使用）
 */
function getMongoRefreshMode() {
  const raw = readEnv('MONGO_REFRESH_MODE').toLowerCase()
  if (raw === 'version' || raw === 'every_request' || raw === 'single_instance') {
    return raw
  }
  return 'version'
}

/** 管理端只读优化总开关（与 api/src/index.js 一致） */
function isAdminReadOptimizeEnabled() {
  for (const key of ['API_LIST_PAGINATE_BEFORE_ENRICH', 'API_ADMIN_READ_OPTIMIZE']) {
    const raw = String(process.env[key] || '').trim().toLowerCase()
    if (raw === 'true' || raw === '1' || raw === 'yes') {
      return true
    }
  }
  return false
}

module.exports = {
  getMongoConfig,
  isMongoConfigured,
  getMongoConfigSummary,
  isMongoRequired,
  isJsonFallbackAllowed,
  isMongoAwaitPersistEnabled,
  isMongoMutationPersistFlushSkipped,
  getMongoRefreshMode,
  isAdminReadOptimizeEnabled,
}
