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
  assert(paths.includes('/open/partners/env-ddd/login/consume'))
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

function makePlainCtx(payload) {
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
  const jobs = []
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
    scheduleAsyncJob(fn) {
      jobs.push(fn)
    },
    configProvider: () => config,
  })
  return {
    router,
    calls,
    jobs,
  }
}

function fullApplyPayload(overrides = {}) {
  return {
    applyNo: 'A-FULL',
    applyIp: '127.0.0.1',
    userPhone: '13900139000',
    idNo: '110101199001011234',
    name: 'Alice',
    frontImage: 'https://img.example.com/front.jpg',
    backImage: 'https://img.example.com/back.jpg',
    faceImg: 'https://img.example.com/face.jpg',
    gender: 'GIRL',
    clientType: 'h5',
    homeAddress: '上海市浦东新区',
    relations: [
      { name: 'Bob', phone: '13800138000', relation: 'FATHER' },
      { name: 'Cindy', phone: '13700137000', relation: 'FRIEND' },
    ],
    ...overrides,
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
  const ctx = makeCtx(fullApplyPayload({ applyNo: 'A-APPLY' }))

  await state.router.routes.get('/open/partners/env-ddd/apply')(ctx)

  assert.equal(ctx.status, 200)
  assert.deepEqual(state.counts(), { reads: 1, writes: 1 })
  assert.equal(ctx.body.data.status, '1')
  assert.equal(ctx.body.data.approvalAmount, '2750')
  assert.equal(ctx.body.data.approvalStatus, 'ING')
  assert.match(ctx.body.data.partnerOrderNo, /^DDD[A-F0-9]{16}$/)
  assert.equal(db.partnerGatewayApplications.length, 1)
})

test('apply persists only duodiandian gateway collections and flushes before success', async () => {
  const db = { users: [], orders: [], trafficChannels: [], trafficPartners: [], partnerGatewayApplications: [] }
  const state = registerScopedRoutes(db)
  const ctx = makeCtx(fullApplyPayload({ applyNo: 'A-SCOPED', userPhone: '18800001111' }))

  await state.router.routes.get('/open/partners/env-ddd/apply')(ctx)

  assert.equal(ctx.status, 200)
  assert.deepEqual(state.calls.map(call => call.type), ['read', 'partialWrite', 'flush'])
  assert.deepEqual(state.calls[1].keys, ['partnerGatewayApplications', 'trafficChannels', 'trafficPartners'])
  assert.equal(state.calls[2].applicationCount, 1)
  assert.equal(db.partnerGatewayApplications[0].applyNo, 'A-SCOPED')
})

test('apply rejects incomplete payload before persistence or async review', async () => {
  const db = { users: [], orders: [], trafficChannels: [], trafficPartners: [], partnerGatewayApplications: [] }
  const state = registerScopedRoutes(db)
  const ctx = makeCtx({ applyNo: 'A-INCOMPLETE', userPhone: '13900139000' })

  await state.router.routes.get('/open/partners/env-ddd/apply')(ctx)

  assert.equal(ctx.status, 400)
  assert.match(ctx.body.msg, /资料|参数|payload/i)
  assert.deepEqual(state.calls.map(call => call.type), ['read'])
  assert.equal(state.jobs.length, 0)
  assert.equal(db.partnerGatewayApplications.length, 0)
})

test('apply accepts complete payload quickly and defers risk review to async job', async () => {
  const db = { users: [], orders: [], trafficChannels: [], trafficPartners: [], partnerGatewayApplications: [] }
  let riskCalls = 0
  const calls = []
  const router = makeCapturingRouter()
  const jobs = []
  gateway.registerDuodiandianGatewayRoutes(router, {
    readDb() { return db },
    writeDb() { calls.push({ type: 'fullWrite' }) },
    writeDbPartial(_db, keys) { calls.push({ type: 'partialWrite', keys }) },
    async flushMongoPersist() { calls.push({ type: 'flush', users: db.users.length }) },
    scheduleAsyncJob(fn) { jobs.push(fn) },
    runApplyRiskPack: async () => {
      riskCalls += 1
      return { allPassed: true, message: '', steps: [{ key: 'mobile2', label: '运营商二要素验证', ok: true }] }
    },
    httpClient: async () => ({ ok: true, status: 200, async text() { return JSON.stringify({ code: '200' }) } }),
    configProvider: () => config,
  })

  const ctx = makeCtx(fullApplyPayload({ applyNo: 'A-ASYNC-PASS' }))
  await router.routes.get('/open/partners/env-ddd/apply')(ctx)

  assert.equal(ctx.status, 200)
  assert.equal(ctx.body.data.approvalStatus, 'ING')
  assert.equal(ctx.body.data.approvalAmount, '2750')
  assert.match(ctx.body.data.returnUrl, /\/login\?/)
  assert.doesNotMatch(ctx.body.data.returnUrl, /\/traffic-login\?/)
  assert.equal(new URL(ctx.body.data.returnUrl).searchParams.get('trafficLogin'), '1')
  assert.equal(new URL(ctx.body.data.returnUrl).searchParams.get('consumePath'), '/api/open/partners/env-ddd/login/consume')
  assert.equal(riskCalls, 0)
  assert.equal(db.users.length, 0)
  assert.equal(jobs.length, 1)
  assert.deepEqual(calls[0].keys, ['partnerGatewayApplications', 'trafficChannels', 'trafficPartners'])

  await jobs[0]()

  assert.equal(riskCalls, 1)
  assert.equal(db.users.length, 1)
  assert.equal(db.users[0].phone, '13900139000')
  assert.equal(db.users[0].idNumber, '110101199001011234')
  assert.equal(db.users[0].idCardFront, 'https://img.example.com/front.jpg')
  assert.equal(db.users[0].idCardBack, 'https://img.example.com/back.jpg')
  assert.equal(db.users[0].idCardHandheld, 'https://img.example.com/face.jpg')
  assert.deepEqual(db.users[0].emergencyContacts, [
    { name: 'Bob', phone: '13800138000', relation: 'FATHER' },
    { name: 'Cindy', phone: '13700137000', relation: 'FRIEND' },
  ])
  assert.equal(db.users[0].registerChannelCode, 'env-ddd')
  assert.equal(db.users[0].quota, 2750)
  assert.equal(db.users[0].duodiandianApplyNo, 'A-ASYNC-PASS')
  const app = db.partnerGatewayApplications[0]
  assert.equal(app.mallUserId, db.users[0].id)
  assert.equal(app.riskReviewStatus, 'PASS')
  assert.equal(app.riskNotifyPayload.approvalAmount, '2750')
  assert.equal(app.riskNotifyPayload.availableAmount, '2750')
  assert.equal(app.loginTokenConsumedAt, '')
  assert(app.loginTokenHash)
  assert.equal(app.rawApplyPayload.frontImage, 'https://img.example.com/front.jpg')
  assert.deepEqual(calls.filter(call => call.type === 'partialWrite').at(-1).keys, ['partnerGatewayApplications', 'users'])
})

test('async apply review rejects duplicate phone without mutating existing users', async () => {
  const existing = {
    id: 'U-OLD',
    name: 'Existing',
    phone: '13900139000',
    idNumber: '110101199001011234',
    idCardFront: 'old-front',
  }
  const db = { users: [{ ...existing }], orders: [], trafficChannels: [], trafficPartners: [], partnerGatewayApplications: [] }
  let riskCalls = 0
  const jobs = []
  const router = makeCapturingRouter()
  gateway.registerDuodiandianGatewayRoutes(router, {
    readDb() { return db },
    writeDb() {},
    writeDbPartial() {},
    async flushMongoPersist() {},
    scheduleAsyncJob(fn) { jobs.push(fn) },
    runApplyRiskPack: async () => {
      riskCalls += 1
      return { allPassed: true, steps: [] }
    },
    httpClient: async () => ({ ok: true, status: 200, async text() { return JSON.stringify({ code: '200' }) } }),
    configProvider: () => config,
  })

  await router.routes.get('/open/partners/env-ddd/apply')(makeCtx(fullApplyPayload({ applyNo: 'A-DUP-USER' })))
  await jobs[0]()

  assert.equal(riskCalls, 0)
  assert.deepEqual(db.users, [existing])
  assert.equal(db.partnerGatewayApplications[0].riskReviewStatus, 'REJECT')
  assert.match(db.partnerGatewayApplications[0].riskReviewReason, /已存在|duplicate/i)
})

test('duodiandian login token can be consumed once after async approval', async () => {
  const db = { users: [], orders: [], trafficChannels: [], trafficPartners: [], partnerGatewayApplications: [] }
  const jobs = []
  const router = makeCapturingRouter()
  gateway.registerDuodiandianGatewayRoutes(router, {
    readDb() { return db },
    writeDb() {},
    writeDbPartial() {},
    async flushMongoPersist() {},
    scheduleAsyncJob(fn) { jobs.push(fn) },
    runApplyRiskPack: async () => ({ allPassed: true, message: '', steps: [] }),
    httpClient: async () => ({ ok: true, status: 200, async text() { return JSON.stringify({ code: '200' }) } }),
    configProvider: () => config,
  })

  const applyCtx = makeCtx(fullApplyPayload({ applyNo: 'A-TOKEN' }))
  await router.routes.get('/open/partners/env-ddd/apply')(applyCtx)
  await jobs[0]()
  const token = new URL(applyCtx.body.data.returnUrl).searchParams.get('token')

  const first = makePlainCtx({ applyNo: 'A-TOKEN', token })
  await router.routes.get('/open/partners/env-ddd/login/consume')(first)
  assert.equal(first.status, 200)
  assert.equal(first.body.data.token, 'mock-token-13900139000')
  assert.equal(first.body.data.user.phone, '13900139000')
  assert.equal(first.body.data.user.riskControlSnapshot, undefined)

  const second = makePlainCtx({ applyNo: 'A-TOKEN', token })
  await router.routes.get('/open/partners/env-ddd/login/consume')(second)
  assert.equal(second.status, 400)
  assert.match(second.body.msg, /已使用|used|失效/i)
})

test('getUrl issues a fresh login token after async approval', async () => {
  const db = { users: [], orders: [], trafficChannels: [], trafficPartners: [], partnerGatewayApplications: [] }
  const jobs = []
  const router = makeCapturingRouter()
  gateway.registerDuodiandianGatewayRoutes(router, {
    readDb() { return db },
    writeDb() {},
    writeDbPartial() {},
    async flushMongoPersist() {},
    scheduleAsyncJob(fn) { jobs.push(fn) },
    runApplyRiskPack: async () => ({ allPassed: true, message: '', steps: [] }),
    httpClient: async () => ({ ok: true, status: 200, async text() { return JSON.stringify({ code: '200' }) } }),
    configProvider: () => config,
  })

  await router.routes.get('/open/partners/env-ddd/apply')(makeCtx(fullApplyPayload({ applyNo: 'A-GETURL-TOKEN' })))
  await jobs[0]()

  const getUrlCtx = makeCtx({ applyNo: 'A-GETURL-TOKEN', userPhone: '13900139000', h5Type: 'DETAIL' })
  await router.routes.get('/open/partners/env-ddd/getUrl')(getUrlCtx)

  assert.equal(getUrlCtx.status, 200)
  const url = new URL(getUrlCtx.body.data.url)
  assert.equal(url.pathname, '/login')
  assert.equal(url.searchParams.get('trafficLogin'), '1')
  assert.equal(url.searchParams.get('consumePath'), '/api/open/partners/env-ddd/login/consume')
  assert.equal(url.searchParams.get('applyNo'), 'A-GETURL-TOKEN')
  assert(url.searchParams.get('token'), 'getUrl must return a usable login token')

  const consumeCtx = makePlainCtx({ applyNo: 'A-GETURL-TOKEN', token: url.searchParams.get('token') })
  await router.routes.get('/open/partners/env-ddd/login/consume')(consumeCtx)
  assert.equal(consumeCtx.status, 200)
  assert.equal(consumeCtx.body.data.token, 'mock-token-13900139000')
})

test('checkPrefIx blocks a phone prefix immediately after apply succeeds', async () => {
  const db = { users: [], orders: [], trafficChannels: [], trafficPartners: [], partnerGatewayApplications: [] }
  const state = registerScopedRoutes(db)

  await state.router.routes.get('/open/partners/env-ddd/apply')(makeCtx(fullApplyPayload({ applyNo: 'A-DUP', userPhone: '18800001111' })))
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
    gateway.resolveDuodiandianMongoRefreshPlan('POST', '/open/partners/env-ddd/login/consume', config),
    { mode: 'partial', keys: ['users', 'partnerGatewayApplications'], allowColdPartial: true },
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
  const app = gateway.upsertDuodiandianApplication(db, { applyNo: 'A001', userPhone: '13900139000' }, config)
  gateway.bindPartnerOrderNo(db, 'A001', 'P001', config)
  app.mallUserId = 'U-DDD-001'
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
      mallUserId: 'U-DDD-001',
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
  assert.equal(payloads[2].replayAmount, '1200')
  assert.equal(payloads[2].replayFeeAmount, '0')
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
  assert.equal(app.riskNotifyPayload.approvalAmount, '2750')
  assert.equal(app.riskNotifyPayload.availableAmount, '2750')
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
