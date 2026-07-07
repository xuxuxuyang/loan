const crypto = require('node:crypto')
const { md5, readTrim, ZheyinTrafficError } = require('./crypto')

function nowIso(now) {
  const value = typeof now === 'function' ? now() : Date.now()
  return new Date(Number(value) || Date.now()).toISOString()
}

function compactDateTime(iso) {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return ''
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function addDaysDateTime(iso, days) {
  const d = new Date(iso)
  d.setDate(d.getDate() + Number(days || 0))
  return compactDateTime(d.toISOString())
}

function safeIdPart(value) {
  return md5(value).slice(0, 18).toUpperCase()
}

function maskPhone(value) {
  const phone = String(value || '').replace(/\D/g, '')
  if (phone.length < 7) return phone ? `${phone.slice(0, 2)}***` : ''
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex')
}

function normalizePhone(value) {
  const phone = String(value || '').replace(/\D/g, '')
  if (phone.startsWith('86') && phone.length === 13) return phone.slice(2)
  return phone
}

function makeRespSeq(config, payload, now) {
  return `${config.orderIdPrefix}R${safeIdPart(`${payload.phoneMd5}|${payload.idCardMd5}|${typeof now === 'function' ? now() : Date.now()}`)}`
}

function findExistingZheyinUser(db, payload = {}) {
  const users = Array.isArray(db && db.users) ? db.users : []
  const user = payload.userInfo || {}
  const phone = normalizePhone(user.mobile)
  const idNo = readTrim(user.idCardNo).toUpperCase()
  return users.find(item => item && (
    (phone && normalizePhone(item.phone || item.mobile || item.userPhone) === phone)
    || (idNo && readTrim(item.idNumber || item.idNo || item.idCardNo).toUpperCase() === idNo)
  )) || null
}

function normalizeZheyinContacts(list) {
  return (Array.isArray(list) ? list : [])
    .map(item => ({
      relation: readTrim(item && item.relation),
      name: readTrim(item && item.name),
      phone: normalizePhone(item && item.mobile),
      mobile: normalizePhone(item && item.mobile),
    }))
    .filter(item => item.name && item.phone)
    .slice(0, 2)
}

function makeZheyinMallUser(row, config = {}, now) {
  const payload = row && row.rawApplyPayload ? row.rawApplyPayload : {}
  const user = payload.userInfo || {}
  const idCard = payload.idCardInfo || {}
  const at = nowIso(now)
  const phone = normalizePhone(user.mobile)
  const steps = Array.isArray(row.applyRiskSteps) ? row.applyRiskSteps : []
  const next = {
    id: `U${Date.now()}${Math.floor(Math.random() * 1000)}`,
    name: readTrim(user.name) || '商城用户',
    phone,
    idNumber: readTrim(user.idCardNo).toUpperCase(),
    idCardFront: readTrim(idCard.frontImgUrl),
    idCardBack: readTrim(idCard.backImgUrl),
    idCardHandheld: readTrim(idCard.faceImgUrl),
    locationText: readTrim(user.homeAddress) || readTrim(idCard.address),
    latitude: 0,
    longitude: 0,
    creditStatus: '良好',
    registerAt: at,
    quota: Math.round(Number(config.defaultUserQuota || config.defaultAmount || 2750)),
    adminRemark: '',
    orderBlacklisted: false,
    emergencyContacts: normalizeZheyinContacts(payload.contactList),
    registerChannelCode: readTrim(config.channel),
    registerChannelName: readTrim(config.registerChannelName) || '上海企浩',
    zheyinApplyNo: readTrim(row.orderId || row.applyNo),
    zheyinAdmissionRespSeq: readTrim(row.admissionRespSeq),
    zheyinExternalUserId: readTrim(row.externalUserId),
    zheyinBoundAt: at,
    riskControlSnapshot: {
      configured: true,
      simulated: false,
      passed: true,
      checkedAt: row.auditTime || at,
      summaryMessage: '',
      fourteenRows: steps.map((step, idx) => ({
        slotKey: step && step.key ? step.key : `zheyin_apply_${idx + 1}`,
        productLabel: step && step.label ? step.label : (step && step.key ? step.key : `risk_${idx + 1}`),
        state: step && step.ok ? 'ok' : 'fail',
        error: step && step.error,
        response: step && step.response,
      })),
      rawSteps: JSON.parse(JSON.stringify(steps)),
      userId: '',
    },
  }
  next.riskControlSnapshot.userId = next.id
  return next
}

function bindZheyinMallUser(db, row, config = {}, now) {
  if (!db || typeof db !== 'object') return null
  if (!Array.isArray(db.users)) db.users = []
  const payload = row && row.rawApplyPayload ? row.rawApplyPayload : {}
  const at = nowIso(now)
  let user = findExistingZheyinUser(db, payload)
  if (user) {
    user.zheyinApplyNo = readTrim(row.orderId || row.applyNo)
    user.zheyinAdmissionRespSeq = readTrim(row.admissionRespSeq)
    user.zheyinExternalUserId = readTrim(row.externalUserId)
    user.zheyinBoundAt = user.zheyinBoundAt || at
    if (!readTrim(user.registerChannelCode)) user.registerChannelCode = readTrim(config.channel)
    if (!readTrim(user.registerChannelName)) user.registerChannelName = readTrim(config.registerChannelName) || '上海企浩'
    return user
  }
  user = makeZheyinMallUser(row, config, now)
  db.users.unshift(user)
  return user
}

function issueZheyinLoginToken(row, now = Date.now()) {
  if (!row || typeof row !== 'object') return ''
  if (row.loginTokenHash && !row.loginTokenConsumedAt) return ''
  const token = crypto.randomBytes(24).toString('hex')
  row.loginTokenHash = sha256(token)
  row.loginTokenIssuedAt = new Date(Number(now) || Date.now()).toISOString()
  row.loginTokenConsumedAt = ''
  return token
}

function verifyZheyinLoginToken(row, token, maxAgeMs = 10 * 60 * 1000, now = Date.now()) {
  if (!row || !readTrim(token) || !row.loginTokenHash) {
    throw new ZheyinTrafficError('login token is invalid', 400)
  }
  if (row.loginTokenConsumedAt) {
    throw new ZheyinTrafficError('login token already used', 400)
  }
  const issuedAtMs = Date.parse(String(row.loginTokenIssuedAt || ''))
  const nowMs = Number(now) || Date.now()
  if (!Number.isFinite(issuedAtMs) || nowMs - issuedAtMs > Number(maxAgeMs || 0)) {
    throw new ZheyinTrafficError('login token expired', 400)
  }
  if (sha256(readTrim(token)) !== row.loginTokenHash) {
    throw new ZheyinTrafficError('login token verification failed', 400)
  }
  if (Number(row.auditStatus) !== 1) {
    throw new ZheyinTrafficError(Number(row.auditStatus) === 4 ? 'credit rejected' : 'credit pending', Number(row.auditStatus) === 4 ? 403 : 409)
  }
}

function sanitizeZheyinLoginUser(user) {
  if (!user || typeof user !== 'object') return user
  return {
    id: readTrim(user.id),
    name: readTrim(user.name),
    phone: normalizePhone(user.phone),
    idNumber: readTrim(user.idNumber),
    idCardFront: readTrim(user.idCardFront),
    idCardBack: readTrim(user.idCardBack),
    idCardHandheld: readTrim(user.idCardHandheld),
    locationText: readTrim(user.locationText),
    creditStatus: user.creditStatus || '良好',
    quota: Number(user.quota || 0),
    registerAt: readTrim(user.registerAt),
    orderBlacklisted: Boolean(user.orderBlacklisted),
    emergencyContacts: Array.isArray(user.emergencyContacts) ? user.emergencyContacts : [],
    emergencyContactsComplete: true,
  }
}

function existingDbHashConflict(db, payload) {
  const phoneMd5 = readTrim(payload.phoneMd5).toLowerCase()
  const idCardMd5 = readTrim(payload.idCardMd5).toLowerCase()
  const users = Array.isArray(db && db.users) ? db.users : []
  for (const user of users) {
    const phone = readTrim(user && (user.phone || user.mobile || user.userPhone))
    const idNo = readTrim(user && (user.idNumber || user.idNo || user.idCardNo))
    if ((phone && md5(phone).toLowerCase() === phoneMd5) || (idNo && md5(idNo).toLowerCase() === idCardMd5)) {
      return true
    }
  }
  return false
}

async function handleAdmission({ payload, db, repository, config, now }) {
  const phoneMd5 = readTrim(payload.phoneMd5).toLowerCase()
  const idCardMd5 = readTrim(payload.idCardMd5).toLowerCase()
  if (!phoneMd5 || !idCardMd5) {
    throw new ZheyinTrafficError('phoneMd5 and idCardMd5 are required')
  }
  const existing = await repository.findByHashes(phoneMd5, idCardMd5)
  if (existing) {
    return { status: '1', respSeq: existing.admissionRespSeq }
  }
  if (existingDbHashConflict(db, { phoneMd5, idCardMd5 })) {
    return { status: '2', respSeq: '' }
  }
  const createdAt = nowIso(now)
  const respSeq = makeRespSeq(config, { phoneMd5, idCardMd5 }, now)
  await repository.upsert({
    id: respSeq,
    channel: config.channel,
    admissionRespSeq: respSeq,
    phoneMd5,
    idCardMd5,
    namePresent: Boolean(readTrim(payload.name)),
    auditStatus: 2,
    notifyLogs: [],
    createdAt,
    updatedAt: createdAt,
  })
  return { status: '1', respSeq }
}

function selectContracts(config, scene) {
  const raw = readTrim(scene)
  const contracts = config.contractsByScene[raw]
    || config.contractsByScene[String(Number(raw))]
    || config.contractsByScene.credit
    || config.contractsByScene.default
    || []
  return Array.isArray(contracts) ? contracts : []
}

async function handleContracts({ payload, config }) {
  if (!readTrim(payload.scene) || !readTrim(payload.applyNo)) {
    throw new ZheyinTrafficError('scene and applyNo are required')
  }
  return { contractList: selectContracts(config, payload.scene) }
}

function assertCreditApplyPayload(payload) {
  const user = payload.userInfo || {}
  const idCard = payload.idCardInfo || {}
  const contacts = Array.isArray(payload.contactList) ? payload.contactList : []
  const requiredUser = ['purpose', 'idCardNo', 'name', 'mobile', 'homeAddress', 'marriage', 'degree', 'occupation']
  const requiredId = ['frontImgUrl', 'backImgUrl', 'nation', 'sex', 'address', 'issuedBy', 'validityStart', 'validityEnd', 'faceImgUrl']
  if (!readTrim(payload.applyNo)) throw new ZheyinTrafficError('applyNo is required')
  for (const key of requiredUser) {
    if (!readTrim(user[key])) throw new ZheyinTrafficError(`userInfo.${key} is required`)
  }
  for (const key of requiredId) {
    if (!readTrim(idCard[key])) throw new ZheyinTrafficError(`idCardInfo.${key} is required`)
  }
  if (!contacts.length || contacts.some(item => !readTrim(item && item.relation) || !readTrim(item && item.name) || !readTrim(item && item.mobile))) {
    throw new ZheyinTrafficError('contactList is required')
  }
}

async function handleCreditApply({ payload, repository, config, scheduleAsyncJob, processCreditReview, now }) {
  assertCreditApplyPayload(payload)
  const admission = await repository.findByAdmission(readTrim(payload.applyNo))
  if (!admission) {
    throw new ZheyinTrafficError('applyNo is not a valid admission respSeq')
  }
  const orderId = readTrim(payload.applyNo)
  const at = nowIso(now)
  const next = {
    ...admission,
    id: admission.id,
    orderId,
    applyNo: readTrim(payload.applyNo),
    userPhoneMasked: maskPhone(payload.userInfo.mobile),
    rawApplyPayload: payload,
    auditStatus: 2,
    auditStatusName: 'authing',
    auditTime: '',
    refuseReason: '',
    totalAmount: Number(config.defaultAmount),
    availableAmount: Number(config.defaultAmount),
    periods: config.periods,
    yearRate: config.yearRate,
    type: Number(config.creditType),
    externalCreditId: orderId,
    externalUserId: md5(`${config.channel}|${payload.userInfo.mobile}`).slice(0, 24).toUpperCase(),
    updatedAt: at,
  }
  await repository.upsert(next)
  if (typeof scheduleAsyncJob === 'function' && typeof processCreditReview === 'function') {
    scheduleAsyncJob(() => processCreditReview(orderId))
  }
  return { status: 1, resultDesc: '授信进件申请已受理', orderId }
}

function toCreditResult(row, config) {
  const auditTime = row.auditTime || compactDateTime(row.updatedAt || row.createdAt || new Date().toISOString())
  const pass = Number(row.auditStatus) === 1
  return {
    applyNo: row.orderId,
    auditStatus: Number(row.auditStatus || 2),
    auditTime,
    ...(pass ? {
      expireTime: row.expireTime || addDaysDateTime(row.updatedAt || row.createdAt || new Date().toISOString(), config.creditExpireDays),
      periods: Array.isArray(row.periods) ? row.periods : config.periods,
      totalAmount: Number(row.totalAmount || config.defaultAmount),
      availableAmount: Number(row.availableAmount || config.defaultAmount),
      type: Number(row.type || config.creditType),
      refuseReason: row.refuseReason || '',
      yearRate: row.yearRate || config.yearRate,
      externalCreditId: row.externalCreditId || row.orderId,
      externalUserId: row.externalUserId || '',
    } : {
      refuseReason: row.refuseReason || '',
      yearRate: row.yearRate || config.yearRate,
      externalCreditId: row.externalCreditId || row.orderId,
      externalUserId: row.externalUserId || '',
    }),
  }
}

async function handleCreditQuery({ payload, repository, config }) {
  const orderId = readTrim(payload.applyNo)
  if (!orderId) throw new ZheyinTrafficError('applyNo is required')
  const row = await repository.findByOrderId(orderId)
  if (!row) throw new ZheyinTrafficError('applyNo not found', 404)
  return toCreditResult(row, config)
}

function encodeTemplate(value) {
  return encodeURIComponent(String(value || ''))
}

function buildAppLink(template, values) {
  return template
    .replaceAll('{orderId}', encodeTemplate(values.orderId))
    .replaceAll('{applyNo}', encodeTemplate(values.orderId))
    .replaceAll('{redirectUrl}', encodeTemplate(values.redirectUrl))
    .replaceAll('{channel}', encodeTemplate(values.channel))
    .replaceAll('{token}', encodeTemplate(values.token))
    .replaceAll('{consumePath}', encodeTemplate(values.consumePath))
}

async function handleAppLink({ payload, repository, config, now, db, writeDbPartial, writeDb, flushMongoPersist }) {
  const orderId = readTrim(payload.applyNo)
  const redirectUrl = readTrim(payload.redirectUrl)
  if (!orderId) throw new ZheyinTrafficError('applyNo is required')
  const row = await repository.findByOrderId(orderId)
  if (!row) throw new ZheyinTrafficError('applyNo not found', 404)
  if (Number(row.auditStatus) !== 1) throw new ZheyinTrafficError('credit is not approved', 409)
  if (!readTrim(row.mallUserId) && db) {
    const user = bindZheyinMallUser(db, row, config, now)
    if (user && readTrim(user.id)) {
      row.mallUserId = readTrim(user.id)
      row.mallUserPhone = normalizePhone(user.phone)
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
  if (!readTrim(row.mallUserId)) throw new ZheyinTrafficError('mall user is not ready', 409)
  let token = issueZheyinLoginToken(row, typeof now === 'function' ? now() : Date.now())
  if (!token && row.loginTokenHash && !row.loginTokenConsumedAt) {
    row.loginTokenConsumedAt = new Date(typeof now === 'function' ? Number(now()) : Date.now()).toISOString()
    token = issueZheyinLoginToken(row, typeof now === 'function' ? now() : Date.now())
  }
  await repository.upsert(row)
  const consumePath = `/api${config.routePrefix}/login/consume`
  const template = readTrim(config.loanUrlTemplate) || 'https://example.com/login?trafficLogin=1&channel={channel}&applyNo={orderId}&token={token}&consumePath={consumePath}&redirect={redirectUrl}'
  return {
    loanUrl: buildAppLink(template, {
      orderId,
      redirectUrl,
      channel: config.channel,
      token,
      consumePath,
    }),
  }
}

module.exports = {
  compactDateTime,
  addDaysDateTime,
  handleAdmission,
  handleContracts,
  handleCreditApply,
  handleCreditQuery,
  handleAppLink,
  toCreditResult,
  bindZheyinMallUser,
  issueZheyinLoginToken,
  verifyZheyinLoginToken,
  sanitizeZheyinLoginUser,
  normalizePhone,
}
