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

function makeRespSeq(config, payload, now) {
  return `${config.orderIdPrefix}R${safeIdPart(`${payload.phoneMd5}|${payload.idCardMd5}|${typeof now === 'function' ? now() : Date.now()}`)}`
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

async function handleAppLink({ payload, repository, config }) {
  const orderId = readTrim(payload.applyNo)
  const redirectUrl = readTrim(payload.redirectUrl)
  if (!orderId) throw new ZheyinTrafficError('applyNo is required')
  const row = await repository.findByOrderId(orderId)
  if (!row) throw new ZheyinTrafficError('applyNo not found', 404)
  const template = readTrim(config.loanUrlTemplate) || 'https://example.com/?orderId={orderId}&redirect={redirectUrl}&channel={channel}'
  return {
    loanUrl: template
      .replaceAll('{orderId}', encodeTemplate(orderId))
      .replaceAll('{applyNo}', encodeTemplate(orderId))
      .replaceAll('{redirectUrl}', encodeTemplate(redirectUrl))
      .replaceAll('{channel}', encodeTemplate(config.channel)),
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
}
