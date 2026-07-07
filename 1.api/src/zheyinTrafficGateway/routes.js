const { resolveZheyinTrafficConfig } = require('./config')
const { parseZheyinTrafficEnvelope, ZheyinTrafficError, readTrim } = require('./crypto')
const {
  handleAdmission,
  handleContracts,
  handleCreditApply,
  handleCreditQuery,
  handleAppLink,
  bindZheyinMallUser,
  verifyZheyinLoginToken,
  sanitizeZheyinLoginUser,
  normalizePhone,
  compactDateTime,
  addDaysDateTime,
} = require('./service')
const { createMongoZheyinTrafficRepository } = require('./repository')
const { notifyZheyinTrafficCreditResult } = require('./notify')

function success(ctx, data) {
  ctx.status = 200
  ctx.body = data === undefined ? { code: 200, msg: 'success' } : { code: 200, msg: 'success', data }
}

function fail(ctx, err) {
  const status = err && err.status ? err.status : 400
  ctx.status = 200
  ctx.body = { code: status, msg: err && err.message ? err.message : 'request failed' }
}

function loginSuccess(ctx, data) {
  ctx.status = 200
  ctx.body = { success: true, data }
}

function loginFail(ctx, err) {
  const status = err && err.status ? err.status : 400
  ctx.status = status
  ctx.body = { success: false, code: status, msg: err && err.message ? err.message : 'request failed', data: null }
}

function normalizePath(value) {
  const raw = readTrim(value)
  if (!raw) return ''
  return raw.startsWith('/') ? raw : `/${raw}`
}

function stripApiPrefix(pathValue) {
  const path = normalizePath(pathValue)
  return path.startsWith('/api/') ? path.slice(4) : path
}

function isZheyinTrafficPublicPath(pathValue, config = {}) {
  const cfg = resolveZheyinTrafficConfig(config)
  const prefix = normalizePath(cfg.routePrefix)
  if (!prefix) return false
  const path = stripApiPrefix(pathValue)
  return path === prefix || path.startsWith(`${prefix}/`)
}

function resolveZheyinTrafficMongoRefreshPlan(method, pathValue, config = {}) {
  if (String(method || 'GET').toUpperCase() !== 'POST') return null
  const cfg = resolveZheyinTrafficConfig(config)
  if (!isZheyinTrafficPublicPath(pathValue, cfg)) return null
  const path = stripApiPrefix(pathValue)
  const endpoint = path.slice(normalizePath(cfg.routePrefix).length) || '/'
  if (endpoint === '/contracts') return { mode: 'skip' }
  if (endpoint === '/admission') return { mode: 'partial', keys: ['users'], allowColdPartial: true }
  if (endpoint === '/credit/apply' || endpoint === '/credit/query' || endpoint === '/app/link') return { mode: 'skip' }
  return { mode: 'skip' }
}

function buildReviewSubject(row) {
  const payload = row && row.rawApplyPayload ? row.rawApplyPayload : {}
  const user = payload.userInfo || {}
  return {
    userName: readTrim(user.name),
    phoneNumber: String(user.mobile || '').replace(/\D/g, ''),
    idNumber: readTrim(user.idCardNo).toUpperCase(),
  }
}

async function processCreditReview({ orderId, repository, config, runCreditReview, httpClient, now, readDb, writeDbPartial, writeDb, flushMongoPersist }) {
  const row = await repository.findByOrderId(orderId)
  if (!row) return { status: 'SKIPPED', reason: 'application_not_found' }
  if (typeof runCreditReview !== 'function') return { status: 'SKIPPED', reason: 'review_runner_missing' }
  const checkedAt = new Date(typeof now === 'function' ? Number(now()) : Date.now()).toISOString()
  let next
  try {
    const result = await runCreditReview(buildReviewSubject(row))
    const passed = Boolean(result && result.allPassed)
    next = {
      ...row,
      auditStatus: passed ? 1 : 4,
      auditStatusName: passed ? 'auth_success' : 'auth_fail',
      auditTime: compactDateTime(checkedAt),
      expireTime: passed ? addDaysDateTime(checkedAt, config.creditExpireDays) : '',
      refuseReason: passed ? '' : String((result && result.message) || 'credit rejected'),
      riskReviewSource: 'zheyin_apply_async',
      applyRiskSteps: Array.isArray(result && result.steps) ? result.steps : [],
      updatedAt: checkedAt,
    }
  }
  catch (err) {
    next = {
      ...row,
      auditStatus: 3,
      auditStatusName: 'auth_error',
      auditTime: compactDateTime(checkedAt),
      refuseReason: err && err.message ? err.message : String(err),
      updatedAt: checkedAt,
    }
  }
  if (Number(next.auditStatus) === 1 && typeof readDb === 'function') {
    const db = readDb()
    const user = bindZheyinMallUser(db, next, config, now)
    if (user && readTrim(user.id)) {
      next.mallUserId = readTrim(user.id)
      next.mallUserPhone = normalizePhone(user.phone)
      if (typeof writeDbPartial === 'function') {
        writeDbPartial(db, ['users'])
      }
      else if (typeof writeDb === 'function') {
        writeDb(db)
      }
      if (typeof flushMongoPersist === 'function') {
        await flushMongoPersist()
      }
    }
  }
  await repository.upsert(next)
  await notifyZheyinTrafficCreditResult({ row: next, repository, config, httpClient, now })
  return { status: next.auditStatus }
}

function registerZheyinTrafficGatewayRoutes(router, deps = {}) {
  const logger = deps.logger || console
  const configProvider = typeof deps.configProvider === 'function' ? deps.configProvider : () => ({})
  const routeConfig = resolveZheyinTrafficConfig(configProvider())
  if (!routeConfig.enabled) return
  const required = ['routePrefix', 'channel', 'aesKey', 'aesIv']
  const missing = required.filter(field => !readTrim(routeConfig[field]))
  if (missing.length) {
    if (logger && typeof logger.warn === 'function') {
      logger.warn('[zheyin-traffic] config incomplete, routes skipped:', missing.join(', '))
    }
    return
  }
  const repository = deps.repository || createMongoZheyinTrafficRepository()
  const readDb = typeof deps.readDb === 'function' ? deps.readDb : () => ({})
  const writeDb = typeof deps.writeDb === 'function' ? deps.writeDb : null
  const writeDbPartial = typeof deps.writeDbPartial === 'function' ? deps.writeDbPartial : null
  const flushMongoPersist = typeof deps.flushMongoPersist === 'function' ? deps.flushMongoPersist : null
  const httpClient = typeof deps.httpClient === 'function' ? deps.httpClient : undefined
  const runCreditReview = typeof deps.runCreditReview === 'function' ? deps.runCreditReview : null
  const now = typeof deps.now === 'function' ? deps.now : () => Date.now()
  const scheduleAsyncJob = typeof deps.scheduleAsyncJob === 'function'
    ? deps.scheduleAsyncJob
    : (fn) => setTimeout(() => Promise.resolve().then(fn).catch(err => {
        console.warn('[zheyin-traffic] async job failed:', err && err.message ? err.message : err)
      }), 0)

  async function handle(ctx, action, options = {}) {
    try {
      const config = resolveZheyinTrafficConfig(configProvider())
      const payload = parseZheyinTrafficEnvelope(ctx.request.body || {}, config, { now: now() })
      const result = await action({ payload, config, repository, db: options.needsDb === false ? undefined : readDb() })
      success(ctx, result)
    }
    catch (err) {
      fail(ctx, err)
    }
  }

  const prefix = routeConfig.routePrefix
  router.post(`${prefix}/admission`, ctx => handle(ctx, args => handleAdmission({ ...args, now })))
  router.post(`${prefix}/contracts`, ctx => handle(ctx, args => handleContracts(args), { needsDb: false }))
  router.post(`${prefix}/credit/apply`, ctx => handle(ctx, async args => {
    const result = await handleCreditApply({ ...args, now })
    if (result && readTrim(result.orderId)) {
      scheduleAsyncJob(async () => {
        const row = await repository.findByOrderId(result.orderId)
        await notifyZheyinTrafficCreditResult({ row, repository, config: args.config, httpClient, now })
      })
    }
    return result
  }))
  router.post(`${prefix}/credit/query`, ctx => handle(ctx, args => handleCreditQuery(args), { needsDb: false }))
  router.post(`${prefix}/app/link`, ctx => handle(ctx, args => handleAppLink({
    ...args,
    now,
    writeDb,
    writeDbPartial,
    flushMongoPersist,
  })))
  router.post(`${prefix}/login/consume`, async (ctx) => {
    try {
      const config = resolveZheyinTrafficConfig(configProvider())
      const payload = ctx.request.body || {}
      const orderId = readTrim(payload.applyNo)
      const row = await repository.findByOrderId(orderId)
      if (!row) throw new ZheyinTrafficError('applyNo not found', 404)
      verifyZheyinLoginToken(row, payload.token, config.loginTokenTtlMs, typeof now === 'function' ? now() : Date.now())
      const db = readDb()
      const user = (Array.isArray(db.users) ? db.users : []).find(item => item && readTrim(item.id) === readTrim(row.mallUserId))
      if (!user) throw new ZheyinTrafficError('mall user not found', 404)
      row.loginTokenConsumedAt = new Date(typeof now === 'function' ? Number(now()) : Date.now()).toISOString()
      await repository.upsert(row)
      loginSuccess(ctx, {
        token: `mock-token-${normalizePhone(user.phone)}`,
        user: sanitizeZheyinLoginUser(user),
      })
    }
    catch (err) {
      loginFail(ctx, err)
    }
  })
}

async function queueZheyinTrafficCreditNotify(options = {}) {
  const config = resolveZheyinTrafficConfig(options.config || {})
  if (!config.enabled) return { sent: false, reason: 'disabled' }
  const repository = options.repository || createMongoZheyinTrafficRepository()
  const row = options.row || (options.orderId ? await repository.findByOrderId(options.orderId) : null)
  return notifyZheyinTrafficCreditResult({
    row,
    repository,
    config,
    httpClient: options.httpClient,
    now: options.now,
  })
}

module.exports = {
  registerZheyinTrafficGatewayRoutes,
  isZheyinTrafficPublicPath,
  resolveZheyinTrafficMongoRefreshPlan,
  processCreditReview,
  queueZheyinTrafficCreditNotify,
  ZheyinTrafficError,
}
