const crypto = require('node:crypto')

const { readTrim } = require('./config')
const { HalfFlowTrafficError, md5, sha256 } = require('./crypto')
const { assertAdmissionPayload, assertAppLinkPayload, assertApplyPayload } = require('./schema')

const operationLocks = new Map()

async function withProcessKeyLock(key, action) {
  const previous = operationLocks.get(key) || Promise.resolve()
  let release
  const current = new Promise(resolve => { release = resolve })
  operationLocks.set(key, current)
  await previous
  try {
    return await action()
  }
  finally {
    release()
    if (operationLocks.get(key) === current) operationLocks.delete(key)
  }
}

function withProcessKeyLocks(keys, action) {
  const uniqueKeys = [...new Set(keys.map(String))].sort()
  const run = index => index >= uniqueKeys.length
    ? action()
    : withProcessKeyLock(uniqueKeys[index], () => run(index + 1))
  return run(0)
}

function numericNow(now) {
  const value = typeof now === 'function' ? Number(now()) : Date.now()
  return Number.isFinite(value) ? value : Date.now()
}

function nowIso(now) {
  return new Date(numericNow(now)).toISOString()
}

function existingDbHashConflict(db, payload) {
  const users = Array.isArray(db && db.users) ? db.users : []
  return users.some((user) => {
    const phone = readTrim(user && (user.phone || user.mobile || user.userPhone))
    const idCard = readTrim(user && (user.idNumber || user.idNo || user.idCardNo))
    return (phone && md5(phone) === payload.mobileMd5)
      || (idCard && md5(idCard) === payload.idCardMd5)
  })
}

function admissionResponse(passed, config) {
  return {
    result: passed ? 1 : 0,
    reason: passed ? '' : '用户已存在',
    customerServicePhone: config.customerServicePhone,
  }
}

async function handleHalfFlowAdmission({ payload, db, repository, config, now }) {
  const input = assertAdmissionPayload(payload)
  return withProcessKeyLocks([
    `admission:mobile:${input.mobileMd5}`,
    `admission:id-card:${input.idCardMd5}`,
  ], async () => {
    const samePair = await repository.findByHashes(input.mobileMd5, input.idCardMd5)
    if (samePair && samePair.admissionStatus === 'passed') return admissionResponse(true, config)
    if (await repository.findByEitherHash(input.mobileMd5, input.idCardMd5)) return admissionResponse(false, config)
    if (existingDbHashConflict(db, input)) return admissionResponse(false, config)

    const at = nowIso(now)
    await repository.save({
      id: `HF-${crypto.randomUUID()}`,
      channelCode: config.channelCode,
      mobileMd5: input.mobileMd5,
      idCardMd5: input.idCardMd5,
      admissionStatus: 'passed',
      admissionAt: at,
      notifyLogs: [],
      createdAt: at,
      updatedAt: at,
    })
    return admissionResponse(true, config)
  })
}

function maskPhone(value) {
  const phone = readTrim(value)
  return phone.length >= 7 ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : phone
}

function maskIdCard(value) {
  const idCard = readTrim(value)
  return idCard.length >= 8 ? `${idCard.slice(0, 4)}${'*'.repeat(idCard.length - 8)}${idCard.slice(-4)}` : idCard
}

async function handleHalfFlowApply({ payload, repository, config, now }) {
  const input = assertApplyPayload(payload)
  const mobileMd5 = md5(input.mobile)
  const idCardMd5 = md5(input.idCard)
  return withProcessKeyLocks([
    `apply:order:${input.orderId}`,
    `apply:mobile:${mobileMd5}`,
    `apply:id-card:${idCardMd5}`,
  ], async () => {
    const admission = await repository.findByHashes(mobileMd5, idCardMd5)
    if (!admission || admission.admissionStatus !== 'passed') {
      throw new HalfFlowTrafficError('identity has not passed admission')
    }

    const byOrder = await repository.findByOrderId(input.orderId)
    if (byOrder) {
      if (byOrder.mobileMd5 !== mobileMd5 || byOrder.idCardMd5 !== idCardMd5) {
        throw new HalfFlowTrafficError('orderId belongs to another identity')
      }
      return { data: {}, row: byOrder, shouldNotify: false }
    }
    if (admission.orderId && admission.orderId !== input.orderId) {
      throw new HalfFlowTrafficError('identity belongs to another orderId')
    }

    const atMs = numericNow(now)
    const at = new Date(atMs).toISOString()
    const row = {
      ...admission,
      orderId: input.orderId,
      rawApplyPayload: input,
      userPhoneMasked: maskPhone(input.mobile),
      idCardMasked: maskIdCard(input.idCard),
      creditStatus: 'approved',
      creditAmountYuan: Number(config.defaultAmount),
      creditExpireAt: new Date(atMs + Number(config.creditExpireDays) * 86400000).toISOString(),
      creditDecisionSource: 'half_flow_basic_admission',
      creditApprovedAt: at,
      updatedAt: at,
    }
    await repository.save(row)
    return { data: {}, row, shouldNotify: true }
  })
}

function normalizePhone(value) {
  const phone = readTrim(value).replace(/\D/g, '')
  return phone.startsWith('86') && phone.length === 13 ? phone.slice(2) : phone
}

function findExistingMallUser(db, identity = {}) {
  const mobile = normalizePhone(identity.mobile)
  const idCard = readTrim(identity.idCard).toUpperCase()
  const users = Array.isArray(db && db.users) ? db.users : []
  return users.find((user) => {
    const storedPhone = normalizePhone(user && (user.phone || user.mobile || user.userPhone))
    const storedIdCard = readTrim(user && (user.idNumber || user.idNo || user.idCardNo)).toUpperCase()
    return (mobile && storedPhone === mobile) || (idCard && storedIdCard === idCard)
  }) || null
}

function mapHalfFlowContacts(contactInfos) {
  return [
    {
      name: readTrim(contactInfos.commonName),
      phone: normalizePhone(contactInfos.commonPhone),
      mobile: normalizePhone(contactInfos.commonPhone),
      relation: String(contactInfos.commonRelationship),
    },
    {
      name: readTrim(contactInfos.emergentName),
      phone: normalizePhone(contactInfos.emergentPhone),
      mobile: normalizePhone(contactInfos.emergentPhone),
      relation: String(contactInfos.emergentRelationship),
    },
  ]
}

function makeHalfFlowMallUser(row, config, now, suppliedId) {
  const input = row.rawApplyPayload
  const atMs = numericNow(now)
  const at = new Date(atMs).toISOString()
  return {
    id: readTrim(suppliedId) || `U${atMs}${crypto.randomInt(1000, 10000)}`,
    name: readTrim(input.name),
    phone: normalizePhone(input.mobile),
    idNumber: readTrim(input.idCard).toUpperCase(),
    idCardFront: readTrim(input.authInfo.idCardFront),
    idCardBack: readTrim(input.authInfo.idCardBack),
    idCardHandheld: readTrim(input.authInfo.faceUrl),
    locationText: [input.baseInfo.province, input.baseInfo.city, input.baseInfo.area, input.baseInfo.address]
      .map(readTrim)
      .filter(Boolean)
      .join(''),
    latitude: Number(input.deviceInfo.lat) || 0,
    longitude: Number(input.deviceInfo.lng) || 0,
    creditStatus: '良好',
    registerAt: at,
    quota: Number(config.defaultUserQuota),
    adminRemark: '',
    orderBlacklisted: false,
    mallInstallmentRiskAttempted: false,
    emergencyContacts: mapHalfFlowContacts(input.contactInfos),
    registerChannelCode: config.registerChannelCode,
    registerChannelName: config.registerChannelName,
    halfFlowOrderId: row.orderId,
    halfFlowBoundAt: at,
  }
}

function isOwnedHalfFlowMallUser(user, row, config) {
  const input = row && row.rawApplyPayload ? row.rawApplyPayload : {}
  return Boolean(user)
    && readTrim(user.registerChannelCode) === readTrim(config.registerChannelCode)
    && readTrim(user.halfFlowOrderId) === readTrim(row.orderId)
    && normalizePhone(user.phone || user.mobile || user.userPhone) === normalizePhone(input.mobile)
    && readTrim(user.idNumber || user.idNo || user.idCardNo).toUpperCase() === readTrim(input.idCard).toUpperCase()
}

function encodeTemplateValue(value) {
  return encodeURIComponent(String(value == null ? '' : value))
}

function buildHalfFlowAppLink(template, values) {
  return template
    .replaceAll('{orderId}', encodeTemplateValue(values.orderId))
    .replaceAll('{channel}', encodeTemplateValue(values.channel))
    .replaceAll('{token}', encodeTemplateValue(values.token))
    .replaceAll('{consumePath}', encodeTemplateValue(values.consumePath))
    .replaceAll('{domainUrl}', encodeTemplateValue(values.domainUrl))
}

async function handleHalfFlowAppLink({
  payload,
  db,
  repository,
  config,
  now,
  writeDbEntity,
  flushMongoPersist,
}) {
  const input = assertAppLinkPayload(payload)
  return withProcessKeyLock(`app-link:${input.orderId}`, async () => {
    let row = await repository.findByOrderId(input.orderId)
    if (!row) throw new HalfFlowTrafficError('orderId not found', 404, 404)
    if (row.creditStatus !== 'approved') throw new HalfFlowTrafficError('credit is not approved', 409, 409)
    if (!db || typeof db !== 'object') throw new HalfFlowTrafficError('mall data unavailable', 503, 503)
    if (!Array.isArray(db.users)) db.users = []

    let user = row.mallUserId
      ? db.users.find(item => item && readTrim(item.id) === readTrim(row.mallUserId))
      : null
    if (row.mallUserId && !user) throw new HalfFlowTrafficError('mall user not found', 404, 404)
    if (user && !isOwnedHalfFlowMallUser(user, row, config)) {
      throw new HalfFlowTrafficError('mall user ownership mismatch', 409, 409)
    }

    if (!user) {
      if (typeof writeDbEntity !== 'function' || typeof flushMongoPersist !== 'function') {
        throw new HalfFlowTrafficError('mall persistence unavailable', 503, 503)
      }

      let pendingUserId = readTrim(row.pendingMallUserId || row.mallUserId)
      let identityUser = findExistingMallUser(db, row.rawApplyPayload)
      if (!pendingUserId) {
        if (identityUser && !isOwnedHalfFlowMallUser(identityUser, row, config)) {
          throw new HalfFlowTrafficError('用户已存在', 409, 409)
        }
        const candidate = identityUser || makeHalfFlowMallUser(row, config, now)
        const preparedAt = nowIso(now)
        const reserved = await repository.reserveMallUser({
          id: row.id,
          pendingMallUserId: candidate.id,
          preparedAt,
        })
        if (reserved) {
          row.pendingMallUserId = candidate.id
          row.pendingMallUserPreparedAt = preparedAt
          row.updatedAt = preparedAt
          pendingUserId = candidate.id
          user = candidate
        }
        else {
          row = await repository.findByOrderId(input.orderId)
          pendingUserId = readTrim(row && (row.pendingMallUserId || row.mallUserId))
          if (!row || !pendingUserId) {
            throw new HalfFlowTrafficError('mall user reservation conflict', 409, 409)
          }
        }
      }

      const pendingUser = pendingUserId
        ? db.users.find(item => item && readTrim(item.id) === pendingUserId)
        : null
      identityUser = findExistingMallUser(db, row.rawApplyPayload)

      if (!user && pendingUser) {
        if (!isOwnedHalfFlowMallUser(pendingUser, row, config)) {
          throw new HalfFlowTrafficError('mall user ownership mismatch', 409, 409)
        }
        if (identityUser && readTrim(identityUser.id) !== readTrim(pendingUser.id)) {
          throw new HalfFlowTrafficError('用户已存在', 409, 409)
        }
        user = pendingUser
      }
      else if (!user && identityUser) {
        if (!isOwnedHalfFlowMallUser(identityUser, row, config)) {
          throw new HalfFlowTrafficError('用户已存在', 409, 409)
        }
        if (pendingUserId && readTrim(identityUser.id) !== pendingUserId) {
          throw new HalfFlowTrafficError('mall user ownership mismatch', 409, 409)
        }
        user = identityUser
      }
      else if (!user) {
        user = makeHalfFlowMallUser(row, config, now, pendingUserId)
      }
      if (!db.users.some(item => item && readTrim(item.id) === readTrim(user.id))) {
        db.users.unshift(user)
      }
      await Promise.resolve(writeDbEntity(db, 'users', user))
      await flushMongoPersist()
      row.mallUserId = user.id
      row.mallUserCreatedAt = user.registerAt
    }

    const token = crypto.randomBytes(24).toString('hex')
    const issuedAt = nowIso(now)
    row.loginTokenHash = sha256(token)
    row.loginTokenIssuedAt = issuedAt
    row.loginTokenConsumedAt = ''
    row.updatedAt = issuedAt
    await repository.save(row)

    const consumePath = `/api${config.routePrefix}/login/consume`
    return {
      repaymentAddress: buildHalfFlowAppLink(config.loanUrlTemplate, {
        orderId: row.orderId,
        channel: config.registerChannelCode,
        token,
        consumePath,
        domainUrl: input.domainUrl,
      }),
    }
  })
}

function sanitizeHalfFlowLoginUser(user) {
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

async function consumeHalfFlowLoginToken({ orderId, token, db, repository, config, now }) {
  const safeOrderId = readTrim(orderId)
  const safeToken = readTrim(token)
  if (!safeOrderId || !safeToken) throw new HalfFlowTrafficError('orderId and token are required')
  const row = await repository.findByOrderId(safeOrderId)
  if (!row) throw new HalfFlowTrafficError('orderId not found', 404, 404)
  if (row.creditStatus !== 'approved') throw new HalfFlowTrafficError('credit is not approved', 409, 409)
  if (row.loginTokenConsumedAt) throw new HalfFlowTrafficError('login token already used')

  const issuedAtMs = Date.parse(readTrim(row.loginTokenIssuedAt))
  const nowMs = numericNow(now)
  const ageMs = nowMs - issuedAtMs
  if (!Number.isFinite(issuedAtMs) || ageMs < 0 || ageMs > Number(config.loginTokenTtlMs)) {
    throw new HalfFlowTrafficError('login token expired')
  }
  const tokenHash = sha256(safeToken)
  if (tokenHash !== row.loginTokenHash) throw new HalfFlowTrafficError('login token invalid')

  const users = Array.isArray(db && db.users) ? db.users : []
  const user = users.find(item => item && readTrim(item.id) === readTrim(row.mallUserId))
  if (!user) throw new HalfFlowTrafficError('mall user not found', 404, 404)
  const consumedAt = new Date(nowMs).toISOString()
  const consumed = await repository.consumeLoginToken({ id: row.id, tokenHash, consumedAt })
  if (!consumed) throw new HalfFlowTrafficError('login token already used')

  return {
    token: `mock-token-${normalizePhone(user.phone)}`,
    user: sanitizeHalfFlowLoginUser(user),
  }
}

module.exports = {
  consumeHalfFlowLoginToken,
  findExistingMallUser,
  handleHalfFlowAdmission,
  handleHalfFlowAppLink,
  handleHalfFlowApply,
  normalizePhone,
  nowIso,
  numericNow,
  sanitizeHalfFlowLoginUser,
}
