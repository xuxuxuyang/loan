const {
  readTrim,
  resolveHalfFlowTrafficConfig,
  validateEnabledHalfFlowTrafficConfig,
} = require('./config')
const {
  HalfFlowTrafficError,
  decryptHalfFlowData,
  encryptHalfFlowJson,
} = require('./crypto')
const { createMongoHalfFlowTrafficRepository } = require('./repository')
const {
  consumeHalfFlowLoginToken,
  handleHalfFlowAdmission,
  handleHalfFlowAppLink,
  handleHalfFlowApply,
} = require('./service')
const { notifyHalfFlowCreditResult } = require('./notify')

function channelCodeFromContext(ctx) {
  if (ctx && typeof ctx.get === 'function') return String(ctx.get('ChannelCode') || '')
  const headers = ctx && ctx.headers ? ctx.headers : {}
  return String(headers.channelcode || headers['channel-code'] || '')
}

function protocolFailure(ctx, error) {
  const known = error instanceof HalfFlowTrafficError
  ctx.status = 200
  ctx.body = {
    code: known ? Number(error.code || error.status || 400) : 500,
    message: known ? error.message : 'request failed',
    data: '',
  }
}

function normalizePath(value) {
  const raw = readTrim(value)
  if (!raw) return ''
  return raw.startsWith('/') ? raw : `/${raw}`
}

function stripApiPrefix(value) {
  const path = normalizePath(value)
  return path.startsWith('/api/') ? path.slice(4) : path
}

function isHalfFlowTrafficPublicPath(pathValue, config = {}) {
  const resolved = resolveHalfFlowTrafficConfig(config)
  const prefix = normalizePath(resolved.routePrefix)
  if (!prefix) return false
  const path = stripApiPrefix(pathValue)
  return path === prefix || path.startsWith(`${prefix}/`)
}

function resolveHalfFlowTrafficMongoRefreshPlan(method, pathValue, config = {}) {
  if (String(method || '').toUpperCase() !== 'POST') return null
  const resolved = resolveHalfFlowTrafficConfig(config)
  if (!isHalfFlowTrafficPublicPath(pathValue, resolved)) return null
  const path = stripApiPrefix(pathValue)
  const endpoint = path.slice(normalizePath(resolved.routePrefix).length) || '/'
  if (endpoint === '/admission' || endpoint === '/app/link' || endpoint === '/login/consume') {
    return { mode: 'partial', keys: ['users'], allowColdPartial: true }
  }
  return { mode: 'skip' }
}

function registerHalfFlowTrafficGatewayRoutes(router, deps = {}) {
  const logger = deps.logger || console
  const configProvider = typeof deps.configProvider === 'function' ? deps.configProvider : () => ({})
  const config = resolveHalfFlowTrafficConfig(configProvider())
  if (!config.enabled) return

  const validation = validateEnabledHalfFlowTrafficConfig(config)
  if (!validation.valid) {
    if (logger && typeof logger.warn === 'function') {
      logger.warn('[half-flow-traffic] config invalid, routes skipped:', [...validation.missing, ...validation.invalid].join(', '))
    }
    return
  }

  const repository = deps.repository || createMongoHalfFlowTrafficRepository()
  const readDb = typeof deps.readDb === 'function' ? deps.readDb : () => ({})
  const writeDbEntity = typeof deps.writeDbEntity === 'function' ? deps.writeDbEntity : null
  const flushMongoPersist = typeof deps.flushMongoPersist === 'function' ? deps.flushMongoPersist : null
  const httpClient = typeof deps.httpClient === 'function' ? deps.httpClient : undefined
  const now = typeof deps.now === 'function' ? deps.now : () => Date.now()
  const scheduleAsyncJob = typeof deps.scheduleAsyncJob === 'function'
    ? deps.scheduleAsyncJob
    : (job) => setTimeout(() => Promise.resolve().then(job).catch((error) => {
        if (logger && typeof logger.warn === 'function') {
          logger.warn('[half-flow-traffic] async job failed:', error && error.message ? error.message : error)
        }
      }), 0)

  async function handleEncrypted(ctx, action, options = {}) {
    try {
      const currentConfig = resolveHalfFlowTrafficConfig(configProvider())
      if (channelCodeFromContext(ctx) !== currentConfig.channelCode) {
        throw new HalfFlowTrafficError('invalid ChannelCode')
      }
      const payload = decryptHalfFlowData(ctx.request && ctx.request.body && ctx.request.body.data, currentConfig)
      const data = await action({
        payload,
        config: currentConfig,
        repository,
        db: options.needsDb === false ? undefined : readDb(),
      })
      ctx.status = 200
      ctx.body = {
        code: 0,
        message: 'success',
        data: encryptHalfFlowJson(data, currentConfig),
      }
    }
    catch (error) {
      protocolFailure(ctx, error)
    }
  }

  const prefix = config.routePrefix
  router.post(`${prefix}/admission`, ctx => handleEncrypted(
    ctx,
    args => handleHalfFlowAdmission({ ...args, now }),
  ))
  router.post(`${prefix}/apply`, ctx => handleEncrypted(ctx, async (args) => {
    const result = await handleHalfFlowApply({ ...args, now })
    if (result.shouldNotify) {
      scheduleAsyncJob(() => notifyHalfFlowCreditResult({
        row: result.row,
        repository,
        config: args.config,
        httpClient,
        now,
      }))
    }
    return result.data
  }, { needsDb: false }))
  router.post(`${prefix}/app/link`, ctx => handleEncrypted(ctx, args => handleHalfFlowAppLink({
    ...args,
    now,
    writeDbEntity,
    flushMongoPersist,
  })))
  router.post(`${prefix}/login/consume`, async (ctx) => {
    try {
      const currentConfig = resolveHalfFlowTrafficConfig(configProvider())
      const body = ctx.request && ctx.request.body ? ctx.request.body : {}
      const data = await consumeHalfFlowLoginToken({
        orderId: body.applyNo,
        token: body.token,
        db: readDb(),
        repository,
        config: currentConfig,
        now,
      })
      ctx.status = 200
      ctx.body = { success: true, data }
    }
    catch (error) {
      const known = error instanceof HalfFlowTrafficError
      const status = known ? Number(error.status || 400) : 500
      ctx.status = status
      ctx.body = {
        success: false,
        code: status,
        msg: known ? error.message : 'request failed',
        data: null,
      }
    }
  })
}

module.exports = {
  isHalfFlowTrafficPublicPath,
  registerHalfFlowTrafficGatewayRoutes,
  resolveHalfFlowTrafficMongoRefreshPlan,
}
