const crypto = require('node:crypto')

class DuodiandianGatewayError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.name = 'DuodiandianGatewayError'
    this.status = status
  }
}

function nonEmpty(value) {
  return value !== undefined && value !== null && value !== ''
}

function md5(input) {
  return crypto.createHash('md5').update(input, 'utf8').digest('hex')
}

function readTrim(value) {
  return String(value || '').trim()
}

function normalizeCode(value) {
  return readTrim(value).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64)
}

function normalizeRoutePrefix(value) {
  const raw = readTrim(value).replace(/\/+$/, '')
  if (!raw || !raw.startsWith('/')) {
    return ''
  }
  return raw
}

function isDuodiandianPublicPath(pathValue, config = {}) {
  const resolved = resolveGatewayConfig(config)
  const prefix = normalizeRoutePrefix(resolved.routePrefix)
  const path = normalizePath(pathValue)
  if (!prefix || !path) return false
  return path === prefix || path.startsWith(`${prefix}/`)
}

function normalizePath(value) {
  const raw = readTrim(value)
  if (!raw) return ''
  return raw.startsWith('/') ? raw : `/${raw}`
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 20)
}

function maskPhone(value) {
  const phone = normalizePhone(value)
  if (phone.length < 7) return phone ? `${phone.slice(0, 2)}***` : ''
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`
}

function maskIdNo(value) {
  const raw = String(value || '').trim()
  if (raw.length < 8) return raw ? '***' : ''
  return `${raw.slice(0, 3)}***********${raw.slice(-4)}`
}

function phoneStartsWithPrefix(value, prefix) {
  const phone = normalizePhone(value)
  return !!(prefix && phone && phone.startsWith(prefix))
}

function collectOrderPhones(order) {
  if (!order || typeof order !== 'object') return []
  const buyer = order.buyer && typeof order.buyer === 'object' ? order.buyer : {}
  const receiver = order.receiver && typeof order.receiver === 'object' ? order.receiver : {}
  const shipping = order.shipping && typeof order.shipping === 'object' ? order.shipping : {}
  return [
    order.phone,
    order.userPhone,
    order.mallUserPhone,
    order.receiverPhone,
    buyer.phone,
    receiver.phone,
    shipping.phone,
  ].filter(nonEmpty)
}

function hasBlockingUserPrefixHit(db, prefix) {
  return (Array.isArray(db.users) ? db.users : []).some((user) => {
    if (!user || typeof user !== 'object') return false
    return phoneStartsWithPrefix(user.phone || user.mobile || user.userPhone, prefix)
  })
}

function hasBlockingOrderPrefixHit(db, prefix) {
  return (Array.isArray(db.orders) ? db.orders : []).some((order) => {
    const phones = collectOrderPhones(order)
    return phones.some(phone => phoneStartsWithPrefix(phone, prefix))
  })
}

function hasBlockingApplicationPrefixHit(db, prefix, config = {}) {
  const cfg = resolveGatewayConfig(config)
  return (Array.isArray(db.partnerGatewayApplications) ? db.partnerGatewayApplications : []).some((app) => {
    if (!app || typeof app !== 'object') return false
    const appPartner = normalizeCode(app.partnerCode)
    const appChannel = normalizeCode(app.channel)
    const isCurrentPartner = appPartner === cfg.partnerCode && appChannel === cfg.channelCode
    if (!isCurrentPartner) return false
    return phoneStartsWithPrefix(app.userPhone || app.phone, prefix)
  })
}

function buildDuodiandianCheckPrefixResult(db, payload, config = {}) {
  const prefix = normalizePhone(payload && (payload.phone_pre || payload.phonePre || payload.phonePrefix))
  if (prefix.length < 3) {
    return { check_ret: 'N', phone_md5: [] }
  }
  const blocked = hasBlockingUserPrefixHit(db, prefix)
    || hasBlockingOrderPrefixHit(db, prefix)
    || hasBlockingApplicationPrefixHit(db, prefix, config)
  // Never return matched phone hashes; the partner only receives an allow/deny result.
  return { check_ret: blocked ? 'N' : 'Y', phone_md5: [] }
}

function duodiandianConfigFromEnv() {
  const partner = readTrim(process.env.DUODIANDIAN_PARTNER)
  const channelCode = normalizeCode(process.env.DUODIANDIAN_CHANNEL_CODE)
  return {
    partner,
    partnerCode: normalizeCode(process.env.DUODIANDIAN_PARTNER_CODE) || partner,
    signKey: readTrim(process.env.DUODIANDIAN_SIGN_KEY),
    encKey: readTrim(process.env.DUODIANDIAN_ENC_KEY),
    h5Origin: readTrim(process.env.DUODIANDIAN_H5_ORIGIN || process.env.MALL_H5_ORIGIN).replace(/\/$/, ''),
    timestampSkewMs: readTrim(process.env.DUODIANDIAN_TIMESTAMP_SKEW_MS),
    channelCode,
    channelName: readTrim(process.env.DUODIANDIAN_CHANNEL_NAME),
    gatewayRemark: readTrim(process.env.DUODIANDIAN_CHANNEL_REMARK),
    routePrefix: normalizeRoutePrefix(process.env.DUODIANDIAN_ROUTE_PREFIX),
    portalUsername: readTrim(process.env.DUODIANDIAN_PORTAL_USERNAME),
    portalPassword: readTrim(process.env.DUODIANDIAN_PORTAL_PASSWORD),
    portalName: readTrim(process.env.DUODIANDIAN_PORTAL_NAME),
    userAgreementName: readTrim(process.env.DUODIANDIAN_USER_AGREEMENT_NAME),
    userAgreementPath: normalizePath(process.env.DUODIANDIAN_USER_AGREEMENT_PATH),
    privacyPolicyName: readTrim(process.env.DUODIANDIAN_PRIVACY_POLICY_NAME),
    privacyPolicyPath: normalizePath(process.env.DUODIANDIAN_PRIVACY_POLICY_PATH),
  }
}

function resolveGatewayConfig(config = {}) {
  const env = duodiandianConfigFromEnv()
  const merged = { ...env, ...config }
  merged.partner = readTrim(merged.partner)
  merged.partnerCode = normalizeCode(merged.partnerCode) || merged.partner
  merged.channelCode = normalizeCode(merged.channelCode)
  merged.channelName = readTrim(merged.channelName)
  merged.gatewayRemark = readTrim(merged.gatewayRemark)
  merged.routePrefix = normalizeRoutePrefix(merged.routePrefix)
  merged.h5Origin = readTrim(merged.h5Origin).replace(/\/$/, '')
  merged.portalUsername = readTrim(merged.portalUsername)
  merged.portalPassword = readTrim(merged.portalPassword)
  merged.portalName = readTrim(merged.portalName) || merged.channelName
  merged.userAgreementName = readTrim(merged.userAgreementName)
  merged.userAgreementPath = normalizePath(merged.userAgreementPath)
  merged.privacyPolicyName = readTrim(merged.privacyPolicyName)
  merged.privacyPolicyPath = normalizePath(merged.privacyPolicyPath)
  merged.timestampSkewMs = Number(merged.timestampSkewMs)
  return merged
}

function requireGatewayConfig(config, fields) {
  const missing = fields.filter(field => !readTrim(config[field]))
  if (missing.length > 0) {
    throw new DuodiandianGatewayError(`Duodiandian config missing: ${missing.join(', ')}`, 503)
  }
}

function businessSignValue(value) {
  if (value && typeof value === 'object') {
    return JSON.stringify(value)
  }
  return String(value)
}

function buildBusinessSignSource(payload, signKey, timestamp) {
  const pairs = Object.keys(payload || {})
    .filter(key => nonEmpty(payload[key]))
    .sort()
    .map(key => `${key}=${businessSignValue(payload[key])}`)
  return `${pairs.join('&')}${pairs.length ? '&' : ''}key=${signKey}&timestamp=${timestamp}`
}

function signBusinessPayload(payload, signKey, timestamp) {
  return md5(buildBusinessSignSource(payload, signKey, timestamp))
}

function aesAlgorithmForKey(key) {
  const len = Buffer.byteLength(String(key || ''), 'utf8')
  if (len === 16) return 'aes-128-ecb'
  if (len === 24) return 'aes-192-ecb'
  if (len === 32) return 'aes-256-ecb'
  throw new DuodiandianGatewayError('invalid AES encKey length', 500)
}

function decryptHexJson(hex, encKey) {
  try {
    const decipher = crypto.createDecipheriv(aesAlgorithmForKey(encKey), Buffer.from(encKey), null)
    decipher.setAutoPadding(true)
    const text = Buffer.concat([decipher.update(Buffer.from(String(hex || ''), 'hex')), decipher.final()]).toString('utf8')
    return JSON.parse(text)
  }
  catch (err) {
    throw new DuodiandianGatewayError(`AES data decrypt failed: ${err.message || err}`)
  }
}

function parseDuodiandianEnvelope(body, config, options = {}) {
  const cfg = resolveGatewayConfig(config)
  requireGatewayConfig(cfg, ['partner', 'signKey', 'encKey', 'timestampSkewMs'])
  if (!Number.isFinite(cfg.timestampSkewMs) || cfg.timestampSkewMs <= 0) {
    throw new DuodiandianGatewayError('invalid DUODIANDIAN_TIMESTAMP_SKEW_MS', 503)
  }
  const partner = readTrim(body && body.partner)
  if (partner !== cfg.partner) {
    throw new DuodiandianGatewayError('invalid partner')
  }
  const timestamp = readTrim(body && body.timestamp)
  if (!/^\d{10,17}$/.test(timestamp)) {
    throw new DuodiandianGatewayError('invalid timestamp')
  }
  const now = Number(options.now || Date.now())
  const ts = Number(timestamp)
  const skew = cfg.timestampSkewMs
  if (!Number.isFinite(ts) || Math.abs(now - ts) > skew) {
    throw new DuodiandianGatewayError('timestamp expired')
  }
  const payload = decryptHexJson(body.data, cfg.encKey)
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new DuodiandianGatewayError('decrypted data must be an object')
  }
  const expected = signBusinessPayload(payload, cfg.signKey, timestamp).toLowerCase()
  const actual = readTrim(body && body.sign).toLowerCase()
  if (!actual || actual !== expected) {
    throw new DuodiandianGatewayError('invalid sign')
  }
  return payload
}

function ensureGatewayCollections(db) {
  if (!Array.isArray(db.trafficChannels)) db.trafficChannels = []
  if (!Array.isArray(db.trafficPartners)) db.trafficPartners = []
  if (!Array.isArray(db.partnerGatewayApplications)) db.partnerGatewayApplications = []
  return db.partnerGatewayApplications
}

function ensureDuodiandianChannel(db, config = {}) {
  const cfg = resolveGatewayConfig(config)
  requireGatewayConfig(cfg, ['channelCode', 'channelName'])
  ensureGatewayCollections(db)
  const now = cfg.now || new Date().toISOString()
  let ch = db.trafficChannels.find(item => item && String(item.code) === cfg.channelCode)
  if (!ch) {
    ch = {
      id: `TC-${cfg.channelCode}`,
      code: cfg.channelCode,
      name: cfg.channelName,
      remark: cfg.gatewayRemark,
      disabled: false,
      clickCount: 0,
      createdAt: now,
      updatedAt: now,
    }
    db.trafficChannels.push(ch)
  }
  else {
    ch.name = readTrim(ch.name) || cfg.channelName
    ch.remark = readTrim(ch.remark) || cfg.gatewayRemark
    ch.disabled = Boolean(ch.disabled)
    ch.updatedAt = ch.updatedAt || now
  }
  return ch
}

function ensureDuodiandianPortalPartner(db, config = {}) {
  const cfg = resolveGatewayConfig(config)
  ensureDuodiandianChannel(db, cfg)
  if (!cfg.portalUsername || !cfg.portalPassword) return null
  const now = cfg.now || new Date().toISOString()
  let partner = db.trafficPartners.find(item => item && String(item.username) === cfg.portalUsername)
  if (!partner) {
    partner = {
      id: `TP-${cfg.channelCode}`,
      username: cfg.portalUsername,
      password: cfg.portalPassword,
      name: cfg.portalName || cfg.channelName,
      status: 'active',
      channelCodes: [cfg.channelCode],
      createdAt: now,
      updatedAt: now,
    }
    db.trafficPartners.push(partner)
  }
  else {
    partner.name = partner.name || cfg.portalName || cfg.channelName
    partner.status = partner.status || 'active'
    partner.channelCodes = [cfg.channelCode]
    partner.updatedAt = now
  }
  return partner
}

function makeApplicationId(applyNo) {
  const safe = String(applyNo || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48) || Date.now()
  return `DDD-${safe}`
}

function findApplicationByApplyNo(db, applyNo, config = {}) {
  const cfg = resolveGatewayConfig(config)
  requireGatewayConfig(cfg, ['partnerCode', 'channelCode'])
  ensureGatewayCollections(db)
  return db.partnerGatewayApplications.find(item => item
    && item.partnerCode === cfg.partnerCode
    && item.channel === cfg.channelCode
    && String(item.applyNo) === String(applyNo)) || null
}

function findApplicationByPartnerOrderNo(db, partnerOrderNo, config = {}) {
  const cfg = resolveGatewayConfig(config)
  requireGatewayConfig(cfg, ['partnerCode', 'channelCode'])
  ensureGatewayCollections(db)
  return db.partnerGatewayApplications.find(item => item
    && item.partnerCode === cfg.partnerCode
    && item.channel === cfg.channelCode
    && String(item.partnerOrderNo || '') === String(partnerOrderNo || '')) || null
}

function sanitizeApplySnapshot(payload) {
  return {
    applyNo: readTrim(payload.applyNo),
    userPhoneMasked: maskPhone(payload.userPhone || payload.phone),
    namePresent: Boolean(readTrim(payload.name)),
    idNoMasked: maskIdNo(payload.idNo || payload.idNumber),
    clientType: readTrim(payload.clientType),
    relationsCount: Array.isArray(payload.relations) ? payload.relations.length : 0,
  }
}

function upsertDuodiandianApplication(db, payload, config = {}) {
  const cfg = resolveGatewayConfig(config)
  requireGatewayConfig(cfg, ['partnerCode', 'channelCode', 'channelName'])
  ensureDuodiandianChannel(db, cfg)
  const applyNo = readTrim(payload && payload.applyNo)
  const userPhone = normalizePhone(payload && (payload.userPhone || payload.phone))
  if (!applyNo) throw new DuodiandianGatewayError('applyNo is required')
  if (!userPhone) throw new DuodiandianGatewayError('userPhone is required')
  const now = cfg.now || new Date().toISOString()
  let app = findApplicationByApplyNo(db, applyNo, cfg)
  if (!app) {
    app = {
      id: makeApplicationId(applyNo),
      partnerCode: cfg.partnerCode,
      channel: cfg.channelCode,
      applyNo,
      userPhone,
      partnerOrderNo: '',
      externalStatus: 'APPLIED',
      bindCardStatus: 'UNUSED',
      signStatus: 'UNUSED',
      callbackLogs: [],
      statusHistory: [],
      createdAt: now,
      updatedAt: now,
    }
    db.partnerGatewayApplications.unshift(app)
  }
  else if (app.userPhone && app.userPhone !== userPhone) {
    throw new DuodiandianGatewayError('applyNo already belongs to another phone')
  }
  app.userPhone = userPhone
  app.rawApplyMasked = sanitizeApplySnapshot(payload)
  app.updatedAt = now
  return app
}

function bindPartnerOrderNo(db, applyNo, partnerOrderNo, config = {}) {
  const cfg = resolveGatewayConfig(config)
  const app = findApplicationByApplyNo(db, applyNo, cfg)
  if (!app) throw new DuodiandianGatewayError('applyNo is not bound to configured partner channel')
  const orderNo = readTrim(partnerOrderNo)
  if (!orderNo) throw new DuodiandianGatewayError('partnerOrderNo is required')
  const existing = findApplicationByPartnerOrderNo(db, orderNo, cfg)
  if (existing && existing.applyNo !== app.applyNo) {
    throw new DuodiandianGatewayError('partnerOrderNo is already bound')
  }
  app.partnerOrderNo = orderNo
  app.updatedAt = cfg.now || new Date().toISOString()
  return app
}

function assertCallbackBelongsToDuodiandian(db, payload, config = {}) {
  const cfg = resolveGatewayConfig(config)
  const applyNo = readTrim(payload && payload.applyNo)
  const partnerOrderNo = readTrim(payload && payload.partnerOrderNo)
  if (!applyNo) throw new DuodiandianGatewayError('applyNo is required')
  if (!partnerOrderNo) throw new DuodiandianGatewayError('partnerOrderNo is required')
  const app = findApplicationByApplyNo(db, applyNo, cfg)
  if (!app) throw new DuodiandianGatewayError('applyNo is not bound to configured partner channel')
  if (String(app.partnerOrderNo || '') !== partnerOrderNo) {
    throw new DuodiandianGatewayError('partnerOrderNo is not bound to this applyNo')
  }
  return app
}

function recordDuodiandianCallback(db, type, payload, config = {}) {
  const cfg = resolveGatewayConfig(config)
  const app = assertCallbackBelongsToDuodiandian(db, payload, cfg)
  const now = cfg.now || new Date().toISOString()
  const snapshot = {
    type: String(type || 'callback'),
    at: now,
    applyNo: app.applyNo,
    partnerOrderNo: app.partnerOrderNo,
    status: readTrim(payload.status),
    phoneMasked: maskPhone(payload.phone || payload.userPhone),
  }
  if (!Array.isArray(app.callbackLogs)) app.callbackLogs = []
  app.callbackLogs.push(snapshot)
  if (snapshot.type === 'orderStatus' && snapshot.status) {
    app.externalStatus = snapshot.status
    if (!Array.isArray(app.statusHistory)) app.statusHistory = []
    app.statusHistory.push({ status: snapshot.status, at: now })
  }
  if (snapshot.type === 'bindCard') app.bindCardStatus = 'CALLBACK_RECEIVED'
  if (snapshot.type === 'sign') app.signStatus = 'CALLBACK_RECEIVED'
  app.updatedAt = now
  return app
}

function buildDuodiandianH5Url(db, payload, config = {}) {
  const cfg = resolveGatewayConfig(config)
  requireGatewayConfig(cfg, ['partnerCode', 'channelCode', 'h5Origin'])
  const applyNo = readTrim(payload && payload.applyNo)
  const app = findApplicationByApplyNo(db, applyNo, cfg)
  if (!app) throw new DuodiandianGatewayError('applyNo is not bound to configured partner channel')
  const url = new URL(cfg.h5Origin)
  url.searchParams.set('channel', cfg.channelCode)
  url.searchParams.set('partner', cfg.partnerCode)
  url.searchParams.set('applyNo', app.applyNo)
  return url.toString()
}

function gatewaySuccess(ctx, data = undefined) {
  ctx.status = 200
  ctx.body = data === undefined ? { code: '200', msg: '成功' } : { code: '200', msg: '成功', data }
}

function gatewayFail(ctx, err) {
  const status = err && err.status ? err.status : 400
  ctx.status = status
  ctx.body = { code: String(status), msg: err && err.message ? err.message : '请求失败' }
}

function makePartnerOrderNo(applyNo) {
  return `DDD${md5(String(applyNo)).slice(0, 16).toUpperCase()}`
}

function contractUrl(base, path, channelCode) {
  if (!base) return path
  const url = new URL(path, base)
  url.searchParams.set('channel', channelCode)
  return url.toString()
}

function registerDuodiandianGatewayRoutes(router, deps = {}) {
  const readDb = deps.readDb
  const writeDb = deps.writeDb
  if (typeof readDb !== 'function' || typeof writeDb !== 'function') {
    throw new Error('readDb/writeDb are required')
  }
  const configProvider = typeof deps.configProvider === 'function' ? deps.configProvider : duodiandianConfigFromEnv
  const routeConfig = resolveGatewayConfig(configProvider())
  requireGatewayConfig(routeConfig, ['routePrefix'])

  async function handle(ctx, action) {
    try {
      const config = resolveGatewayConfig(configProvider())
      const payload = parseDuodiandianEnvelope(ctx.request.body || {}, config)
      const db = readDb()
      ensureDuodiandianChannel(db, config)
      const result = await action({ ctx, payload, db, config })
      writeDb(db)
      gatewaySuccess(ctx, result)
    }
    catch (err) {
      gatewayFail(ctx, err)
    }
  }

  const prefix = routeConfig.routePrefix

  async function checkPrefix(ctx) {
    await handle(ctx, async ({ payload, db, config }) => buildDuodiandianCheckPrefixResult(db, payload, config))
  }
  router.post(`${prefix}/checkPrefix`, checkPrefix)
  router.post(`${prefix}/checkPrefIx`, checkPrefix)

  router.post(`${prefix}/contractQuery`, async (ctx) => {
    await handle(ctx, async ({ config }) => {
      requireGatewayConfig(config, ['userAgreementName', 'userAgreementPath', 'privacyPolicyName', 'privacyPolicyPath'])
      const base = readTrim(config.h5Origin).replace(/\/$/, '')
      return [
        {
          contractName: config.userAgreementName,
          contractUrl: contractUrl(base, config.userAgreementPath, config.channelCode),
        },
        {
          contractName: config.privacyPolicyName,
          contractUrl: contractUrl(base, config.privacyPolicyPath, config.channelCode),
        },
      ]
    })
  })

  router.post(`${prefix}/apply`, async (ctx) => {
    await handle(ctx, async ({ payload, db, config }) => {
      const app = upsertDuodiandianApplication(db, payload, config)
      const partnerOrderNo = app.partnerOrderNo || makePartnerOrderNo(app.applyNo)
      bindPartnerOrderNo(db, app.applyNo, partnerOrderNo, config)
      return {
        status: '1',
        partnerOrderNo,
        returnUrl: buildDuodiandianH5Url(db, { applyNo: app.applyNo }, config),
        approvalAmount: '0',
        approvalStatus: 'ING',
      }
    })
  })

  router.post(`${prefix}/getUrl`, async (ctx) => {
    await handle(ctx, async ({ payload, db, config }) => ({
      url: buildDuodiandianH5Url(db, payload, config),
    }))
  })

  router.post(`${prefix}/order/status/notify`, async (ctx) => {
    await handle(ctx, async ({ payload, db, config }) => {
      recordDuodiandianCallback(db, 'orderStatus', payload, config)
      return undefined
    })
  })

  router.post(`${prefix}/order/bindCard/notify`, async (ctx) => {
    await handle(ctx, async ({ payload, db, config }) => {
      recordDuodiandianCallback(db, 'bindCard', payload, config)
      return undefined
    })
  })

  router.post(`${prefix}/order/replayPlan/notify`, async (ctx) => {
    await handle(ctx, async ({ payload, db, config }) => {
      recordDuodiandianCallback(db, 'replayPlan', payload, config)
      return undefined
    })
  })

  router.post(`${prefix}/order/replay/notify`, async (ctx) => {
    await handle(ctx, async ({ payload, db, config }) => {
      recordDuodiandianCallback(db, 'repayment', payload, config)
      return undefined
    })
  })

  router.post(`${prefix}/order/sign/notify`, async (ctx) => {
    await handle(ctx, async ({ payload, db, config }) => {
      recordDuodiandianCallback(db, 'sign', payload, config)
      return undefined
    })
  })
}

module.exports = {
  DuodiandianGatewayError,
  duodiandianConfigFromEnv,
  resolveGatewayConfig,
  signBusinessPayload,
  parseDuodiandianEnvelope,
  ensureDuodiandianChannel,
  ensureDuodiandianPortalPartner,
  upsertDuodiandianApplication,
  bindPartnerOrderNo,
  recordDuodiandianCallback,
  buildDuodiandianH5Url,
  buildDuodiandianCheckPrefixResult,
  isDuodiandianPublicPath,
  registerDuodiandianGatewayRoutes,
}
