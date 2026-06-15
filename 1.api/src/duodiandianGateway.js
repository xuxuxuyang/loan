const crypto = require('node:crypto')

class DuodiandianGatewayError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.name = 'DuodiandianGatewayError'
    this.status = status
  }
}

const outboundNotifySentKeys = new Set()
const DUODIANDIAN_APPLICATION_WRITE_KEYS = ['partnerGatewayApplications', 'trafficChannels', 'trafficPartners']
const DUODIANDIAN_AUTO_REGISTER_WRITE_KEYS = ['partnerGatewayApplications', 'trafficChannels', 'trafficPartners', 'users']
const DUODIANDIAN_CALLBACK_WRITE_KEYS = ['partnerGatewayApplications']
const DEFAULT_DUODIANDIAN_NOTIFY_TIMEOUT_MS = 8000
const DEFAULT_DUODIANDIAN_RISK_TIMEOUT_MS = 15000

function nonEmpty(value) {
  return value !== undefined && value !== null && value !== ''
}

function md5(input) {
  return crypto.createHash('md5').update(input, 'utf8').digest('hex')
}

function sha256(input) {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex')
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

function resolveDuodiandianMongoRefreshPlan(method, pathValue, config = {}) {
  const methodValue = String(method || 'GET').toUpperCase()
  if (methodValue !== 'POST') return null
  const cfg = resolveGatewayConfig(config)
  const prefix = normalizeRoutePrefix(cfg.routePrefix)
  const path = normalizePath(pathValue)
  if (!prefix || !path || !isDuodiandianPublicPath(path, cfg)) return null
  const endpoint = path.slice(prefix.length) || '/'
  if (endpoint === '/contractQuery') {
    return { mode: 'skip' }
  }
  if (endpoint === '/checkPrefix' || endpoint === '/checkPrefIx') {
    return { mode: 'partial', keys: ['users', 'orders', 'partnerGatewayApplications'], allowColdPartial: true }
  }
  if (endpoint === '/getUrl') {
    return { mode: 'partial', keys: ['partnerGatewayApplications'], allowColdPartial: true }
  }
  if (endpoint === '/autoLogin') {
    return { mode: 'partial', keys: ['partnerGatewayApplications', 'users'], allowColdPartial: true }
  }
  if (endpoint === '/apply') {
    return {
      mode: 'partial',
      keys: cfg.applyAutoRegisterEnabled ? DUODIANDIAN_AUTO_REGISTER_WRITE_KEYS : DUODIANDIAN_APPLICATION_WRITE_KEYS,
      allowColdPartial: true,
    }
  }
  if (endpoint === '/order/status/notify'
    || endpoint === '/order/bindCard/notify'
    || endpoint === '/order/replayPlan/notify'
    || endpoint === '/order/replay/notify'
    || endpoint === '/order/sign/notify') {
    return { mode: 'partial', keys: DUODIANDIAN_CALLBACK_WRITE_KEYS, allowColdPartial: true }
  }
  return { mode: 'full' }
}

function normalizePath(value) {
  const raw = readTrim(value)
  if (!raw) return ''
  return raw.startsWith('/') ? raw : `/${raw}`
}

function deriveStatusNotifyUrl(value) {
  const url = readTrim(value)
  if (!url) return ''
  if (url.includes('/open/order/replay/notify')) {
    return url.replace('/open/order/replay/notify', '/open/order/status/notify')
  }
  if (url.includes('/order/replay/notify')) {
    return url.replace('/order/replay/notify', '/order/status/notify')
  }
  return ''
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

function pushMatchingPhoneMd5(target, value, prefix) {
  const phone = normalizePhone(value)
  if (phoneStartsWithPrefix(phone, prefix)) {
    target.add(md5(phone))
  }
}

function collectBlockingUserPhoneMd5(db, prefix, target) {
  for (const user of (Array.isArray(db.users) ? db.users : [])) {
    if (!user || typeof user !== 'object') continue
    pushMatchingPhoneMd5(target, user.phone || user.mobile || user.userPhone, prefix)
  }
}

function collectBlockingOrderPhoneMd5(db, prefix, target) {
  for (const order of (Array.isArray(db.orders) ? db.orders : [])) {
    const phones = collectOrderPhones(order)
    for (const phone of phones) {
      pushMatchingPhoneMd5(target, phone, prefix)
    }
  }
}

function collectBlockingApplicationPhoneMd5(db, prefix, config = {}, target) {
  const cfg = resolveGatewayConfig(config)
  for (const app of (Array.isArray(db.partnerGatewayApplications) ? db.partnerGatewayApplications : [])) {
    if (!app || typeof app !== 'object') continue
    const appPartner = normalizeCode(app.partnerCode)
    const appChannel = normalizeCode(app.channel)
    const isCurrentPartner = appPartner === cfg.partnerCode && appChannel === cfg.channelCode
    if (!isCurrentPartner) continue
    pushMatchingPhoneMd5(target, app.userPhone || app.phone, prefix)
  }
}

function collectBlockingPhoneMd5(db, prefix, config = {}) {
  const matches = new Set()
  collectBlockingUserPhoneMd5(db, prefix, matches)
  collectBlockingOrderPhoneMd5(db, prefix, matches)
  collectBlockingApplicationPhoneMd5(db, prefix, config, matches)
  return [...matches]
}

function buildDuodiandianCheckPrefixResult(db, payload, config = {}) {
  const prefix = normalizePhone(payload && (payload.phone_pre || payload.phonePre || payload.phonePrefix))
  if (prefix.length < 3) {
    return { check_ret: 'N', phone_md5: [] }
  }
  const phoneMd5 = collectBlockingPhoneMd5(db, prefix, config)
  return { check_ret: phoneMd5.length > 0 ? 'N' : 'Y', phone_md5: phoneMd5 }
}

function duodiandianConfigFromEnv() {
  const partner = readTrim(process.env.DUODIANDIAN_PARTNER)
  const channelCode = normalizeCode(process.env.DUODIANDIAN_CHANNEL_CODE)
  return {
    partner,
    partnerCode: normalizeCode(process.env.DUODIANDIAN_PARTNER_CODE) || partner,
    signKey: readTrim(process.env.DUODIANDIAN_SIGN_KEY),
    encKey: readTrim(process.env.DUODIANDIAN_ENC_KEY),
    replayNotifyUrl: readTrim(process.env.DUODIANDIAN_REPLAY_NOTIFY_URL || process.env.DUODIANDIAN_CALLBACK_URL),
    statusNotifyUrl: readTrim(process.env.DUODIANDIAN_STATUS_NOTIFY_URL || process.env.DUODIANDIAN_AUDIT_NOTIFY_URL),
    yearlyRate: readTrim(process.env.DUODIANDIAN_YEARLY_RATE),
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
    applyAutoRegisterEnabled: readTrim(process.env.DUODIANDIAN_APPLY_AUTO_REGISTER_ENABLED),
    autoLoginTicketTtlMs: readTrim(process.env.DUODIANDIAN_AUTO_LOGIN_TICKET_TTL_MS),
    notifyTimeoutMs: readTrim(process.env.DUODIANDIAN_NOTIFY_TIMEOUT_MS),
    applyRiskTimeoutMs: readTrim(process.env.DUODIANDIAN_APPLY_RISK_TIMEOUT_MS),
    sandboxEnabled: readTrim(process.env.DUODIANDIAN_SANDBOX_ENABLED),
    sandboxApplyPrefix: readTrim(process.env.DUODIANDIAN_SANDBOX_APPLY_PREFIX),
    sandboxPhoneWhitelist: readTrim(process.env.DUODIANDIAN_SANDBOX_PHONE_WHITELIST),
    sandboxMockRiskPass: readTrim(process.env.DUODIANDIAN_SANDBOX_MOCK_RISK_PASS),
    sandboxTransferImages: readTrim(process.env.DUODIANDIAN_SANDBOX_TRANSFER_IMAGES),
    sandboxNotifyEnabled: readTrim(process.env.DUODIANDIAN_SANDBOX_NOTIFY_ENABLED),
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
  merged.replayNotifyUrl = readTrim(merged.replayNotifyUrl || merged.callbackUrl)
  merged.statusNotifyUrl = readTrim(merged.statusNotifyUrl || merged.auditNotifyUrl)
    || deriveStatusNotifyUrl(merged.replayNotifyUrl)
  merged.yearlyRate = readTrim(merged.yearlyRate) || '0%'
  merged.h5Origin = readTrim(merged.h5Origin).replace(/\/$/, '')
  merged.portalUsername = readTrim(merged.portalUsername)
  merged.portalPassword = readTrim(merged.portalPassword)
  merged.portalName = readTrim(merged.portalName) || merged.channelName
  merged.userAgreementName = readTrim(merged.userAgreementName)
  merged.userAgreementPath = normalizePath(merged.userAgreementPath)
  merged.privacyPolicyName = readTrim(merged.privacyPolicyName)
  merged.privacyPolicyPath = normalizePath(merged.privacyPolicyPath)
  merged.applyAutoRegisterEnabled = parseBooleanFlag(merged.applyAutoRegisterEnabled)
  merged.autoLoginTicketTtlMs = positiveNumber(merged.autoLoginTicketTtlMs, 10 * 60 * 1000)
  merged.notifyTimeoutMs = positiveNumber(merged.notifyTimeoutMs, DEFAULT_DUODIANDIAN_NOTIFY_TIMEOUT_MS)
  merged.applyRiskTimeoutMs = positiveNumber(merged.applyRiskTimeoutMs, DEFAULT_DUODIANDIAN_RISK_TIMEOUT_MS)
  merged.sandboxEnabled = parseBooleanFlag(merged.sandboxEnabled)
  merged.sandboxApplyPrefix = readTrim(merged.sandboxApplyPrefix) || 'TEST_'
  merged.sandboxPhoneWhitelist = readTrim(merged.sandboxPhoneWhitelist)
  merged.sandboxMockRiskPass = merged.sandboxMockRiskPass === undefined || merged.sandboxMockRiskPass === ''
    ? true
    : parseBooleanFlag(merged.sandboxMockRiskPass)
  merged.sandboxTransferImages = parseBooleanFlag(merged.sandboxTransferImages)
  merged.sandboxNotifyEnabled = parseBooleanFlag(merged.sandboxNotifyEnabled)
  merged.timestampSkewMs = Number(merged.timestampSkewMs)
  return merged
}

function parseBooleanFlag(value) {
  const v = String(value || '').trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes' || v === 'on'
}

function positiveNumber(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

function promiseWithTimeout(promise, timeoutMs, message, abortController = null) {
  let timer = null
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      if (abortController && typeof abortController.abort === 'function') {
        abortController.abort()
      }
      reject(new Error(message || 'operation timeout'))
    }, positiveNumber(timeoutMs, 1000))
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
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

function encryptJsonToHex(payload, encKey) {
  const cipher = crypto.createCipheriv(aesAlgorithmForKey(encKey), Buffer.from(encKey), null)
  cipher.setAutoPadding(true)
  return Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]).toString('hex').toUpperCase()
}

function buildDuodiandianNotifyEnvelope(payload, config = {}, options = {}) {
  const cfg = resolveGatewayConfig(config)
  requireGatewayConfig(cfg, ['partner', 'signKey', 'encKey'])
  const timestamp = readTrim(options.timestamp) || String(Date.now())
  return {
    partner: cfg.partner,
    data: encryptJsonToHex(payload, cfg.encKey),
    timestamp,
    sign: signBusinessPayload(payload, cfg.signKey, timestamp),
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

function normalizeApplyRiskSubject(payload = {}) {
  const userName = readTrim(payload.name || payload.userName || payload.realName)
  const phoneNumber = normalizePhone(payload.userPhone || payload.phone || payload.mobile || payload.phoneNumber)
  const idNumber = readTrim(payload.idNo || payload.idNumber || payload.id_card || payload.idCardNo).toUpperCase()
  return {
    userName,
    phoneNumber: phoneNumber.startsWith('86') && phoneNumber.length === 13 ? phoneNumber.slice(2) : phoneNumber,
    idNumber,
  }
}

function applyRiskIdentityHash(subject = {}) {
  const userName = readTrim(subject.userName)
  const phoneNumber = normalizePhone(subject.phoneNumber)
  const idNumber = readTrim(subject.idNumber).toUpperCase()
  if (!userName || !/^1\d{10}$/.test(phoneNumber) || !idNumber) {
    return ''
  }
  return sha256([userName, phoneNumber, idNumber].join('|'))
}

function summarizeRiskSteps(steps) {
  return (Array.isArray(steps) ? steps : []).map(s => ({
    key: s && s.key,
    state: s && s.skipped ? 'skipped' : (s && s.ok ? 'ok' : 'fail'),
    label: s && s.label,
    error: s && s.error,
  }))
}

const DUODIANDIAN_REQUIRED_APPLY_FIELDS = Object.freeze([
  'applyNo',
  'applyIp',
  'userPhone',
  'idNo',
  'name',
  'frontImage',
  'backImage',
  'gender',
  'clientType',
  'relations',
])

const DUODIANDIAN_PROFILE_FIELDS = Object.freeze([
  'applyNo',
  'applyIp',
  'userPhone',
  'idNo',
  'name',
  'frontImage',
  'backImage',
  'faceImg',
  'gender',
  'nation',
  'authority',
  'validDate',
  'address',
  'education',
  'marriedStatus',
  'homeAddress',
  'companyName',
  'companyAddress',
  'clientType',
  'relations',
])

function normalizeDuodiandianRelations(value) {
  if (!Array.isArray(value)) return []
  return value.map(item => ({
    name: readTrim(item && item.name),
    phone: normalizePhone(item && item.phone),
    relation: readTrim(item && item.relation),
  })).filter(item => item.name || item.phone || item.relation)
}

function normalizeDuodiandianApplyPayload(payload = {}) {
  const out = {}
  for (const key of DUODIANDIAN_PROFILE_FIELDS) {
    if (key === 'relations') {
      out.relations = normalizeDuodiandianRelations(payload.relations)
    }
    else {
      out[key] = readTrim(payload[key])
    }
  }
  out.userPhone = normalizePhone(out.userPhone || payload.phone)
  out.idNo = readTrim(out.idNo || payload.idNumber).toUpperCase()
  return out
}

function validateDuodiandianApplyProfile(profile) {
  const missing = []
  for (const key of DUODIANDIAN_REQUIRED_APPLY_FIELDS) {
    if (key === 'relations') {
      if (!Array.isArray(profile.relations) || profile.relations.length < 1) missing.push(key)
    }
    else if (!readTrim(profile[key])) {
      missing.push(key)
    }
  }
  if (missing.length) {
    throw new DuodiandianGatewayError(`duodiandian apply missing required fields: ${missing.join(', ')}`)
  }
  if (!/^1\d{10}$/.test(profile.userPhone)) {
    throw new DuodiandianGatewayError('userPhone is invalid')
  }
  if (!profile.relations.every(item => item.name && /^1\d{10}$/.test(item.phone) && item.relation)) {
    throw new DuodiandianGatewayError('relations must include name, phone and relation')
  }
  return profile
}

function publicUserForMallLogin(user) {
  if (!user || typeof user !== 'object') return null
  const clone = { ...user }
  delete clone.passwordHash
  return clone
}

function generateAutoLoginTicket(nowMs, ttlMs) {
  const ticket = crypto.randomBytes(24).toString('base64url')
  return {
    ticket,
    hash: sha256(ticket),
    expiresAt: new Date(Number(nowMs) + positiveNumber(ttlMs, 10 * 60 * 1000)).toISOString(),
  }
}

function nowFromOption(options = {}) {
  return typeof options.now === 'function' ? Number(options.now()) : Date.now()
}

function csvSet(value) {
  return new Set(readTrim(value).split(',').map(item => readTrim(item)).filter(Boolean))
}

function isDuodiandianSandboxApply(payload, config = {}) {
  const cfg = resolveGatewayConfig(config)
  if (!cfg.sandboxEnabled) return false
  const applyNo = readTrim(payload && payload.applyNo)
  return Boolean(applyNo && applyNo.startsWith(cfg.sandboxApplyPrefix))
}

function buildSandboxMallUser(profile, app, config = {}) {
  return publicUserForMallLogin({
    id: `SANDBOX-${profile.applyNo}`,
    name: profile.name || '点多多沙箱用户',
    phone: profile.userPhone,
    idNumber: profile.idNo,
    idCardFront: readTrim(app.sandboxTransferredImages && app.sandboxTransferredImages.front && app.sandboxTransferredImages.front.url) || profile.frontImage,
    idCardBack: readTrim(app.sandboxTransferredImages && app.sandboxTransferredImages.back && app.sandboxTransferredImages.back.url) || profile.backImage,
    idCardHandheld: readTrim(app.sandboxTransferredImages && app.sandboxTransferredImages.face && app.sandboxTransferredImages.face.url) || profile.faceImg,
    registerChannelCode: config.channelCode,
    registerChannelName: config.channelName,
    emergencyContacts: profile.relations.map(item => ({ ...item })),
    partnerProfiles: {
      duodiandian: {
        sandbox: true,
        raw: { ...profile, relations: profile.relations.map(item => ({ ...item })) },
        idCardHandheldSource: profile.faceImg ? 'faceImg' : '',
        applyNo: app.applyNo,
        partnerOrderNo: app.partnerOrderNo,
        riskReviewStatus: app.riskReviewStatus,
        riskReviewReason: app.riskReviewReason || '',
      },
    },
  })
}

function createDuodiandianMallUser(db, app, profile, transferredImages, riskResult, config = {}, options = {}) {
  if (!Array.isArray(db.users)) db.users = []
  const nowMs = nowFromOption(options)
  const nowIso = new Date(nowMs).toISOString()
  const id = `U${nowMs}${crypto.randomBytes(3).toString('hex')}`
  const images = transferredImages || {}
  const front = images.front && images.front.url ? images.front.url : ''
  const back = images.back && images.back.url ? images.back.url : ''
  const face = images.face && images.face.url ? images.face.url : ''
  const user = {
    id,
    name: profile.name || '商城用户',
    phone: profile.userPhone,
    idNumber: profile.idNo,
    idCardFront: front,
    idCardBack: back,
    idCardHandheld: face,
    locationText: profile.homeAddress || profile.address || '',
    latitude: 0,
    longitude: 0,
    creditStatus: '待风控',
    registerAt: nowIso,
    quota: 0,
    adminRemark: '',
    orderBlacklisted: false,
    registerChannelCode: config.channelCode,
    registerChannelName: config.channelName,
    emergencyContacts: profile.relations.map(item => ({ ...item })),
    partnerProfiles: {
      duodiandian: {
        raw: { ...profile, relations: profile.relations.map(item => ({ ...item })) },
        images: {
          front: buildTransferredImageSnapshot(profile.frontImage, images.front),
          back: buildTransferredImageSnapshot(profile.backImage, images.back),
          face: buildTransferredImageSnapshot(profile.faceImg, images.face),
        },
        idCardHandheldSource: face ? 'faceImg' : '',
        applyNo: app.applyNo,
        partnerOrderNo: app.partnerOrderNo,
        riskReviewStatus: riskResult && riskResult.status,
        riskReviewReason: riskResult && riskResult.reason || '',
        riskReviewStepsSummary: Array.isArray(app.riskReviewStepsSummary) ? app.riskReviewStepsSummary : [],
        savedAt: nowIso,
      },
    },
  }
  db.users.unshift(user)
  app.mallUserId = user.id
  app.mallUserPhone = user.phone
  app.mallUserCreatedAt = nowIso
  return user
}

function buildTransferredImageSnapshot(originalUrl, transferred) {
  return {
    originalUrl: readTrim(originalUrl),
    transferredUrl: readTrim(transferred && transferred.url),
    contentType: readTrim(transferred && transferred.contentType),
    size: Number(transferred && transferred.size) || 0,
    key: readTrim(transferred && transferred.key),
    transferredAt: readTrim(transferred && transferred.transferredAt) || (transferred ? new Date().toISOString() : ''),
  }
}

async function transferDuodiandianApplyImages(profile, transferPartnerImage, options = {}) {
  if (typeof transferPartnerImage !== 'function') {
    throw new DuodiandianGatewayError('duodiandian image transfer is not configured', 503)
  }
  const tasks = [
    ['front', profile.frontImage],
    ['back', profile.backImage],
  ]
  if (profile.faceImg) tasks.push(['face', profile.faceImg])
  const out = {}
  await Promise.all(tasks.map(async ([scene, url]) => {
    out[scene] = await transferPartnerImage({
      url,
      scene,
      phone: profile.userPhone,
      applyNo: profile.applyNo,
      now: options.now,
    })
  }))
  return out
}

async function rejectDuodiandianApplication(app, reason, config, options = {}) {
  const nowIso = new Date(nowFromOption(options)).toISOString()
  app.riskReviewSource = 'duodiandian_apply'
  app.riskReviewAt = nowIso
  app.riskReviewStatus = 'REJECT'
  app.riskReviewReason = readTrim(reason) || '风控未通过'
  const notify = await notifyDuodiandianApplyRiskReview({
    app,
    review: { status: 'REJECT', reason: app.riskReviewReason },
    config,
    httpClient: options.httpClient,
    now: options.now,
  })
  app.riskNotifyStatus = notify.sent ? 'SENT' : 'FAILED'
  app.riskNotifyReason = notify.reason
  if (notify.error) app.riskNotifyLastError = notify.error
  return { status: 'REJECT', reason: app.riskReviewReason, notify }
}

async function runDuodiandianAutoRegisterApply(options = {}) {
  const { db, app, payload } = options
  const config = resolveGatewayConfig(options.config || {})
  const profile = validateDuodiandianApplyProfile(normalizeDuodiandianApplyPayload(payload))
  app.duodiandianProfileRaw = { ...profile, relations: profile.relations.map(item => ({ ...item })) }
  app.applyIp = profile.applyIp
  app.clientType = profile.clientType

  const existingAppUser = Array.isArray(db.users)
    ? db.users.find(user => user && (user.id === app.mallUserId || normalizePhone(user.phone) === normalizePhone(app.mallUserPhone || app.userPhone)))
    : null
  if (app.riskReviewStatus === 'PASS' && existingAppUser && normalizePhone(existingAppUser.phone) === profile.userPhone) {
    const nowMs = nowFromOption(options)
    const ticket = generateAutoLoginTicket(nowMs, config.autoLoginTicketTtlMs)
    app.autoLoginTicketHash = ticket.hash
    app.autoLoginTicketExpiresAt = ticket.expiresAt
    app.autoLoginTicketUsedAt = ''
    app.autoLoginTicketIssuedAt = new Date(nowMs).toISOString()
    return { status: 'PASS', reason: '', reused: true, user: existingAppUser, loginTicket: ticket.ticket }
  }

  if (Array.isArray(db.users) && db.users.some(user => normalizePhone(user && user.phone) === profile.userPhone)) {
    return rejectDuodiandianApplication(app, '手机号已注册', config, options)
  }

  let images
  try {
    images = await transferDuodiandianApplyImages(profile, options.transferPartnerImage, options)
    app.imageTransferStatus = 'PASS'
  }
  catch (err) {
    app.imageTransferStatus = 'FAILED'
    app.imageTransferReason = err && err.message ? String(err.message) : String(err)
    return rejectDuodiandianApplication(app, `身份证图片处理失败：${app.imageTransferReason}`, config, options)
  }

  const review = await runDuodiandianApplyRiskReview({
    app,
    payload: { ...payload, userPhone: profile.userPhone, name: profile.name, idNo: profile.idNo },
    config,
    runRiskPack: options.runRiskPack,
    httpClient: options.httpClient,
    now: options.now,
  })

  if (review.status === 'REJECT') {
    return review
  }
  if (review.status !== 'PASS') {
    return rejectDuodiandianApplication(app, review.reason || '风控异常', config, options)
  }

  const user = createDuodiandianMallUser(db, app, profile, images, review, config, options)
  const nowMs = nowFromOption(options)
  const ticket = generateAutoLoginTicket(nowMs, config.autoLoginTicketTtlMs)
  app.autoLoginTicketHash = ticket.hash
  app.autoLoginTicketExpiresAt = ticket.expiresAt
  app.autoLoginTicketUsedAt = ''
  app.autoLoginTicketIssuedAt = new Date(nowMs).toISOString()
  return { ...review, user, loginTicket: ticket.ticket }
}

async function runDuodiandianSandboxApply(options = {}) {
  const { db, app, payload } = options
  const config = resolveGatewayConfig(options.config || {})
  const profile = validateDuodiandianApplyProfile(normalizeDuodiandianApplyPayload(payload))
  const whitelist = csvSet(config.sandboxPhoneWhitelist)
  app.sandbox = true
  app.sandboxMode = 'duodiandian_apply'
  app.sandboxProfileRaw = { ...profile, relations: profile.relations.map(item => ({ ...item })) }
  app.duodiandianProfileRaw = { ...profile, relations: profile.relations.map(item => ({ ...item })) }
  app.applyIp = profile.applyIp
  app.clientType = profile.clientType

  if (whitelist.size > 0 && !whitelist.has(profile.userPhone)) {
    app.riskReviewSource = 'duodiandian_sandbox'
    app.riskReviewAt = new Date(nowFromOption(options)).toISOString()
    app.riskReviewStatus = 'REJECT'
    app.riskReviewReason = 'sandbox phone not allowed'
    return { status: 'REJECT', reason: app.riskReviewReason, sandbox: true }
  }

  if (config.sandboxTransferImages) {
    try {
      app.sandboxTransferredImages = await transferDuodiandianApplyImages(profile, options.transferPartnerImage, options)
      app.imageTransferStatus = 'PASS'
    }
    catch (err) {
      app.imageTransferStatus = 'FAILED'
      app.imageTransferReason = err && err.message ? String(err.message) : String(err)
      app.riskReviewSource = 'duodiandian_sandbox'
      app.riskReviewAt = new Date(nowFromOption(options)).toISOString()
      app.riskReviewStatus = 'REJECT'
      app.riskReviewReason = `sandbox image failed: ${app.imageTransferReason}`
      return { status: 'REJECT', reason: app.riskReviewReason, sandbox: true }
    }
  }

  let review = { status: 'PASS', reason: '' }
  if (!config.sandboxMockRiskPass) {
    review = await runDuodiandianApplyRiskReview({
      app,
      payload: { ...payload, userPhone: profile.userPhone, name: profile.name, idNo: profile.idNo },
      config,
      runRiskPack: options.runRiskPack,
      httpClient: config.sandboxNotifyEnabled ? options.httpClient : null,
      now: options.now,
    })
  }
  else {
    app.riskReviewSource = 'duodiandian_sandbox'
    app.riskReviewAt = new Date(nowFromOption(options)).toISOString()
    app.riskReviewStatus = 'PASS'
    app.riskReviewReason = ''
    app.riskReviewStepsSummary = [{ key: 'sandbox', label: '点多多沙箱风控模拟通过', ok: true }]
  }

  if (review.status !== 'PASS') {
    return { status: 'REJECT', reason: review.reason || 'sandbox risk rejected', sandbox: true }
  }

  const nowMs = nowFromOption(options)
  const ticket = generateAutoLoginTicket(nowMs, config.autoLoginTicketTtlMs)
  app.sandboxAutoLogin = true
  app.mallUserId = `SANDBOX-${profile.applyNo}`
  app.mallUserPhone = profile.userPhone
  app.autoLoginTicketHash = ticket.hash
  app.autoLoginTicketExpiresAt = ticket.expiresAt
  app.autoLoginTicketUsedAt = ''
  app.autoLoginTicketIssuedAt = new Date(nowMs).toISOString()
  app.updatedAt = app.autoLoginTicketIssuedAt
  return { status: 'PASS', reason: '', sandbox: true, loginTicket: ticket.ticket }
}

function consumeDuodiandianAutoLogin(db, payload, config = {}, options = {}) {
  const cfg = resolveGatewayConfig(config)
  const applyNo = readTrim(payload && payload.applyNo)
  const ticket = readTrim(payload && payload.loginTicket)
  if (!applyNo || !ticket) {
    throw new DuodiandianGatewayError('applyNo and loginTicket are required')
  }
  const app = findApplicationByApplyNo(db, applyNo, cfg)
  const sandboxLogin = Boolean(cfg.sandboxEnabled && app && app.sandbox && app.sandboxAutoLogin)
  if (!cfg.applyAutoRegisterEnabled && !sandboxLogin) {
    throw new DuodiandianGatewayError('duodiandian auto login is disabled', 503)
  }
  if (!app || app.riskReviewStatus !== 'PASS') {
    throw new DuodiandianGatewayError('duodiandian application is not approved')
  }
  if (app.autoLoginTicketUsedAt) {
    throw new DuodiandianGatewayError('login ticket already used')
  }
  if (!app.autoLoginTicketHash || sha256(ticket) !== app.autoLoginTicketHash) {
    throw new DuodiandianGatewayError('invalid login ticket')
  }
  const nowMs = nowFromOption(options)
  const expiresMs = new Date(app.autoLoginTicketExpiresAt || 0).getTime()
  if (!Number.isFinite(expiresMs) || expiresMs < nowMs) {
    throw new DuodiandianGatewayError('login ticket expired')
  }
  if (sandboxLogin) {
    const profile = app.sandboxProfileRaw || app.duodiandianProfileRaw
    if (!profile) {
      throw new DuodiandianGatewayError('sandbox profile not found', 404)
    }
    app.autoLoginTicketUsedAt = new Date(nowMs).toISOString()
    app.updatedAt = app.autoLoginTicketUsedAt
    return {
      token: `mock-token-${normalizePhone(profile.userPhone)}`,
      user: buildSandboxMallUser(profile, app, cfg),
    }
  }
  const user = (Array.isArray(db.users) ? db.users : []).find(item => item && item.id === app.mallUserId)
    || (Array.isArray(db.users) ? db.users : []).find(item => normalizePhone(item && item.phone) === normalizePhone(app.mallUserPhone || app.userPhone))
  if (!user) {
    throw new DuodiandianGatewayError('mall user not found', 404)
  }
  app.autoLoginTicketUsedAt = new Date(nowMs).toISOString()
  app.updatedAt = app.autoLoginTicketUsedAt
  return {
    token: `mock-token-${normalizePhone(user.phone)}`,
    user: publicUserForMallLogin(user),
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

function buildApplyRiskNotifyPayload(app, review, config = {}) {
  const cfg = resolveGatewayConfig(config)
  const base = {
    applyNo: readTrim(app && app.applyNo),
    partnerOrderNo: readTrim(app && app.partnerOrderNo),
  }
  if (review.status === 'PASS') {
    return {
      ...base,
      status: 'AUDIT_PASS',
      approvalAmount: '0',
      availableAmount: '0',
      yearlyRate: cfg.yearlyRate,
    }
  }
  if (review.status === 'REJECT') {
    return {
      ...base,
      status: 'AUDIT_REJECT',
      rejectReason: readTrim(review.reason) || '风控未通过',
    }
  }
  throw new DuodiandianGatewayError(`unsupported apply risk notify status: ${review.status}`, 500)
}

async function notifyDuodiandianApplyRiskReview(options = {}) {
  const cfg = resolveGatewayConfig(options.config || {})
  const app = options.app
  const review = options.review || {}
  if (!app || !review || (review.status !== 'PASS' && review.status !== 'REJECT')) {
    return { sent: false, reason: 'invalid_arguments' }
  }
  if (!cfg.statusNotifyUrl) {
    return { sent: false, reason: 'notify_url_missing' }
  }
  const payload = buildApplyRiskNotifyPayload(app, review, cfg)
  const sentKey = `apply-risk:${payload.applyNo}:${payload.status}`
  if (outboundNotifySentKeys.has(sentKey)) {
    return { sent: false, reason: 'duplicate_skipped', payload }
  }
  const timestamp = typeof options.now === 'function' ? String(options.now()) : String(Date.now())
  const envelope = buildDuodiandianNotifyEnvelope(payload, cfg, { timestamp })
  const client = typeof options.httpClient === 'function'
    ? options.httpClient
    : (typeof fetch === 'function' ? fetch : null)
  if (!client) {
    return { sent: false, reason: 'fetch_unavailable', payload }
  }
  const controller = typeof AbortController === 'function' ? new AbortController() : null
  try {
    const resp = await promiseWithTimeout(client(cfg.statusNotifyUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(envelope),
      ...(controller ? { signal: controller.signal } : {}),
    }), cfg.notifyTimeoutMs, 'duodiandian notify timeout', controller)
    const text = await promiseWithTimeout(
      typeof resp.text === 'function'
        ? resp.text()
        : (typeof resp.json === 'function' ? resp.json().then(body => JSON.stringify(body)) : Promise.resolve('')),
      cfg.notifyTimeoutMs,
      'duodiandian notify response timeout',
      controller,
    )
    const body = parseNotifyResponseBody(text)
    const code = body && body.code !== undefined ? String(body.code) : ''
    const accepted = Boolean(resp.ok) && (!code || code === '200')
    if (accepted) {
      outboundNotifySentKeys.add(sentKey)
    }
    return { sent: accepted, reason: accepted ? 'ok' : 'remote_rejected', status: resp.status, body, payload }
  }
  catch (err) {
    return { sent: false, reason: 'request_failed', error: err && err.message ? err.message : String(err), payload }
  }
}

async function runDuodiandianApplyRiskReview(options = {}) {
  const app = options.app
  const payload = options.payload || {}
  if (!app || typeof app !== 'object') {
    throw new DuodiandianGatewayError('application is required', 500)
  }
  const nowIso = new Date(typeof options.now === 'function' ? Number(options.now()) : Date.now()).toISOString()
  const subject = normalizeApplyRiskSubject(payload)
  const identityHash = applyRiskIdentityHash(subject)
  app.riskReviewSource = 'duodiandian_apply'
  app.riskReviewAt = nowIso
  if (!identityHash) {
    app.riskReviewStatus = 'SKIPPED'
    app.riskReviewReason = 'identity data incomplete: requires name, phone and idNumber'
    return { status: 'SKIPPED', reason: app.riskReviewReason }
  }
  if (app.riskReviewIdentityHash === identityHash && ['PASS', 'REJECT', 'ERROR'].includes(String(app.riskReviewStatus || ''))) {
    return { status: app.riskReviewStatus, reused: true, reason: app.riskReviewReason || '' }
  }
  app.riskReviewIdentityHash = identityHash
  if (typeof options.runRiskPack !== 'function') {
    app.riskReviewStatus = 'SKIPPED'
    app.riskReviewReason = 'apply pre-risk runner is not configured'
    return { status: 'SKIPPED', reason: app.riskReviewReason }
  }

  let pack
  try {
    pack = await promiseWithTimeout(
      options.runRiskPack(subject),
      resolveGatewayConfig(options.config || {}).applyRiskTimeoutMs,
      'duodiandian risk pack timeout',
    )
  }
  catch (err) {
    app.riskReviewStatus = 'ERROR'
    app.riskReviewReason = err && err.message ? String(err.message) : String(err)
    app.riskReviewStepsSummary = []
    return { status: 'ERROR', reason: app.riskReviewReason }
  }

  const review = {
    status: pack && pack.allPassed ? 'PASS' : 'REJECT',
    reason: pack && pack.allPassed ? '' : String((pack && pack.message) || '风控未通过'),
  }
  app.riskReviewStatus = review.status
  app.riskReviewReason = review.reason
  app.riskReviewStepsSummary = summarizeRiskSteps(pack && pack.steps)

  const notify = await notifyDuodiandianApplyRiskReview({
    app,
    review,
    config: options.config,
    httpClient: options.httpClient,
    now: options.now,
  })
  app.riskNotifyStatus = notify.sent ? 'SENT' : 'FAILED'
  app.riskNotifyReason = notify.reason
  if (notify.error) {
    app.riskNotifyLastError = notify.error
  }
  else {
    delete app.riskNotifyLastError
  }
  return { status: review.status, reason: review.reason, notify }
}

function findReusableDuodiandianApplyRiskReview(db, subject, config = {}) {
  const cfg = resolveGatewayConfig(config)
  const identityHash = applyRiskIdentityHash(subject)
  if (!identityHash || !db || !Array.isArray(db.partnerGatewayApplications)) {
    return null
  }
  const app = db.partnerGatewayApplications.find(item => item
    && normalizeCode(item.partnerCode) === cfg.partnerCode
    && normalizeCode(item.channel) === cfg.channelCode
    && item.riskReviewIdentityHash === identityHash
    && (item.riskReviewStatus === 'PASS' || item.riskReviewStatus === 'REJECT')) || null
  if (!app) {
    return null
  }
  return {
    app,
    status: app.riskReviewStatus,
    reason: app.riskReviewReason || '',
    checkedAt: app.riskReviewAt || app.updatedAt || app.createdAt || '',
    stepsSummary: Array.isArray(app.riskReviewStepsSummary) ? app.riskReviewStepsSummary : [],
  }
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
  const loginTicket = readTrim(payload && payload.loginTicket)
  if (loginTicket) {
    url.searchParams.set('loginTicket', loginTicket)
    url.searchParams.set('autoLoginPath', `${cfg.routePrefix}/autoLogin`)
  }
  return url.toString()
}

function normalizeMoneyText(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (Number.isInteger(n)) return String(n)
  return String(Number(n.toFixed(2)))
}

function orderNotifyAmount(order) {
  if (!order || typeof order !== 'object') return '0'
  const cardPackageAmount = Number(order.cardPackageAmount)
  if (Number.isFinite(cardPackageAmount) && cardPackageAmount > 0) {
    return normalizeMoneyText(cardPackageAmount)
  }
  return normalizeMoneyText(order.totalAmount)
}

function findDuodiandianApplicationForOrder(db, order, config = {}) {
  const cfg = resolveGatewayConfig(config)
  requireGatewayConfig(cfg, ['partnerCode', 'channelCode'])
  const applications = Array.isArray(db && db.partnerGatewayApplications) ? db.partnerGatewayApplications : []
  const phones = collectOrderPhones(order).map(normalizePhone).filter(Boolean)
  if (!phones.length) return null
  return applications.find((app) => {
    if (!app || typeof app !== 'object') return false
    if (normalizeCode(app.partnerCode) !== cfg.partnerCode) return false
    if (normalizeCode(app.channel) !== cfg.channelCode) return false
    if (!readTrim(app.partnerOrderNo)) return false
    return phones.includes(normalizePhone(app.userPhone || app.phone))
  }) || null
}

function buildDuodiandianOrderNotifyPayload(app, order, event, config = {}) {
  const cfg = resolveGatewayConfig(config)
  const base = {
    applyNo: readTrim(app && app.applyNo),
    partnerOrderNo: readTrim(app && app.partnerOrderNo),
  }
  const amount = orderNotifyAmount(order)
  if (event === 'risk_pass') {
    return {
      ...base,
      status: 'AUDIT_PASS',
      approvalAmount: amount,
      availableAmount: amount,
      yearlyRate: cfg.yearlyRate,
    }
  }
  if (event === 'risk_reject') {
    return {
      ...base,
      status: 'AUDIT_REJECT',
      rejectReason: readTrim(order && order.riskReason) || '风控未通过',
    }
  }
  if (event === 'loan_pass') {
    return {
      ...base,
      status: 'LOAN_PASS',
      withdrawAmount: amount,
    }
  }
  if (event === 'repaid') {
    return {
      ...base,
      status: 'REPAID',
    }
  }
  throw new DuodiandianGatewayError(`unsupported notify event: ${event}`, 500)
}

function parseNotifyResponseBody(text) {
  if (!text) return {}
  try {
    return JSON.parse(text)
  }
  catch {
    return { raw: text }
  }
}

async function notifyDuodiandianOrderEvent(options = {}) {
  const cfg = resolveGatewayConfig(options.config || {})
  const db = options.db
  const order = options.order
  const event = readTrim(options.event)
  if (!db || !order || !event) {
    return { sent: false, reason: 'invalid_arguments' }
  }
  if (!cfg.statusNotifyUrl) {
    return { sent: false, reason: 'notify_url_missing' }
  }
  let app
  try {
    app = findDuodiandianApplicationForOrder(db, order, cfg)
  }
  catch (err) {
    console.warn('[duodiandian-notify] skip:', err && err.message ? err.message : err)
    return { sent: false, reason: 'config_invalid' }
  }
  if (!app) {
    return { sent: false, reason: 'application_not_found' }
  }
  const payload = buildDuodiandianOrderNotifyPayload(app, order, event, cfg)
  const sentKey = `${payload.applyNo}:${payload.status}`
  if (outboundNotifySentKeys.has(sentKey)) {
    return { sent: false, reason: 'duplicate_skipped', payload }
  }
  const timestamp = typeof options.now === 'function' ? String(options.now()) : String(Date.now())
  const envelope = buildDuodiandianNotifyEnvelope(payload, cfg, { timestamp })
  const client = typeof options.httpClient === 'function'
    ? options.httpClient
    : (typeof fetch === 'function' ? fetch : null)
  if (!client) {
    return { sent: false, reason: 'fetch_unavailable', payload }
  }
  try {
    const resp = await client(cfg.statusNotifyUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(envelope),
    })
    const text = typeof resp.text === 'function'
      ? await resp.text()
      : (typeof resp.json === 'function' ? JSON.stringify(await resp.json()) : '')
    const body = parseNotifyResponseBody(text)
    const code = body && body.code !== undefined ? String(body.code) : ''
    const accepted = Boolean(resp.ok) && (!code || code === '200')
    if (!accepted) {
      console.warn('[duodiandian-notify] failed:', event, resp.status, text)
    }
    if (accepted) {
      outboundNotifySentKeys.add(sentKey)
    }
    return { sent: accepted, reason: accepted ? 'ok' : 'remote_rejected', status: resp.status, body, payload }
  }
  catch (err) {
    console.warn('[duodiandian-notify] error:', event, err && err.message ? err.message : err)
    return { sent: false, reason: 'request_failed', error: err && err.message ? err.message : String(err), payload }
  }
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
  const writeDbPartial = typeof deps.writeDbPartial === 'function' ? deps.writeDbPartial : null
  const flushMongoPersist = typeof deps.flushMongoPersist === 'function' ? deps.flushMongoPersist : null
  const runApplyRiskPack = typeof deps.runApplyRiskPack === 'function' ? deps.runApplyRiskPack : null
  const transferPartnerImage = typeof deps.transferPartnerImage === 'function' ? deps.transferPartnerImage : null
  const httpClient = typeof deps.httpClient === 'function' ? deps.httpClient : null
  const now = typeof deps.now === 'function' ? deps.now : null
  if (typeof readDb !== 'function' || typeof writeDb !== 'function') {
    throw new Error('readDb/writeDb are required')
  }
  const configProvider = typeof deps.configProvider === 'function' ? deps.configProvider : duodiandianConfigFromEnv
  const routeConfig = resolveGatewayConfig(configProvider())
  requireGatewayConfig(routeConfig, ['routePrefix'])

  async function handleRead(ctx, action, options = {}) {
    const needsDb = options.needsDb !== false
    try {
      const config = resolveGatewayConfig(configProvider())
      const payload = parseDuodiandianEnvelope(ctx.request.body || {}, config)
      const db = needsDb ? readDb() : undefined
      const result = await action({ ctx, payload, db, config })
      gatewaySuccess(ctx, result)
    }
    catch (err) {
      gatewayFail(ctx, err)
    }
  }

  function gatewayPerfNowMs() {
    return Number(process.hrtime.bigint() / 1000000n)
  }

  function gatewaySlowLogThresholdMs() {
    const raw = Number(process.env.DUODIANDIAN_GATEWAY_SLOW_LOG_MS || 1000)
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0
  }

  function maybeLogGatewayPerf(ctx, marks, extra = {}) {
    const threshold = gatewaySlowLogThresholdMs()
    if (threshold <= 0 || !marks || !marks.start || !marks.end) return
    const totalMs = marks.end - marks.start
    if (totalMs < threshold) return
    console.warn('[duodiandian-gateway-perf]', {
      endpoint: extra.endpoint || ctx.path || '',
      statusCode: ctx.status || 200,
      totalMs,
      parseMs: marks.parseEnd && marks.start ? marks.parseEnd - marks.start : undefined,
      readDbMs: marks.readDbEnd && marks.readDbStart ? marks.readDbEnd - marks.readDbStart : undefined,
      actionMs: marks.actionEnd && marks.actionStart ? marks.actionEnd - marks.actionStart : undefined,
      persistScheduleMs: marks.persistEnd && marks.persistStart ? marks.persistEnd - marks.persistStart : undefined,
      flushMs: marks.flushEnd && marks.flushStart ? marks.flushEnd - marks.flushStart : undefined,
    })
  }

  async function handleWrite(ctx, action, options = {}) {
    const marks = { start: gatewayPerfNowMs() }
    try {
      const config = resolveGatewayConfig(configProvider())
      const endpoint = options.endpoint || ctx.path || ''
      const payload = parseDuodiandianEnvelope(ctx.request.body || {}, config)
      marks.parseEnd = gatewayPerfNowMs()
      marks.readDbStart = gatewayPerfNowMs()
      const db = readDb()
      marks.readDbEnd = gatewayPerfNowMs()
      ensureDuodiandianChannel(db, config)
      marks.actionStart = gatewayPerfNowMs()
      const result = await action({ ctx, payload, db, config })
      marks.actionEnd = gatewayPerfNowMs()
      const persistKeys = Array.isArray(options.persistKeys) ? options.persistKeys : null
      marks.persistStart = gatewayPerfNowMs()
      if (persistKeys && writeDbPartial) {
        writeDbPartial(db, persistKeys)
      }
      else {
        writeDb(db)
      }
      marks.persistEnd = gatewayPerfNowMs()
      if (flushMongoPersist) {
        marks.flushStart = gatewayPerfNowMs()
        await flushMongoPersist()
        marks.flushEnd = gatewayPerfNowMs()
        if (ctx.state) ctx.state.mongoPersistFlushed = true
      }
      gatewaySuccess(ctx, result)
      marks.end = gatewayPerfNowMs()
      maybeLogGatewayPerf(ctx, marks, { endpoint })
    }
    catch (err) {
      gatewayFail(ctx, err)
      marks.end = gatewayPerfNowMs()
      maybeLogGatewayPerf(ctx, marks, { endpoint: options.endpoint || ctx.path || '' })
    }
  }

  async function handleAutoLogin(ctx) {
    const marks = { start: gatewayPerfNowMs() }
    try {
      const config = resolveGatewayConfig(configProvider())
      const endpoint = `${prefix}/autoLogin`
      const body = ctx.request.body || {}
      const payload = body && body.partner && body.data
        ? parseDuodiandianEnvelope(body, config)
        : body
      marks.parseEnd = gatewayPerfNowMs()
      marks.readDbStart = gatewayPerfNowMs()
      const db = readDb()
      marks.readDbEnd = gatewayPerfNowMs()
      marks.actionStart = gatewayPerfNowMs()
      const result = consumeDuodiandianAutoLogin(db, payload, config, { now })
      marks.actionEnd = gatewayPerfNowMs()
      marks.persistStart = gatewayPerfNowMs()
      if (writeDbPartial) {
        writeDbPartial(db, ['partnerGatewayApplications'])
      }
      else {
        writeDb(db)
      }
      marks.persistEnd = gatewayPerfNowMs()
      if (flushMongoPersist) {
        marks.flushStart = gatewayPerfNowMs()
        await flushMongoPersist()
        marks.flushEnd = gatewayPerfNowMs()
        if (ctx.state) ctx.state.mongoPersistFlushed = true
      }
      gatewaySuccess(ctx, result)
      marks.end = gatewayPerfNowMs()
      maybeLogGatewayPerf(ctx, marks, { endpoint })
    }
    catch (err) {
      gatewayFail(ctx, err)
      marks.end = gatewayPerfNowMs()
      maybeLogGatewayPerf(ctx, marks, { endpoint: `${prefix}/autoLogin` })
    }
  }

  const prefix = routeConfig.routePrefix

  async function checkPrefix(ctx) {
    await handleRead(ctx, async ({ payload, db, config }) => buildDuodiandianCheckPrefixResult(db, payload, config))
  }
  router.post(`${prefix}/checkPrefix`, checkPrefix)
  router.post(`${prefix}/checkPrefIx`, checkPrefix)

  router.post(`${prefix}/contractQuery`, async (ctx) => {
    await handleRead(ctx, async ({ config }) => {
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
    }, { needsDb: false })
  })

  router.post(`${prefix}/apply`, async (ctx) => {
    await handleWrite(ctx, async ({ payload, db, config }) => {
      const app = upsertDuodiandianApplication(db, payload, config)
      const partnerOrderNo = app.partnerOrderNo || makePartnerOrderNo(app.applyNo)
      bindPartnerOrderNo(db, app.applyNo, partnerOrderNo, config)
      let autoResult = null
      if (isDuodiandianSandboxApply(payload, config)) {
        autoResult = await runDuodiandianSandboxApply({
          db,
          app,
          payload,
          config,
          runRiskPack: runApplyRiskPack,
          transferPartnerImage,
          httpClient,
          now,
        })
      }
      else if (config.applyAutoRegisterEnabled) {
        autoResult = await runDuodiandianAutoRegisterApply({
          db,
          app,
          payload,
          config,
          runRiskPack: runApplyRiskPack,
          transferPartnerImage,
          httpClient,
          now,
        })
      }
      else {
        await runDuodiandianApplyRiskReview({
          app,
          payload,
          config,
          runRiskPack: runApplyRiskPack,
          httpClient,
          now,
        })
      }
      return {
        status: '1',
        partnerOrderNo,
        returnUrl: buildDuodiandianH5Url(db, {
          applyNo: app.applyNo,
          loginTicket: autoResult && autoResult.loginTicket,
        }, config),
        approvalAmount: '0',
        approvalStatus: autoResult && autoResult.status === 'PASS'
          ? 'SUC'
          : (autoResult && autoResult.status === 'REJECT' ? 'REJECT' : 'ING'),
      }
    }, {
      endpoint: `${prefix}/apply`,
      persistKeys: resolveGatewayConfig(configProvider()).applyAutoRegisterEnabled
        ? DUODIANDIAN_AUTO_REGISTER_WRITE_KEYS
        : DUODIANDIAN_APPLICATION_WRITE_KEYS,
    })
  })

  router.post(`${prefix}/getUrl`, async (ctx) => {
    await handleRead(ctx, async ({ payload, db, config }) => ({
      url: buildDuodiandianH5Url(db, payload, config),
    }))
  })

  router.post(`${prefix}/autoLogin`, handleAutoLogin)

  router.post(`${prefix}/order/status/notify`, async (ctx) => {
    await handleWrite(ctx, async ({ payload, db, config }) => {
      recordDuodiandianCallback(db, 'orderStatus', payload, config)
      return undefined
    }, { endpoint: `${prefix}/order/status/notify`, persistKeys: DUODIANDIAN_CALLBACK_WRITE_KEYS })
  })

  router.post(`${prefix}/order/bindCard/notify`, async (ctx) => {
    await handleWrite(ctx, async ({ payload, db, config }) => {
      recordDuodiandianCallback(db, 'bindCard', payload, config)
      return undefined
    }, { endpoint: `${prefix}/order/bindCard/notify`, persistKeys: DUODIANDIAN_CALLBACK_WRITE_KEYS })
  })

  router.post(`${prefix}/order/replayPlan/notify`, async (ctx) => {
    await handleWrite(ctx, async ({ payload, db, config }) => {
      recordDuodiandianCallback(db, 'replayPlan', payload, config)
      return undefined
    }, { endpoint: `${prefix}/order/replayPlan/notify`, persistKeys: DUODIANDIAN_CALLBACK_WRITE_KEYS })
  })

  router.post(`${prefix}/order/replay/notify`, async (ctx) => {
    await handleWrite(ctx, async ({ payload, db, config }) => {
      recordDuodiandianCallback(db, 'repayment', payload, config)
      return undefined
    }, { endpoint: `${prefix}/order/replay/notify`, persistKeys: DUODIANDIAN_CALLBACK_WRITE_KEYS })
  })

  router.post(`${prefix}/order/sign/notify`, async (ctx) => {
    await handleWrite(ctx, async ({ payload, db, config }) => {
      recordDuodiandianCallback(db, 'sign', payload, config)
      return undefined
    }, { endpoint: `${prefix}/order/sign/notify`, persistKeys: DUODIANDIAN_CALLBACK_WRITE_KEYS })
  })
}

module.exports = {
  DuodiandianGatewayError,
  duodiandianConfigFromEnv,
  resolveGatewayConfig,
  signBusinessPayload,
  buildDuodiandianNotifyEnvelope,
  parseDuodiandianEnvelope,
  ensureDuodiandianChannel,
  ensureDuodiandianPortalPartner,
  upsertDuodiandianApplication,
  runDuodiandianApplyRiskReview,
  notifyDuodiandianApplyRiskReview,
  findReusableDuodiandianApplyRiskReview,
  normalizeApplyRiskSubject,
  applyRiskIdentityHash,
  bindPartnerOrderNo,
  recordDuodiandianCallback,
  buildDuodiandianH5Url,
  buildDuodiandianOrderNotifyPayload,
  findDuodiandianApplicationForOrder,
  notifyDuodiandianOrderEvent,
  buildDuodiandianCheckPrefixResult,
  isDuodiandianPublicPath,
  resolveDuodiandianMongoRefreshPlan,
  registerDuodiandianGatewayRoutes,
}
