const assert = require('node:assert/strict')
const test = require('node:test')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const gateway = require('../src/duodiandianGateway')

const config = {
  partner: 'p-duodiandian',
  partnerCode: 'duodiandian',
  signKey: 'sign-secret',
  encKey: '1234567890abcdef',
  replayNotifyUrl: 'https://test.ybloan.com/market/halfFlow/447285613150998528/open/order/replay/notify',
  statusNotifyUrl: 'https://test.ybloan.com/market/halfFlow/447285613150998528/open/order/status/notify',
  h5Origin: 'https://shop.example.com',
  channelCode: 'env-ddd',
  channelName: '哆点点',
  routePrefix: '/open/partners/env-ddd',
  gatewayRemark: '哆点点测试',
  portalUsername: 'env-ddd-portal',
  portalPassword: 'portal-secret',
  userAgreementName: '平台服务协议',
  userAgreementPath: '/serviceAgreement',
  privacyPolicyName: '隐私协议',
  privacyPolicyPath: '/privacyPolicy',
  timestampSkewMs: 60_000,
}

function aesAlgorithm(key) {
  const len = Buffer.byteLength(key)
  if (len === 16) return 'aes-128-ecb'
  if (len === 24) return 'aes-192-ecb'
  if (len === 32) return 'aes-256-ecb'
  throw new Error('bad key')
}

function encryptBusinessData(payload, key = config.encKey) {
  const cipher = crypto.createCipheriv(aesAlgorithm(key), Buffer.from(key), null)
  cipher.setAutoPadding(true)
  return Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]).toString('hex').toUpperCase()
}

function signBusinessData(payload, timestamp, signKey = config.signKey) {
  const pairs = Object.keys(payload)
    .filter((key) => payload[key] !== undefined && payload[key] !== null && payload[key] !== '')
    .sort()
    .map((key) => `${key}=${payload[key] && typeof payload[key] === 'object' ? JSON.stringify(payload[key]) : payload[key]}`)
  const signStr = `${pairs.join('&')}${pairs.length ? '&' : ''}key=${signKey}&timestamp=${timestamp}`
  return crypto.createHash('md5').update(signStr, 'utf8').digest('hex')
}

function md5Text(value) {
  return crypto.createHash('md5').update(String(value), 'utf8').digest('hex')
}

function envelope(payload, overrides = {}) {
  const timestamp = overrides.timestamp || String(Date.now())
  return {
    partner: overrides.partner || config.partner,
    data: overrides.data || encryptBusinessData(payload, overrides.encKey || config.encKey),
    timestamp,
    sign: overrides.sign || signBusinessData(payload, timestamp, overrides.signKey || config.signKey),
  }
}

test('decrypts and verifies a valid duodiandian envelope', () => {
  const payload = { applyNo: 'A001', userPhone: '13800138000', h5Type: 'DETAIL' }
  const result = gateway.parseDuodiandianEnvelope(envelope(payload), config, { now: Date.now() })
  assert.deepEqual(result, payload)
})

test('rejects wrong partner, expired timestamps, bad signatures and bad AES payloads', () => {
  const payload = { applyNo: 'A001', userPhone: '13800138000' }
  assert.throws(() => gateway.parseDuodiandianEnvelope(envelope(payload, { partner: 'other' }), config), /partner/i)
  assert.throws(() => gateway.parseDuodiandianEnvelope(envelope(payload, { timestamp: String(Date.now() - 120_000) }), config, { now: Date.now() }), /timestamp/i)
  assert.throws(() => gateway.parseDuodiandianEnvelope(envelope(payload, { sign: 'bad' }), config), /sign/i)
  assert.throws(() => gateway.parseDuodiandianEnvelope(envelope(payload, { data: '001122' }), config), /decrypt|AES|data/i)
})

test('creates a duodiandian application without exposing or mutating other channels', () => {
  const db = {
    users: [{ id: 'U1', phone: '13800138000', registerChannelCode: 'other' }],
    trafficChannels: [{ code: 'other', name: 'Other', clickCount: 3 }],
    trafficPartners: [],
    partnerGatewayApplications: [],
  }
  const app = gateway.upsertDuodiandianApplication(db, {
    applyNo: 'A001',
    userPhone: '13900139000',
    name: 'Alice',
    idNo: '110101199001011234',
  }, config)
  assert.equal(app.partnerCode, 'duodiandian')
  assert.equal(app.channel, 'env-ddd')
  assert.equal(app.applyNo, 'A001')
  assert.equal(app.userPhone, '13900139000')
  assert.equal(db.users[0].registerChannelCode, 'other')
  assert.deepEqual(db.trafficChannels.map((ch) => ch.code).sort(), ['env-ddd', 'other'])
})

test('requires callback partnerOrderNo to belong to a duodiandian application', () => {
  const db = { partnerGatewayApplications: [] }
  gateway.upsertDuodiandianApplication(db, { applyNo: 'A001', userPhone: '13900139000' }, config)
  gateway.bindPartnerOrderNo(db, 'A001', 'P001', config)
  const updated = gateway.recordDuodiandianCallback(db, 'orderStatus', {
    applyNo: 'A001',
    partnerOrderNo: 'P001',
    status: 'AUDIT_PASS',
  }, config)
  assert.equal(updated.externalStatus, 'AUDIT_PASS')
  assert.throws(() => gateway.recordDuodiandianCallback(db, 'orderStatus', {
    applyNo: 'A001',
    partnerOrderNo: 'P999',
    status: 'AUDIT_PASS',
  }, config), /绑定|bound|partnerOrderNo/i)
})

test('builds only the duodiandian H5 link and never accepts caller supplied channel', () => {
  const db = { partnerGatewayApplications: [] }
  gateway.upsertDuodiandianApplication(db, { applyNo: 'A001', userPhone: '13900139000' }, config)
  const url = gateway.buildDuodiandianH5Url(db, { applyNo: 'A001', userPhone: '13900139000', channel: 'other' }, config)
  const parsed = new URL(url)
  assert.equal(parsed.origin, 'https://shop.example.com')
  assert.equal(parsed.searchParams.get('channel'), 'env-ddd')
  assert.equal(parsed.searchParams.get('applyNo'), 'A001')
  assert.equal(parsed.searchParams.get('partner'), 'duodiandian')
  assert.equal(parsed.searchParams.get('channel'), 'env-ddd')
})


test('uses env style config for channel seed and portal account', () => {
  const db = { trafficChannels: [], trafficPartners: [], partnerGatewayApplications: [] }
  const ch = gateway.ensureDuodiandianChannel(db, config)
  const partner = gateway.ensureDuodiandianPortalPartner(db, config)
  assert.equal(ch.code, 'env-ddd')
  assert.equal(ch.name, '哆点点')
  assert.equal(ch.remark, '哆点点测试')
  assert.equal(partner.username, 'env-ddd-portal')
  assert.equal(partner.password, 'portal-secret')
  assert.deepEqual(partner.channelCodes, ['env-ddd'])
})

test('registers routes under configured route prefix', () => {
  const paths = []
  const router = { post(path) { paths.push(path) } }
  gateway.registerDuodiandianGatewayRoutes(router, { readDb() { return {} }, writeDb() {}, configProvider: () => config })
  assert(paths.every(path => path.startsWith('/open/partners/env-ddd/')))
  assert(paths.includes('/open/partners/env-ddd/getUrl'))
  assert(paths.includes('/open/partners/env-ddd/order/replayPlan/notify'))
  assert(paths.includes('/open/partners/env-ddd/order/replay/notify'))
})

function makeCapturingRouter() {
  const routes = new Map()
  return {
    routes,
    post(path, handler) {
      routes.set(path, handler)
    },
  }
}

function makeCtx(payload) {
  return {
    request: { body: envelope(payload) },
    status: 0,
    body: null,
  }
}

function makeRawCtx(payload) {
  return {
    request: { body: payload },
    status: 0,
    body: null,
  }
}

function registerCountingRoutes(db) {
  let reads = 0
  let writes = 0
  const router = makeCapturingRouter()
  gateway.registerDuodiandianGatewayRoutes(router, {
    readDb() {
      reads += 1
      return db
    },
    writeDb() {
      writes += 1
    },
    configProvider: () => config,
  })
  return {
    router,
    counts() {
      return { reads, writes }
    },
  }
}

function registerScopedRoutes(db) {
  const calls = []
  const router = makeCapturingRouter()
  gateway.registerDuodiandianGatewayRoutes(router, {
    readDb() {
      calls.push({ type: 'read' })
      return db
    },
    writeDb() {
      calls.push({ type: 'fullWrite' })
    },
    writeDbPartial(_db, keys) {
      calls.push({ type: 'partialWrite', keys })
    },
    async flushMongoPersist() {
      calls.push({ type: 'flush', applicationCount: (db.partnerGatewayApplications || []).length })
    },
    configProvider: () => config,
  })
  return {
    router,
    calls,
  }
}

test('contract query is read-only and keeps protocol response fields', async () => {
  const state = registerCountingRoutes({ trafficChannels: [], partnerGatewayApplications: [] })
  const ctx = makeCtx({ applyNo: 'A-CONTRACT' })

  await state.router.routes.get('/open/partners/env-ddd/contractQuery')(ctx)

  assert.equal(ctx.status, 200)
  assert.deepEqual(state.counts(), { reads: 0, writes: 0 })
  assert.deepEqual(ctx.body.data.map(item => item.contractName), ['平台服务协议', '隐私协议'])
  assert(ctx.body.data.every(item => item.contractUrl.startsWith('https://shop.example.com/')))
})

test('checkPrefIx is read-only and does not persist channel seed changes', async () => {
  const db = {
    users: [{ id: 'U1', phone: '15257084456', registerChannelCode: 'natural' }],
    orders: [],
    partnerGatewayApplications: [],
    trafficChannels: [],
  }
  const state = registerCountingRoutes(db)
  const ctx = makeCtx({ phone_pre: '18800001' })

  await state.router.routes.get('/open/partners/env-ddd/checkPrefIx')(ctx)

  assert.equal(ctx.status, 200)
  assert.deepEqual(state.counts(), { reads: 1, writes: 0 })
  assert.deepEqual(ctx.body.data, { check_ret: 'Y', phone_md5: [] })
  assert.deepEqual(db.trafficChannels, [])
})

test('getUrl is read-only and returns the existing application H5 link', async () => {
  const db = { partnerGatewayApplications: [] }
  const app = gateway.upsertDuodiandianApplication(db, { applyNo: 'A-URL', userPhone: '13900139000' }, config)
  gateway.bindPartnerOrderNo(db, app.applyNo, 'P-URL', config)
  const state = registerCountingRoutes(db)
  const ctx = makeCtx({ applyNo: 'A-URL' })

  await state.router.routes.get('/open/partners/env-ddd/getUrl')(ctx)

  assert.equal(ctx.status, 200)
  assert.deepEqual(state.counts(), { reads: 1, writes: 0 })
  const parsed = new URL(ctx.body.data.url)
  assert.equal(parsed.origin, 'https://shop.example.com')
  assert.equal(parsed.searchParams.get('applyNo'), 'A-URL')
  assert.equal(parsed.searchParams.get('channel'), 'env-ddd')
})

test('apply still writes application data and keeps apply response fields', async () => {
  const db = { users: [], orders: [], trafficChannels: [], trafficPartners: [], partnerGatewayApplications: [] }
  const state = registerCountingRoutes(db)
  const ctx = makeCtx({ applyNo: 'A-APPLY', userPhone: '13900139000' })

  await state.router.routes.get('/open/partners/env-ddd/apply')(ctx)

  assert.equal(ctx.status, 200)
  assert.deepEqual(state.counts(), { reads: 1, writes: 1 })
  assert.equal(ctx.body.data.status, '1')
  assert.equal(ctx.body.data.approvalAmount, '0')
  assert.equal(ctx.body.data.approvalStatus, 'ING')
  assert.match(ctx.body.data.partnerOrderNo, /^DDD[A-F0-9]{16}$/)
  assert.equal(db.partnerGatewayApplications.length, 1)
})

test('apply persists only duodiandian gateway collections and flushes before success', async () => {
  const db = { users: [], orders: [], trafficChannels: [], trafficPartners: [], partnerGatewayApplications: [] }
  const state = registerScopedRoutes(db)
  const ctx = makeCtx({ applyNo: 'A-SCOPED', userPhone: '18800001111' })

  await state.router.routes.get('/open/partners/env-ddd/apply')(ctx)

  assert.equal(ctx.status, 200)
  assert.deepEqual(state.calls.map(call => call.type), ['read', 'partialWrite', 'flush'])
  assert.deepEqual(state.calls[1].keys, ['partnerGatewayApplications', 'trafficChannels', 'trafficPartners'])
  assert.equal(state.calls[2].applicationCount, 1)
  assert.equal(db.partnerGatewayApplications[0].applyNo, 'A-SCOPED')
})

test('auto-register apply stores all duodiandian fields, transferred images and login ticket', async () => {
  const db = { users: [], orders: [], trafficChannels: [], trafficPartners: [], partnerGatewayApplications: [] }
  const calls = []
  const router = makeCapturingRouter()
  gateway.registerDuodiandianGatewayRoutes(router, {
    readDb() {
      calls.push({ type: 'read' })
      return db
    },
    writeDb() {},
    writeDbPartial(_db, keys) {
      calls.push({ type: 'partialWrite', keys })
    },
    async flushMongoPersist() {
      calls.push({ type: 'flush' })
    },
    configProvider: () => ({ ...config, applyAutoRegisterEnabled: true }),
    runApplyRiskPack: async (subject) => {
      assert.deepEqual(subject, {
        userName: '张三',
        phoneNumber: '13900139000',
        idNumber: '110101199001011234',
      })
      return { allPassed: true, message: '', steps: [{ key: 'mobile2', label: '运营商二要素验证', ok: true }] }
    },
    transferPartnerImage: async ({ url, scene, phone }) => ({
      originalUrl: url,
      url: `https://oss.example.com/${phone}/${scene}.png`,
      contentType: 'image/png',
      size: 1234,
      key: `${phone}/${scene}.png`,
    }),
    now: () => 1748400093574,
    httpClient: async () => ({ ok: true, status: 200, async text() { return JSON.stringify({ code: '200' }) } }),
  })

  const payload = {
    applyNo: 'A-AUTO',
    applyIp: '203.0.113.1',
    userPhone: '13900139000',
    idNo: '110101199001011234',
    name: '张三',
    frontImage: 'https://img.example.com/front.png',
    backImage: 'https://img.example.com/back.png',
    faceImg: 'https://img.example.com/face.png',
    gender: 'BOY',
    nation: '汉',
    authority: '北京市公安局',
    validDate: '20200422-20400422',
    address: '北京市朝阳区',
    education: 'COLLEGE',
    marriedStatus: 'UNMARRIED',
    homeAddress: '北京市海淀区',
    companyName: '示例公司',
    companyAddress: '北京市西城区',
    clientType: 'h5',
    relations: [
      { name: '李四', phone: '13800138000', relation: 'FRIEND' },
    ],
  }
  const ctx = makeCtx(payload)

  await router.routes.get('/open/partners/env-ddd/apply')(ctx)

  assert.equal(ctx.status, 200)
  assert.equal(db.users.length, 1)
  assert.deepEqual(calls.map(c => c.type), ['read', 'partialWrite', 'flush'])
  assert.deepEqual(calls[1].keys, ['partnerGatewayApplications', 'trafficChannels', 'trafficPartners', 'users'])
  const user = db.users[0]
  assert.equal(user.phone, '13900139000')
  assert.equal(user.name, '张三')
  assert.equal(user.idNumber, '110101199001011234')
  assert.equal(user.idCardFront, 'https://oss.example.com/13900139000/front.png')
  assert.equal(user.idCardBack, 'https://oss.example.com/13900139000/back.png')
  assert.equal(user.idCardHandheld, 'https://oss.example.com/13900139000/face.png')
  assert.deepEqual(user.emergencyContacts, [{ name: '李四', phone: '13800138000', relation: 'FRIEND' }])
  assert.equal(user.partnerProfiles.duodiandian.raw.applyIp, '203.0.113.1')
  assert.equal(user.partnerProfiles.duodiandian.raw.companyName, '示例公司')
  assert.equal(user.partnerProfiles.duodiandian.images.face.transferredUrl, 'https://oss.example.com/13900139000/face.png')
  assert.equal(user.partnerProfiles.duodiandian.idCardHandheldSource, 'faceImg')
  assert.equal(user.partnerProfiles.duodiandian.riskReviewStatus, 'PASS')
  assert.equal(db.partnerGatewayApplications[0].mallUserId, user.id)
  assert.equal(db.partnerGatewayApplications[0].autoLoginTicketUsedAt, '')
  const returnUrl = new URL(ctx.body.data.returnUrl)
  assert.equal(returnUrl.searchParams.get('applyNo'), 'A-AUTO')
  assert(returnUrl.searchParams.get('loginTicket'))
  assert.equal(returnUrl.searchParams.get('autoLoginPath'), '/open/partners/env-ddd/autoLogin')
})

test('auto-login consumes a one-time duodiandian login ticket', async () => {
  const db = { users: [], trafficChannels: [], trafficPartners: [], partnerGatewayApplications: [] }
  const router = makeCapturingRouter()
  gateway.registerDuodiandianGatewayRoutes(router, {
    readDb() { return db },
    writeDb() {},
    writeDbPartial() {},
    async flushMongoPersist() {},
    configProvider: () => ({ ...config, applyAutoRegisterEnabled: true }),
    runApplyRiskPack: async () => ({ allPassed: true, message: '', steps: [] }),
    transferPartnerImage: async ({ url, scene }) => ({ originalUrl: url, url: `https://oss.example.com/${scene}.jpg`, contentType: 'image/jpeg', size: 100 }),
    httpClient: async () => ({ ok: true, status: 200, async text() { return '{}' } }),
  })
  const applyCtx = makeCtx({
    applyNo: 'A-LOGIN',
    applyIp: '203.0.113.1',
    userPhone: '13900139000',
    idNo: '110101199001011234',
    name: '张三',
    frontImage: 'https://img.example.com/front.jpg',
    backImage: 'https://img.example.com/back.jpg',
    gender: 'BOY',
    clientType: 'h5',
    relations: [{ name: '李四', phone: '13800138000', relation: 'FRIEND' }],
  })
  await router.routes.get('/open/partners/env-ddd/apply')(applyCtx)
  const ticket = new URL(applyCtx.body.data.returnUrl).searchParams.get('loginTicket')

  const loginCtx = makeRawCtx({ applyNo: 'A-LOGIN', loginTicket: ticket })
  await router.routes.get('/open/partners/env-ddd/autoLogin')(loginCtx)

  assert.equal(loginCtx.status, 200)
  assert.equal(loginCtx.body.data.token, 'mock-token-13900139000')
  assert.equal(loginCtx.body.data.user.phone, '13900139000')
  assert(db.partnerGatewayApplications[0].autoLoginTicketUsedAt)

  const secondCtx = makeRawCtx({ applyNo: 'A-LOGIN', loginTicket: ticket })
  await router.routes.get('/open/partners/env-ddd/autoLogin')(secondCtx)
  assert.equal(secondCtx.status, 400)
  assert.match(secondCtx.body.msg, /used|已使用|ticket/i)
})

test('auto-register apply is idempotent for the same approved applyNo', async () => {
  const db = { users: [], trafficChannels: [], trafficPartners: [], partnerGatewayApplications: [] }
  let riskCalls = 0
  const router = makeCapturingRouter()
  gateway.registerDuodiandianGatewayRoutes(router, {
    readDb() { return db },
    writeDb() {},
    writeDbPartial() {},
    async flushMongoPersist() {},
    configProvider: () => ({ ...config, applyAutoRegisterEnabled: true }),
    runApplyRiskPack: async () => {
      riskCalls += 1
      return { allPassed: true, message: '', steps: [] }
    },
    transferPartnerImage: async ({ url, scene }) => ({ originalUrl: url, url: `https://oss.example.com/${scene}.jpg`, contentType: 'image/jpeg', size: 100 }),
    httpClient: async () => ({ ok: true, status: 200, async text() { return '{}' } }),
  })
  const payload = {
    applyNo: 'A-IDEMP',
    applyIp: '203.0.113.1',
    userPhone: '13900139000',
    idNo: '110101199001011234',
    name: '张三',
    frontImage: 'https://img.example.com/front.jpg',
    backImage: 'https://img.example.com/back.jpg',
    gender: 'BOY',
    clientType: 'h5',
    relations: [{ name: '李四', phone: '13800138000', relation: 'FRIEND' }],
  }

  const first = makeCtx(payload)
  await router.routes.get('/open/partners/env-ddd/apply')(first)
  const second = makeCtx(payload)
  await router.routes.get('/open/partners/env-ddd/apply')(second)

  assert.equal(first.status, 200)
  assert.equal(second.status, 200)
  assert.equal(db.users.length, 1)
  assert.equal(riskCalls, 1)
  assert.equal(second.body.data.approvalStatus, 'SUC')
  assert(new URL(second.body.data.returnUrl).searchParams.get('loginTicket'))
})

test('auto-register is fail-closed for duplicate registered phones', async () => {
  const db = {
    users: [{ id: 'U-OLD', phone: '13900139000', name: '老用户' }],
    orders: [],
    trafficChannels: [],
    trafficPartners: [],
    partnerGatewayApplications: [],
  }
  const notified = []
  const router = makeCapturingRouter()
  gateway.registerDuodiandianGatewayRoutes(router, {
    readDb() { return db },
    writeDb() {},
    writeDbPartial() {},
    async flushMongoPersist() {},
    configProvider: () => ({ ...config, applyAutoRegisterEnabled: true }),
    runApplyRiskPack: async () => {
      throw new Error('risk must not run for duplicate phone')
    },
    transferPartnerImage: async () => {
      throw new Error('image transfer must not run for duplicate phone')
    },
    httpClient: async (_url, options) => {
      notified.push(gateway.parseDuodiandianEnvelope(JSON.parse(options.body), config, { now: Date.now() }))
      return { ok: true, status: 200, async text() { return JSON.stringify({ code: '200' }) } }
    },
  })

  const ctx = makeCtx({
    applyNo: 'A-DUP-PHONE',
    applyIp: '203.0.113.1',
    userPhone: '13900139000',
    idNo: '110101199001011234',
    name: '张三',
    frontImage: 'https://img.example.com/front.jpg',
    backImage: 'https://img.example.com/back.jpg',
    gender: 'BOY',
    clientType: 'h5',
    relations: [{ name: '李四', phone: '13800138000', relation: 'FRIEND' }],
  })
  await router.routes.get('/open/partners/env-ddd/apply')(ctx)

  assert.equal(ctx.status, 200)
  assert.equal(db.users.length, 1)
  assert.equal(db.users[0].name, '老用户')
  assert.equal(db.partnerGatewayApplications[0].riskReviewStatus, 'REJECT')
  assert.equal(notified[0].status, 'AUDIT_REJECT')
  assert.match(notified[0].rejectReason, /已注册|duplicate/i)
  assert.equal(ctx.body.data.approvalStatus, 'REJECT')
})

test('auto-register notifies audit reject when risk pack errors', async () => {
  const db = { users: [], trafficChannels: [], trafficPartners: [], partnerGatewayApplications: [] }
  const notified = []
  const router = makeCapturingRouter()
  gateway.registerDuodiandianGatewayRoutes(router, {
    readDb() { return db },
    writeDb() {},
    writeDbPartial() {},
    async flushMongoPersist() {},
    configProvider: () => ({ ...config, applyAutoRegisterEnabled: true }),
    runApplyRiskPack: async () => {
      throw new Error('risk upstream down')
    },
    transferPartnerImage: async ({ url, scene }) => ({ originalUrl: url, url: `https://oss.example.com/${scene}.jpg`, contentType: 'image/jpeg', size: 100 }),
    httpClient: async (_url, options) => {
      notified.push(gateway.parseDuodiandianEnvelope(JSON.parse(options.body), config, { now: Date.now() }))
      return { ok: true, status: 200, async text() { return JSON.stringify({ code: '200' }) } }
    },
  })

  const ctx = makeCtx({
    applyNo: 'A-RISK-ERR',
    applyIp: '203.0.113.1',
    userPhone: '13900139000',
    idNo: '110101199001011234',
    name: '张三',
    frontImage: 'https://img.example.com/front.jpg',
    backImage: 'https://img.example.com/back.jpg',
    gender: 'BOY',
    clientType: 'h5',
    relations: [{ name: '李四', phone: '13800138000', relation: 'FRIEND' }],
  })
  await router.routes.get('/open/partners/env-ddd/apply')(ctx)

  assert.equal(ctx.status, 200)
  assert.equal(ctx.body.data.approvalStatus, 'REJECT')
  assert.equal(db.users.length, 0)
  assert.equal(db.partnerGatewayApplications[0].riskReviewStatus, 'REJECT')
  assert.match(db.partnerGatewayApplications[0].riskReviewReason, /risk upstream down/)
  assert.equal(notified[0].status, 'AUDIT_REJECT')
})

test('sandbox apply returns production-shaped success without creating a real mall user', async () => {
  const db = { users: [], trafficChannels: [], trafficPartners: [], partnerGatewayApplications: [] }
  const router = makeCapturingRouter()
  gateway.registerDuodiandianGatewayRoutes(router, {
    readDb() { return db },
    writeDb() {},
    writeDbPartial() {},
    async flushMongoPersist() {},
    configProvider: () => ({
      ...config,
      sandboxEnabled: true,
      sandboxPhoneWhitelist: '13900139000',
      sandboxMockRiskPass: true,
    }),
    runApplyRiskPack: async () => {
      throw new Error('sandbox mock risk should not call real risk')
    },
    transferPartnerImage: async () => {
      throw new Error('sandbox image transfer is disabled by default')
    },
  })

  const ctx = makeCtx({
    applyNo: 'DDD_AUTO_A001',
    applyIp: '203.0.113.1',
    userPhone: '13900139000',
    idNo: '110101199001011234',
    name: '张三',
    frontImage: 'https://img.example.com/front.jpg',
    backImage: 'https://img.example.com/back.jpg',
    faceImg: 'https://img.example.com/face.jpg',
    gender: 'BOY',
    clientType: 'h5',
    relations: [{ name: '李四', phone: '13800138000', relation: 'FRIEND' }],
  })
  await router.routes.get('/open/partners/env-ddd/apply')(ctx)

  assert.equal(ctx.status, 200)
  assert.equal(ctx.body.data.approvalStatus, 'SUC')
  assert.equal(db.users.length, 0)
  const app = db.partnerGatewayApplications[0]
  assert.equal(app.sandbox, true)
  assert.equal(app.sandboxAutoLogin, true)
  assert.equal(app.riskReviewStatus, 'PASS')
  const returnUrl = new URL(ctx.body.data.returnUrl)
  assert.equal(returnUrl.searchParams.get('applyNo'), 'DDD_AUTO_A001')
  assert(returnUrl.searchParams.get('loginTicket'))
  assert.equal(returnUrl.searchParams.get('autoLoginPath'), '/open/partners/env-ddd/autoLogin')
})

test('sandbox auto-login consumes ticket using stored sandbox profile only', async () => {
  const db = { users: [], trafficChannels: [], trafficPartners: [], partnerGatewayApplications: [] }
  const router = makeCapturingRouter()
  gateway.registerDuodiandianGatewayRoutes(router, {
    readDb() { return db },
    writeDb() {},
    writeDbPartial() {},
    async flushMongoPersist() {},
    configProvider: () => ({
      ...config,
      sandboxEnabled: true,
      sandboxPhoneWhitelist: '13900139000',
      sandboxMockRiskPass: true,
    }),
  })
  const applyCtx = makeCtx({
    applyNo: 'DDD_AUTO_LOGIN',
    applyIp: '203.0.113.1',
    userPhone: '13900139000',
    idNo: '110101199001011234',
    name: '张三',
    frontImage: 'https://img.example.com/front.jpg',
    backImage: 'https://img.example.com/back.jpg',
    gender: 'BOY',
    clientType: 'h5',
    relations: [{ name: '李四', phone: '13800138000', relation: 'FRIEND' }],
  })
  await router.routes.get('/open/partners/env-ddd/apply')(applyCtx)
  const ticket = new URL(applyCtx.body.data.returnUrl).searchParams.get('loginTicket')

  const loginCtx = makeRawCtx({ applyNo: 'DDD_AUTO_LOGIN', loginTicket: ticket })
  await router.routes.get('/open/partners/env-ddd/autoLogin')(loginCtx)

  assert.equal(loginCtx.status, 200)
  assert.equal(loginCtx.body.data.token, 'mock-token-13900139000')
  assert.equal(loginCtx.body.data.user.phone, '13900139000')
  assert.equal(loginCtx.body.data.user.partnerProfiles.duodiandian.sandbox, true)
  assert.equal(db.users.length, 0)
  assert(db.partnerGatewayApplications[0].autoLoginTicketUsedAt)
})

test('sandbox ignores non-whitelisted phones without touching real users', async () => {
  const db = { users: [], trafficChannels: [], trafficPartners: [], partnerGatewayApplications: [] }
  const router = makeCapturingRouter()
  gateway.registerDuodiandianGatewayRoutes(router, {
    readDb() { return db },
    writeDb() {},
    writeDbPartial() {},
    async flushMongoPersist() {},
    configProvider: () => ({
      ...config,
      sandboxEnabled: true,
      sandboxPhoneWhitelist: '13900139000',
      sandboxMockRiskPass: true,
    }),
  })

  const ctx = makeCtx({
    applyNo: 'DDD_AUTO_DENY',
    applyIp: '203.0.113.1',
    userPhone: '13900139001',
    idNo: '110101199001011234',
    name: '张三',
    frontImage: 'https://img.example.com/front.jpg',
    backImage: 'https://img.example.com/back.jpg',
    gender: 'BOY',
    clientType: 'h5',
    relations: [{ name: '李四', phone: '13800138000', relation: 'FRIEND' }],
  })
  await router.routes.get('/open/partners/env-ddd/apply')(ctx)

  assert.equal(ctx.status, 200)
  assert.equal(ctx.body.data.approvalStatus, 'ING')
  assert.equal(db.users.length, 0)
  assert.notEqual(db.partnerGatewayApplications[0].sandbox, true)
})

test('checkPrefIx blocks a phone prefix immediately after apply succeeds', async () => {
  const db = { users: [], orders: [], trafficChannels: [], trafficPartners: [], partnerGatewayApplications: [] }
  const state = registerScopedRoutes(db)

  await state.router.routes.get('/open/partners/env-ddd/apply')(makeCtx({ applyNo: 'A-DUP', userPhone: '18800001111' }))
  const checkCtx = makeCtx({ phone_pre: '18800001' })
  await state.router.routes.get('/open/partners/env-ddd/checkPrefIx')(checkCtx)

  assert.equal(checkCtx.status, 200)
  assert.deepEqual(checkCtx.body.data, { check_ret: 'N', phone_md5: [md5Text('18800001111')] })
})

test('check prefix filters internal duplicate users and returns matched phone md5', () => {
  const db = {
    users: [
      { id: 'U1', phone: '15257084456', registerChannelCode: 'natural' },
      { id: 'U2', phone: '13900139000', registerChannelCode: 'other' },
    ],
    orders: [],
    partnerGatewayApplications: [],
  }
  const result = gateway.buildDuodiandianCheckPrefixResult(db, { phone_pre: '15257084' }, config)
  assert.equal(result.check_ret, 'N')
  assert.deepEqual(result.phone_md5, [md5Text('15257084456')])
})

test('check prefix allows clean prefixes and still does not expose phone md5', () => {
  const db = {
    users: [{ id: 'U1', phone: '15257084456', registerChannelCode: 'natural' }],
    orders: [],
    partnerGatewayApplications: [],
  }
  const result = gateway.buildDuodiandianCheckPrefixResult(db, { phone_pre: '18800001' }, config)
  assert.equal(result.check_ret, 'Y')
  assert.deepEqual(result.phone_md5, [])
})

test('matches only the duodiandian public path for no-api middleware handling', () => {
  assert.equal(gateway.isDuodiandianPublicPath('/open/partners/env-ddd/getUrl', config), true)
  assert.equal(gateway.isDuodiandianPublicPath('/open/partners/env-ddd/order/status/notify', config), true)
  assert.equal(gateway.isDuodiandianPublicPath('/api/open/partners/env-ddd/getUrl', config), false)
  assert.equal(gateway.isDuodiandianPublicPath('/open/partners/other/getUrl', config), false)
  assert.equal(gateway.isDuodiandianPublicPath('/open/partners/env-ddd-other/getUrl', config), false)
})

test('uses lightweight mongo refresh plans only for duodiandian read-only endpoints', () => {
  assert.deepEqual(
    gateway.resolveDuodiandianMongoRefreshPlan('POST', '/open/partners/env-ddd/contractQuery', config),
    { mode: 'skip' },
  )
  assert.deepEqual(
    gateway.resolveDuodiandianMongoRefreshPlan('POST', '/open/partners/env-ddd/checkPrefIx', config),
    { mode: 'partial', keys: ['users', 'orders', 'partnerGatewayApplications'], allowColdPartial: true },
  )
  assert.deepEqual(
    gateway.resolveDuodiandianMongoRefreshPlan('POST', '/open/partners/env-ddd/checkPrefix', config),
    { mode: 'partial', keys: ['users', 'orders', 'partnerGatewayApplications'], allowColdPartial: true },
  )
  assert.deepEqual(
    gateway.resolveDuodiandianMongoRefreshPlan('POST', '/open/partners/env-ddd/getUrl', config),
    { mode: 'partial', keys: ['partnerGatewayApplications'], allowColdPartial: true },
  )
  assert.deepEqual(
    gateway.resolveDuodiandianMongoRefreshPlan('POST', '/open/partners/env-ddd/autoLogin', config),
    { mode: 'partial', keys: ['partnerGatewayApplications', 'users'], allowColdPartial: true },
  )
  assert.deepEqual(
    gateway.resolveDuodiandianMongoRefreshPlan('POST', '/open/partners/env-ddd/apply', { ...config, applyAutoRegisterEnabled: true }),
    { mode: 'partial', keys: ['partnerGatewayApplications', 'trafficChannels', 'trafficPartners', 'users'], allowColdPartial: true },
  )
})

test('uses scoped mongo refresh plans for duodiandian write endpoints', () => {
  assert.deepEqual(
    gateway.resolveDuodiandianMongoRefreshPlan('POST', '/open/partners/env-ddd/apply', config),
    { mode: 'partial', keys: ['partnerGatewayApplications', 'trafficChannels', 'trafficPartners'], allowColdPartial: true },
  )
  assert.deepEqual(
    gateway.resolveDuodiandianMongoRefreshPlan('POST', '/open/partners/env-ddd/order/replay/notify', config),
    { mode: 'partial', keys: ['partnerGatewayApplications'], allowColdPartial: true },
  )
  assert.equal(gateway.resolveDuodiandianMongoRefreshPlan('GET', '/open/partners/env-ddd/getUrl', config), null)
  assert.equal(gateway.resolveDuodiandianMongoRefreshPlan('POST', '/open/partners/other/getUrl', config), null)
})

test('builds encrypted outbound notify envelope for replay notify endpoint', () => {
  const payload = {
    applyNo: 'A001',
    partnerOrderNo: 'P001',
    status: 'AUDIT_PASS',
    approvalAmount: '1200',
    availableAmount: '1200',
    yearlyRate: '0%',
  }
  const timestamp = '1748400093574'
  const envelopeOut = gateway.buildDuodiandianNotifyEnvelope(payload, config, { timestamp })
  assert.equal(envelopeOut.partner, config.partner)
  assert.equal(envelopeOut.timestamp, timestamp)
  assert.match(envelopeOut.data, /^[0-9A-F]+$/)
  assert.equal(envelopeOut.sign, signBusinessData(payload, timestamp))
  assert.deepEqual(gateway.parseDuodiandianEnvelope(envelopeOut, config, { now: Number(timestamp) }), payload)
})

test('sends risk, loan and repaid callbacks to the configured status notify url', async () => {
  const db = { partnerGatewayApplications: [] }
  gateway.upsertDuodiandianApplication(db, { applyNo: 'A001', userPhone: '13900139000' }, config)
  gateway.bindPartnerOrderNo(db, 'A001', 'P001', config)
  const calls = []
  const httpClient = async (url, options) => {
    calls.push({ url, options })
    return {
      ok: true,
      status: 200,
      async json() { return { code: 200, message: '成功' } },
    }
  }
  const base = {
    db,
    order: {
      id: 'O001',
      phone: '13900139000',
      totalAmount: 3000,
      cardPackageAmount: 1200,
      riskReason: '人工审核不通过',
    },
    config,
    httpClient,
    now: () => 1748400093574,
  }

  await gateway.notifyDuodiandianOrderEvent({ ...base, event: 'risk_pass' })
  await gateway.notifyDuodiandianOrderEvent({ ...base, event: 'loan_pass' })
  await gateway.notifyDuodiandianOrderEvent({ ...base, event: 'repaid' })

  assert.equal(calls.length, 3)
  assert(calls.every(call => call.url === config.statusNotifyUrl))
  const payloads = calls.map(call => gateway.parseDuodiandianEnvelope(JSON.parse(call.options.body), config, { now: 1748400093574 }))
  assert.deepEqual(payloads.map(p => p.status), ['AUDIT_PASS', 'LOAN_PASS', 'REPAID'])
  assert.equal(payloads[0].approvalAmount, '1200')
  assert.equal(payloads[0].availableAmount, '1200')
  assert.equal(payloads[0].yearlyRate, '0%')
  assert.equal(payloads[1].withdrawAmount, '1200')
})

test('skips outbound notify without touching non duodiandian orders', async () => {
  const calls = []
  const result = await gateway.notifyDuodiandianOrderEvent({
    db: { partnerGatewayApplications: [] },
    order: { id: 'O001', phone: '13900139000', totalAmount: 3000 },
    event: 'risk_pass',
    config,
    httpClient: async (...args) => calls.push(args),
  })
  assert.equal(result.sent, false)
  assert.equal(result.reason, 'application_not_found')
  assert.equal(calls.length, 0)
})

test('deduplicates successful outbound notify per applyNo and status in current process', async () => {
  const db = { partnerGatewayApplications: [] }
  gateway.upsertDuodiandianApplication(db, { applyNo: 'A-DEDUP', userPhone: '13900139001' }, config)
  gateway.bindPartnerOrderNo(db, 'A-DEDUP', 'P-DEDUP', config)
  let callCount = 0
  const httpClient = async () => {
    callCount += 1
    return {
      ok: true,
      status: 200,
      async json() { return { code: '200', msg: '成功' } },
    }
  }
  const args = {
    db,
    order: { id: 'O-DEDUP', phone: '13900139001', cardPackageAmount: 1000 },
    event: 'risk_pass',
    config,
    httpClient,
  }
  assert.equal((await gateway.notifyDuodiandianOrderEvent(args)).sent, true)
  assert.equal((await gateway.notifyDuodiandianOrderEvent(args)).reason, 'duplicate_skipped')
  assert.equal(callCount, 1)
})

test('pre-reviews duodiandian apply payload and notifies audit pass without storing plaintext identity', async () => {
  const db = { partnerGatewayApplications: [] }
  const app = gateway.upsertDuodiandianApplication(db, {
    applyNo: 'A-RISK-PASS',
    userPhone: '13900139000',
    name: 'Alice',
    idNo: '110101199001011234',
  }, config)
  gateway.bindPartnerOrderNo(db, app.applyNo, 'P-RISK-PASS', config)
  const calls = []
  let riskCalls = 0

  const result = await gateway.runDuodiandianApplyRiskReview({
    app,
    payload: {
      applyNo: app.applyNo,
      userPhone: '13900139000',
      name: 'Alice',
      idNo: '110101199001011234',
    },
    config,
    now: () => 1748400093574,
    runRiskPack: async (params) => {
      riskCalls += 1
      assert.deepEqual(params, {
        userName: 'Alice',
        phoneNumber: '13900139000',
        idNumber: '110101199001011234',
      })
      return {
        allPassed: true,
        message: '',
        steps: [{ key: 'mobile2', label: '运营商二要素验证', ok: true }],
      }
    },
    httpClient: async (url, options) => {
      calls.push({ url, options })
      return { ok: true, status: 200, async text() { return JSON.stringify({ code: '200' }) } }
    },
  })

  assert.equal(result.status, 'PASS')
  assert.equal(riskCalls, 1)
  assert.equal(app.riskReviewStatus, 'PASS')
  assert.equal(app.riskReviewSource, 'duodiandian_apply')
  assert.equal(app.riskNotifyStatus, 'SENT')
  assert.equal(typeof app.riskReviewIdentityHash, 'string')
  assert(!app.name)
  assert(!app.idNo)
  assert(!app.idNumber)
  assert.deepEqual(app.riskReviewStepsSummary, [
    { key: 'mobile2', state: 'ok', label: '运营商二要素验证', error: undefined },
  ])
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, config.statusNotifyUrl)
  const notified = gateway.parseDuodiandianEnvelope(JSON.parse(calls[0].options.body), config, { now: 1748400093574 })
  assert.equal(notified.applyNo, 'A-RISK-PASS')
  assert.equal(notified.partnerOrderNo, 'P-RISK-PASS')
  assert.equal(notified.status, 'AUDIT_PASS')
})

test('derives duodiandian status notify url from legacy replay notify url', () => {
  const resolved = gateway.resolveGatewayConfig({
    ...config,
    statusNotifyUrl: '',
  })

  assert.equal(
    resolved.statusNotifyUrl,
    'https://test.ybloan.com/market/halfFlow/447285613150998528/open/order/status/notify',
  )
})

test('skips duodiandian apply pre-review when identity data is incomplete', async () => {
  const app = { applyNo: 'A-RISK-SKIP', partnerOrderNo: 'P-RISK-SKIP' }
  let riskCalls = 0
  let notifyCalls = 0

  const result = await gateway.runDuodiandianApplyRiskReview({
    app,
    payload: { applyNo: 'A-RISK-SKIP', userPhone: '13900139000', name: 'Alice' },
    config,
    runRiskPack: async () => {
      riskCalls += 1
      return { allPassed: true, steps: [] }
    },
    httpClient: async () => {
      notifyCalls += 1
      return { ok: true, status: 200, async text() { return '{}' } }
    },
  })

  assert.equal(result.status, 'SKIPPED')
  assert.equal(app.riskReviewStatus, 'SKIPPED')
  assert.match(app.riskReviewReason, /identity|姓名|手机号|身份证/i)
  assert.equal(riskCalls, 0)
  assert.equal(notifyCalls, 0)
})

test('does not run apply pre-review twice for the same identity hash', async () => {
  const app = { applyNo: 'A-RISK-DEDUP', partnerOrderNo: 'P-RISK-DEDUP' }
  const payload = {
    applyNo: app.applyNo,
    userPhone: '13900139000',
    name: 'Alice',
    idNo: '110101199001011234',
  }
  let riskCalls = 0

  await gateway.runDuodiandianApplyRiskReview({
    app,
    payload,
    config,
    runRiskPack: async () => {
      riskCalls += 1
      return { allPassed: true, message: '', steps: [] }
    },
    httpClient: async () => ({ ok: true, status: 200, async text() { return JSON.stringify({ code: '200' }) } }),
  })
  const second = await gateway.runDuodiandianApplyRiskReview({
    app,
    payload,
    config,
    runRiskPack: async () => {
      riskCalls += 1
      return { allPassed: false, message: 'should not run', steps: [] }
    },
    httpClient: async () => ({ ok: true, status: 200, async text() { return JSON.stringify({ code: '200' }) } }),
  })

  assert.equal(riskCalls, 1)
  assert.equal(second.reused, true)
  assert.equal(second.status, 'PASS')
})

test('finds reusable duodiandian apply pre-review only for the same identity', async () => {
  const db = { partnerGatewayApplications: [] }
  const app = gateway.upsertDuodiandianApplication(db, {
    applyNo: 'A-RISK-REUSE',
    userPhone: '13900139000',
    name: 'Alice',
    idNo: '110101199001011234',
  }, config)
  gateway.bindPartnerOrderNo(db, app.applyNo, 'P-RISK-REUSE', config)
  await gateway.runDuodiandianApplyRiskReview({
    app,
    payload: {
      applyNo: app.applyNo,
      userPhone: '13900139000',
      name: 'Alice',
      idNo: '110101199001011234',
    },
    config,
    runRiskPack: async () => ({ allPassed: true, message: '', steps: [{ key: 'mobile2', ok: true }] }),
    httpClient: async () => ({ ok: true, status: 200, async text() { return JSON.stringify({ code: '200' }) } }),
  })

  const match = gateway.findReusableDuodiandianApplyRiskReview(db, {
    userName: 'Alice',
    phoneNumber: '13900139000',
    idNumber: '110101199001011234',
  }, config)
  const mismatch = gateway.findReusableDuodiandianApplyRiskReview(db, {
    userName: 'Alice',
    phoneNumber: '13900139000',
    idNumber: '110101199001011235',
  }, config)

  assert.equal(match.app.applyNo, 'A-RISK-REUSE')
  assert.equal(match.status, 'PASS')
  assert.equal(mismatch, null)
})

test('notifies duodiandian audit result from shop order submit machine review after persistence', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8')
  const start = source.indexOf("router.post('/orders', async (ctx) => {")
  const end = source.indexOf("router.patch('/orders/:id/pay'", start)
  assert(start >= 0 && end > start, 'order submit route must be found')
  const orderSubmitRoute = source.slice(start, end)
  assert.match(orderSubmitRoute, /await flushMongoPersist\(\)[\s\S]*queueDuodiandianOrderNotify\('risk_pass', nextOrder, readDb\(\)\)/)
  assert.match(orderSubmitRoute, /await flushMongoPersist\(\)[\s\S]*queueDuodiandianOrderNotify\('risk_reject', nextOrder, readDb\(\)\)/)
})

test('order submit reuses duodiandian apply pre-review before calling paid risk pack', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8')
  const start = source.indexOf("router.post('/orders', async (ctx) => {")
  const end = source.indexOf("router.patch('/orders/:id/pay'", start)
  assert(start >= 0 && end > start, 'order submit route must be found')
  const orderSubmitRoute = source.slice(start, end)
  const reuseIndex = orderSubmitRoute.indexOf('findReusableDuodiandianApplyRiskReview')
  const packIndex = orderSubmitRoute.indexOf('await runOrderSubmitUpstreamRiskPack')
  assert(reuseIndex >= 0, 'order submit route should look for reusable duodiandian apply pre-review')
  assert(packIndex >= 0, 'order submit route should still keep normal paid risk pack fallback')
  assert(reuseIndex < packIndex, 'pre-review reuse must be checked before paid risk pack is called')
  assert.match(orderSubmitRoute, /riskReviewSource\s*=\s*'duodiandian_apply'/)
  assert.match(orderSubmitRoute, /riskOrderSubmitPack\s*=\s*false/)
})
