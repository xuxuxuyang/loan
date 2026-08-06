const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const gateway = require('../src/halfFlowTrafficGateway')

const config = {
  enabled: true,
  routePrefix: '/open/partners/half-flow',
  channelCode: 'half-flow-test',
  registerChannelCode: 'lihalfflow-test',
  registerChannelName: '丽半流程',
  aesKey: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
  creditNotifyUrl: 'https://partner.example.com/credit/notify',
  customerServicePhone: '4000000000',
  defaultAmount: 2750,
  defaultUserQuota: 2750,
  creditExpireDays: 365,
  loginTokenTtlMs: 600000,
  notifyTimeoutMs: 8000,
  loanUrlTemplate: 'https://shop.example.com/login?trafficLogin=1&channel={channel}&orderId={orderId}&token={token}&consumePath={consumePath}&domainUrl={domainUrl}',
}

function makeApplyPayload(overrides = {}) {
  return {
    orderId: 'HF-ORDER-001',
    mobile: '13812345678',
    name: '张三',
    idCard: '32010119900307663X',
    authInfo: {
      idCardFront: 'https://cdn.example.com/front.jpg',
      idCardBack: 'https://cdn.example.com/back.jpg',
      faceUrl: 'https://cdn.example.com/face.jpg',
      faceScore: '95',
      confidence: '0.99',
      faceTime: '2026-07-31 12:00:00',
      nativePlace: '江苏省南京市',
      effectiveDate: '20200101-20300101',
      gender: '男',
      birthday: '19900307',
      nation: '汉',
      lssuing: '南京市公安局',
      age: '36',
    },
    baseInfo: {
      marital: 2,
      education: 2,
      isOpType: 1,
      province: '江苏省',
      city: '南京市',
      area: '玄武区',
      address: '测试路1号',
      companyAddress: '产业园2号',
      companyName: '测试公司',
      companyPhone: '',
      monthlyAverageIncome: 1,
      industry: 8,
    },
    deviceInfo: {
      lng: '118.7969',
      lat: '32.0603',
      osType: 2,
      ip: '127.0.0.1',
      deviceid: 'device-001',
    },
    contactInfos: {
      commonName: '李四',
      commonPhone: '13912345678',
      commonRelationship: 5,
      emergentName: '王五',
      emergentPhone: '13712345678',
      emergentRelationship: 6,
    },
    domainUrl: 'https://partner.example.com/return',
    ...overrides,
  }
}

async function seedApprovedApplication(options = {}) {
  const repository = options.repository || gateway.createMemoryHalfFlowTrafficRepository()
  const payload = options.payload || makeApplyPayload()
  await gateway.handleHalfFlowAdmission({
    payload: {
      mobileMd5: gateway.md5(payload.mobile),
      idCardMd5: gateway.md5(payload.idCard),
    },
    db: { users: [] },
    repository,
    config,
    now: () => 1760000000000,
  })
  await gateway.handleHalfFlowApply({
    payload,
    repository,
    config,
    now: () => 1760000000000,
  })
  return {
    payload,
    repository,
    row: await repository.findByOrderId(payload.orderId),
  }
}

function makeRouter() {
  const routes = new Map()
  return {
    routes,
    post(pathValue, handler) {
      routes.set(pathValue, handler)
    },
  }
}

function makeCtx(body, channelCode = config.channelCode) {
  return {
    request: { body },
    status: 0,
    body: null,
    get(name) {
      return String(name).toLowerCase() === 'channelcode' ? channelCode : ''
    },
  }
}

function encryptedRequest(payload) {
  return { data: gateway.encryptHalfFlowJson(payload, config) }
}

test('uses only explicit HALF_FLOW_TRAFFIC environment values', () => {
  const parsed = gateway.halfFlowTrafficConfigFromEnv({
    HALF_FLOW_TRAFFIC_ENABLED: 'true',
    HALF_FLOW_TRAFFIC_ROUTE_PREFIX: config.routePrefix,
    HALF_FLOW_TRAFFIC_CHANNEL_CODE: config.channelCode,
    HALF_FLOW_TRAFFIC_REGISTER_CHANNEL_CODE: config.registerChannelCode,
    HALF_FLOW_TRAFFIC_REGISTER_CHANNEL_NAME: config.registerChannelName,
    HALF_FLOW_TRAFFIC_AES_KEY: config.aesKey,
    HALF_FLOW_TRAFFIC_CREDIT_NOTIFY_URL: config.creditNotifyUrl,
    HALF_FLOW_TRAFFIC_CUSTOMER_SERVICE_PHONE: config.customerServicePhone,
    HALF_FLOW_TRAFFIC_DEFAULT_AMOUNT: '2750',
    HALF_FLOW_TRAFFIC_DEFAULT_USER_QUOTA: '2750',
    HALF_FLOW_TRAFFIC_CREDIT_EXPIRE_DAYS: '365',
    HALF_FLOW_TRAFFIC_LOGIN_TOKEN_TTL_MS: '600000',
    HALF_FLOW_TRAFFIC_NOTIFY_TIMEOUT_MS: '8000',
    HALF_FLOW_TRAFFIC_LOAN_URL_TEMPLATE: config.loanUrlTemplate,
  })

  assert.deepEqual(parsed, config)
  assert.equal(gateway.halfFlowTrafficConfigFromEnv({}).enabled, false)
  assert.equal(gateway.halfFlowTrafficConfigFromEnv({}).defaultAmount, undefined)
})

test('validates every required value only when the gateway is enabled', () => {
  assert.deepEqual(gateway.validateEnabledHalfFlowTrafficConfig(config), {
    valid: true,
    missing: [],
    invalid: [],
  })
  assert.deepEqual(gateway.validateEnabledHalfFlowTrafficConfig({ enabled: false }), {
    valid: true,
    missing: [],
    invalid: [],
  })

  const missing = gateway.validateEnabledHalfFlowTrafficConfig({ enabled: true })
  assert.equal(missing.valid, false)
  assert(missing.missing.includes('routePrefix'))
  assert(missing.missing.includes('aesKey'))
  assert(missing.missing.includes('registerChannelCode'))
  assert(missing.missing.includes('loanUrlTemplate'))

  const invalid = gateway.validateEnabledHalfFlowTrafficConfig({
    ...config,
    routePrefix: 'open/partners/half-flow',
    registerChannelCode: 'invalid channel code',
    aesKey: 'not-base64',
    defaultAmount: 0,
    creditNotifyUrl: 'ftp://invalid.example.com',
    loanUrlTemplate: 'https://shop.example.com/login',
  })
  assert.equal(invalid.valid, false)
  assert(invalid.invalid.includes('routePrefix'))
  assert(invalid.invalid.includes('registerChannelCode'))
  assert(invalid.invalid.includes('aesKey'))
  assert(invalid.invalid.includes('defaultAmount'))
  assert(invalid.invalid.includes('creditNotifyUrl'))
  assert(invalid.invalid.includes('loanUrlTemplate'))
})

test('rejects unsafe numeric gateway configuration before routes are registered', () => {
  const unsafeValues = {
    defaultAmount: 10_000_001,
    defaultUserQuota: 10_000_001,
    creditExpireDays: 3651,
    loginTokenTtlMs: 86_400_001,
    notifyTimeoutMs: 60_001,
  }

  for (const [field, value] of Object.entries(unsafeValues)) {
    const result = gateway.validateEnabledHalfFlowTrafficConfig({ ...config, [field]: value })
    assert.equal(result.valid, false, `${field} should reject ${value}`)
    assert(result.invalid.includes(field), `${field} should be listed as invalid`)
  }

  for (const field of ['defaultAmount', 'defaultUserQuota', 'creditExpireDays', 'loginTokenTtlMs', 'notifyTimeoutMs']) {
    const result = gateway.validateEnabledHalfFlowTrafficConfig({ ...config, [field]: 1.5 })
    assert.equal(result.valid, false, `${field} should require an integer`)
    assert(result.invalid.includes(field), `${field} should be listed as invalid`)
  }
})

test('requires HTTPS callback and H5 URLs when production routes are enabled', () => {
  const httpConfig = {
    ...config,
    creditNotifyUrl: 'http://partner.example.com/credit/notify',
    loanUrlTemplate: config.loanUrlTemplate.replace('https://', 'http://'),
  }
  assert.equal(gateway.validateEnabledHalfFlowTrafficConfig(httpConfig, { nodeEnv: 'development' }).valid, true)

  const production = gateway.validateEnabledHalfFlowTrafficConfig(httpConfig, { nodeEnv: 'production' })
  assert.equal(production.valid, false)
  assert(production.invalid.includes('creditNotifyUrl'))
  assert(production.invalid.includes('loanUrlTemplate'))
})

test('matches the fixed AES-256-CTR NoPadding protocol vector', () => {
  const payload = {
    idCardMd5: '95dbf70af76519537e4fa8801f339ee2',
    mobileMd5: '6643f667b12386a1bb2e1adf8f054d0e',
  }
  const nonce = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex')
  const encrypted = gateway.encryptHalfFlowJson(payload, config, nonce)

  assert.equal(encrypted, 'AAECAwQFBgcICQoLDA0ODyh/tZHVrkQATFiyb7+rghQiMrV6MkZtYgpz8ulbqsormH0wInfizhTfy5xvynF0WJSZ/y8rDGrMKJcevvAPuOkZLNhSg1fhLDpwS4rD+WkBMgrujSrFsY9S/zdFFEfH')
  assert.deepEqual(gateway.decryptHalfFlowData(encrypted, config), payload)
})

test('NoPadding ciphertext length matches the UTF-8 JSON byte length', () => {
  const payload = { text: '联调测试', orderId: 'HF-NOPADDING-001' }
  const nonce = Buffer.alloc(16, 7)
  const encrypted = Buffer.from(gateway.encryptHalfFlowJson(payload, config, nonce), 'base64')

  assert.equal(encrypted.subarray(16).length, Buffer.byteLength(JSON.stringify(payload), 'utf8'))
  assert.deepEqual(gateway.decryptHalfFlowData(encrypted.toString('base64'), config), payload)
})

test('validates the documented admission, apply, and H5 payloads', () => {
  assert.deepEqual(gateway.assertAdmissionPayload({
    idCardMd5: '95DBF70AF76519537E4FA8801F339EE2',
    mobileMd5: '6643F667B12386A1BB2E1ADF8F054D0E',
  }), {
    idCardMd5: '95dbf70af76519537e4fa8801f339ee2',
    mobileMd5: '6643f667b12386a1bb2e1adf8f054d0e',
  })

  const payload = makeApplyPayload()
  assert.doesNotThrow(() => gateway.assertApplyPayload(payload))
  assert.deepEqual(gateway.assertAppLinkPayload({ orderId: payload.orderId, domainUrl: payload.domainUrl }), {
    orderId: payload.orderId,
    domainUrl: payload.domainUrl,
  })
  assert.throws(
    () => gateway.assertApplyPayload({ ...payload, authInfo: { ...payload.authInfo, lssuing: '' } }),
    /authInfo\.lssuing/,
  )
  assert.throws(
    () => gateway.assertApplyPayload({ ...payload, contactInfos: { ...payload.contactInfos, emergentPhone: '' } }),
    /contactInfos\.emergentPhone/,
  )
  assert.throws(() => gateway.assertAdmissionPayload({ idCardMd5: 'bad', mobileMd5: 'bad' }), /MD5/)
})

test('keeps applications in a dedicated half-flow repository', async () => {
  assert.equal(gateway.HALF_FLOW_COLLECTION_NAME, 'halfFlowTrafficApplications')
  const repository = gateway.createMemoryHalfFlowTrafficRepository()
  const row = {
    id: 'HF-A1',
    orderId: 'HF-ORDER-001',
    mobileMd5: 'a'.repeat(32),
    idCardMd5: 'b'.repeat(32),
    loginTokenHash: 'token-hash',
    loginTokenConsumedAt: '',
  }
  await repository.save(row)

  assert.equal((await repository.findByHashes(row.mobileMd5, row.idCardMd5)).id, row.id)
  assert.equal((await repository.findByEitherHash(row.mobileMd5, 'c'.repeat(32))).id, row.id)
  assert.equal((await repository.findByOrderId(row.orderId)).id, row.id)
  assert.equal((await repository.list()).length, 1)
  assert.equal(await repository.reserveMallUser({
    id: row.id,
    pendingMallUserId: 'U-PENDING-1',
    preparedAt: '2026-07-31T12:00:00.000Z',
  }), true)
  assert.equal(await repository.reserveMallUser({
    id: row.id,
    pendingMallUserId: 'U-PENDING-2',
    preparedAt: '2026-07-31T12:00:01.000Z',
  }), false)
  assert.equal((await repository.findByOrderId(row.orderId)).pendingMallUserId, 'U-PENDING-1')
  assert.equal(await repository.consumeLoginToken({
    id: row.id,
    tokenHash: row.loginTokenHash,
    consumedAt: '2026-07-31T12:00:00.000Z',
  }), true)
  assert.equal(await repository.consumeLoginToken({
    id: row.id,
    tokenHash: row.loginTokenHash,
    consumedAt: '2026-07-31T12:00:01.000Z',
  }), false)
})

test('admits a new identity only into the half-flow repository', async () => {
  const repository = gateway.createMemoryHalfFlowTrafficRepository()
  const db = {
    users: [],
    orders: [{ id: 'KEEP-ORDER' }],
    partnerGatewayApplications: [{ id: 'KEEP-DDD' }],
    zheyinTrafficApplications: [{ id: 'KEEP-ZY' }],
  }
  const result = await gateway.handleHalfFlowAdmission({
    payload: {
      mobileMd5: gateway.md5('13812345678'),
      idCardMd5: gateway.md5('32010119900307663X'),
    },
    db,
    repository,
    config,
    now: () => 1760000000000,
  })

  assert.deepEqual(result, {
    result: 1,
    reason: '',
    customerServicePhone: config.customerServicePhone,
  })
  assert.equal((await repository.list()).length, 1)
  assert.deepEqual(db.orders, [{ id: 'KEEP-ORDER' }])
  assert.deepEqual(db.partnerGatewayApplications, [{ id: 'KEEP-DDD' }])
  assert.deepEqual(db.zheyinTrafficApplications, [{ id: 'KEEP-ZY' }])
})

test('persists an admitted application as a basic approval without creating a mall user', async () => {
  const repository = gateway.createMemoryHalfFlowTrafficRepository()
  const payload = makeApplyPayload()
  const db = { users: [] }
  await gateway.handleHalfFlowAdmission({
    payload: {
      mobileMd5: gateway.md5(payload.mobile),
      idCardMd5: gateway.md5(payload.idCard),
    },
    db,
    repository,
    config,
    now: () => 1760000000000,
  })

  const result = await gateway.handleHalfFlowApply({
    payload,
    repository,
    config,
    now: () => 1760000000000,
  })
  const stored = await repository.findByOrderId(payload.orderId)

  assert.deepEqual(result.data, {})
  assert.equal(result.shouldNotify, true)
  assert.equal(stored.creditStatus, 'approved')
  assert.equal(stored.creditAmountYuan, 2750)
  assert.equal(stored.creditExpireAt, '2026-10-09T08:53:20.000Z')
  assert.equal(stored.rawApplyPayload.orderId, payload.orderId)
  assert.equal(stored.userPhoneMasked, '138****5678')
  assert.equal(stored.idCardMasked, '3201**********663X')
  assert.equal(stored.mallUserId, undefined)
  assert.equal(db.users.length, 0)
})

test('rejects an existing mall identity without modifying it or creating an application', async () => {
  const original = {
    id: 'U-OLD',
    name: '历史用户',
    phone: '13812345678',
    idNumber: '32010119900307663X',
    quota: 99,
  }
  const db = { users: [structuredClone(original)] }
  const repository = gateway.createMemoryHalfFlowTrafficRepository()
  const result = await gateway.handleHalfFlowAdmission({
    payload: {
      mobileMd5: gateway.md5(original.phone),
      idCardMd5: gateway.md5('110101199001011234'),
    },
    db,
    repository,
    config,
  })

  assert.equal(result.result, 0)
  assert.deepEqual(db.users[0], original)
  assert.equal((await repository.list()).length, 0)
})

test('keeps admission and apply idempotent while rejecting identity or order replacement', async () => {
  const repository = gateway.createMemoryHalfFlowTrafficRepository()
  const payload = makeApplyPayload()
  const admissionPayload = {
    mobileMd5: gateway.md5(payload.mobile),
    idCardMd5: gateway.md5(payload.idCard),
  }
  await gateway.handleHalfFlowAdmission({ payload: admissionPayload, db: { users: [] }, repository, config })
  await gateway.handleHalfFlowAdmission({ payload: admissionPayload, db: { users: [] }, repository, config })
  assert.equal((await repository.list()).length, 1)

  const first = await gateway.handleHalfFlowApply({ payload, repository, config })
  const repeated = await gateway.handleHalfFlowApply({ payload, repository, config })
  assert.equal(first.shouldNotify, true)
  assert.equal(repeated.shouldNotify, false)
  assert.equal((await repository.list()).length, 1)

  await assert.rejects(
    () => gateway.handleHalfFlowApply({ payload: { ...payload, orderId: 'HF-ORDER-002' }, repository, config }),
    /another orderId/,
  )
  await assert.rejects(
    () => gateway.handleHalfFlowApply({ payload: { ...payload, mobile: '13612345678' }, repository, config }),
    /not passed admission|another identity/,
  )
})

test('serializes concurrent admission for the same or partially matching identity', async () => {
  const repository = gateway.createMemoryHalfFlowTrafficRepository()
  const mobileMd5 = gateway.md5('13812345678')
  const firstIdCardMd5 = gateway.md5('32010119900307663X')
  const secondIdCardMd5 = gateway.md5('110101199001011234')
  const args = { db: { users: [] }, repository, config, now: () => 1760000000000 }

  const samePair = await Promise.all([
    gateway.handleHalfFlowAdmission({ ...args, payload: { mobileMd5, idCardMd5: firstIdCardMd5 } }),
    gateway.handleHalfFlowAdmission({ ...args, payload: { mobileMd5, idCardMd5: firstIdCardMd5 } }),
  ])
  assert.deepEqual(samePair.map(item => item.result), [1, 1])
  assert.equal((await repository.list()).length, 1)

  const conflictRepository = gateway.createMemoryHalfFlowTrafficRepository()
  const crossPair = await Promise.all([
    gateway.handleHalfFlowAdmission({
      ...args,
      repository: conflictRepository,
      payload: { mobileMd5, idCardMd5: firstIdCardMd5 },
    }),
    gateway.handleHalfFlowAdmission({
      ...args,
      repository: conflictRepository,
      payload: { mobileMd5, idCardMd5: secondIdCardMd5 },
    }),
  ])
  assert.deepEqual(crossPair.map(item => item.result).sort(), [0, 1])
  assert.equal((await conflictRepository.list()).length, 1)
})

test('allows only one admitted identity to bind a concurrently reused orderId', async () => {
  const repository = gateway.createMemoryHalfFlowTrafficRepository()
  const first = makeApplyPayload()
  const second = makeApplyPayload({
    mobile: '13612345678',
    idCard: '110101199001011234',
  })
  for (const payload of [first, second]) {
    await gateway.handleHalfFlowAdmission({
      payload: {
        mobileMd5: gateway.md5(payload.mobile),
        idCardMd5: gateway.md5(payload.idCard),
      },
      db: { users: [] },
      repository,
      config,
    })
  }

  const settled = await Promise.allSettled([
    gateway.handleHalfFlowApply({ payload: first, repository, config }),
    gateway.handleHalfFlowApply({ payload: second, repository, config }),
  ])
  assert.equal(settled.filter(item => item.status === 'fulfilled').length, 1)
  assert.equal(settled.filter(item => item.status === 'rejected').length, 1)
  const rows = await repository.list()
  assert.equal(rows.filter(item => item.orderId === first.orderId).length, 1)
})

test('sends an encrypted status-3 callback after the approved application is persisted', async () => {
  const { repository, row } = await seedApprovedApplication()
  const calls = []
  const result = await gateway.notifyHalfFlowCreditResult({
    row,
    repository,
    config,
    httpClient: async (url, options) => {
      assert.equal((await repository.findByOrderId(row.orderId)).creditStatus, 'approved')
      calls.push({ url, options })
      return {
        ok: true,
        status: 200,
        async text() { return JSON.stringify({ code: 0 }) },
      }
    },
    now: () => 1760000001000,
  })

  assert.equal(result.sent, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, config.creditNotifyUrl)
  assert.equal(calls[0].options.headers.ChannelCode, config.channelCode)
  const callbackBody = JSON.parse(calls[0].options.body)
  assert.deepEqual(Object.keys(callbackBody), ['data'])
  assert.deepEqual(gateway.decryptHalfFlowData(callbackBody.data, config), {
    orderId: row.orderId,
    orderStatus: 3,
    money: 275000,
    expireTime: Date.parse(row.creditExpireAt),
  })
  const stored = await repository.findByOrderId(row.orderId)
  assert.equal(stored.lastNotifyStatus, 'success')
  assert.equal(stored.notifyLogs.length, 1)
})

test('records callback failures without rolling back credit and deduplicates success', async () => {
  const failedFixture = await seedApprovedApplication()
  const failed = await gateway.notifyHalfFlowCreditResult({
    row: failedFixture.row,
    repository: failedFixture.repository,
    config,
    httpClient: async () => { throw new Error('network down') },
    now: () => 1760000001000,
  })
  const failedRow = await failedFixture.repository.findByOrderId(failedFixture.row.orderId)
  assert.equal(failed.sent, false)
  assert.equal(failedRow.creditStatus, 'approved')
  assert.equal(failedRow.lastNotifyStatus, 'failed')

  const successFixture = await seedApprovedApplication()
  let callCount = 0
  const client = async () => {
    callCount += 1
    return { ok: true, status: 200, async text() { return '{"code":"0"}' } }
  }
  const sent = await gateway.notifyHalfFlowCreditResult({
    row: successFixture.row,
    repository: successFixture.repository,
    config,
    httpClient: client,
  })
  const duplicate = await gateway.notifyHalfFlowCreditResult({
    row: successFixture.row,
    repository: successFixture.repository,
    config,
    httpClient: client,
  })
  assert.equal(sent.sent, true)
  assert.equal(duplicate.reason, 'duplicate_skipped')
  assert.equal(callCount, 1)
})

test('claims a concurrent credit callback once and stores only allowlisted remote fields', async () => {
  const { repository, row } = await seedApprovedApplication()
  let callCount = 0
  let releaseResponse
  const responseGate = new Promise(resolve => { releaseResponse = resolve })
  const client = async () => {
    callCount += 1
    await responseGate
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          code: 0,
          message: 'accepted',
          idCard: '32010119900307663X',
          nested: { mobile: '13812345678' },
        })
      },
    }
  }

  const notifications = [
    gateway.notifyHalfFlowCreditResult({ row, repository, config, httpClient: client }),
    gateway.notifyHalfFlowCreditResult({ row: structuredClone(row), repository, config, httpClient: client }),
  ]
  await new Promise(resolve => setImmediate(resolve))
  releaseResponse()
  const results = await Promise.all(notifications)

  assert.equal(callCount, 1)
  assert.equal(results.filter(item => item.sent).length, 1)
  assert.equal(results.filter(item => item.reason === 'notification_in_progress').length, 1)
  const stored = await repository.findByOrderId(row.orderId)
  const logText = JSON.stringify(stored.notifyLogs)
  assert.equal(logText.includes('32010119900307663X'), false)
  assert.equal(logText.includes('13812345678'), false)
  assert.equal(stored.notifyLogs[0].remoteCode, '0')
  assert.equal(Object.hasOwn(stored.notifyLogs[0], 'remoteMessage'), false)
  assert.equal(Object.hasOwn(stored.notifyLogs[0], 'body'), false)
})

test('prevents an expired callback owner from overwriting a newer result', async () => {
  const { repository, row } = await seedApprovedApplication()
  const startedAt = 1760000001000
  let releaseOld
  const oldGate = new Promise(resolve => { releaseOld = resolve })
  const oldRequest = gateway.notifyHalfFlowCreditResult({
    row,
    repository,
    config,
    now: () => startedAt,
    httpClient: async () => {
      await oldGate
      return { ok: false, status: 500, async text() { return '{"code":1,"message":"old failure"}' } }
    },
  })
  await new Promise(resolve => setImmediate(resolve))

  const replacement = await gateway.notifyHalfFlowCreditResult({
    row: structuredClone(row),
    repository,
    config,
    now: () => startedAt + 60_001,
    httpClient: async () => ({ ok: true, status: 200, async text() { return '{"code":0}' } }),
  })
  releaseOld()
  const expiredOwner = await oldRequest

  assert.equal(replacement.sent, true)
  assert.equal(expiredOwner.reason, 'claim_lost')
  const stored = await repository.findByOrderId(row.orderId)
  assert.equal(stored.lastNotifyStatus, 'success')
  assert.equal(stored.notifyLogs.length, 1)
  assert.equal(stored.notifyLogs[0].reason, 'ok')
})

test('creates one new mall user only when an approved application requests H5', async () => {
  const { repository, row, payload } = await seedApprovedApplication()
  const db = { users: [], orders: [{ id: 'KEEP-ORDER' }] }
  const writes = []
  let flushCount = 0
  const result = await gateway.handleHalfFlowAppLink({
    payload: { orderId: row.orderId, domainUrl: payload.domainUrl },
    db,
    repository,
    config,
    now: () => 1760000002000,
    writeDbEntity: (nextDb, key, item) => writes.push({ nextDb, key, item }),
    flushMongoPersist: async () => { flushCount += 1 },
  })

  assert.equal(db.users.length, 1)
  assert.equal(db.orders.length, 1)
  assert.equal(db.users[0].phone, payload.mobile)
  assert.equal(db.users[0].idNumber, payload.idCard)
  assert.equal(db.users[0].idCardFront, payload.authInfo.idCardFront)
  assert.equal(db.users[0].idCardBack, payload.authInfo.idCardBack)
  assert.equal(db.users[0].idCardHandheld, payload.authInfo.faceUrl)
  assert.equal(db.users[0].registerChannelCode, config.registerChannelCode)
  assert.equal(db.users[0].registerChannelName, config.registerChannelName)
  assert.equal(db.users[0].quota, config.defaultUserQuota)
  assert.equal(writes[0].key, 'users')
  assert.equal(writes[0].item, db.users[0])
  assert.equal(flushCount, 1)

  const url = new URL(result.repaymentAddress)
  assert.equal(url.searchParams.get('trafficLogin'), '1')
  assert.equal(url.searchParams.get('channel'), config.registerChannelCode)
  assert.equal(url.searchParams.get('orderId'), row.orderId)
  assert.equal(url.searchParams.get('consumePath'), '/api/open/partners/half-flow/login/consume')
  assert.equal(url.searchParams.get('domainUrl'), payload.domainUrl)
  const token = url.searchParams.get('token')
  assert(token)
  const stored = await repository.findByOrderId(row.orderId)
  assert.equal(stored.mallUserId, db.users[0].id)
  assert.notEqual(stored.loginTokenHash, token)
  assert.equal(JSON.stringify(stored).includes(token), false)
})

test('consumes the H5 login token exactly once', async () => {
  const { repository, row } = await seedApprovedApplication()
  const db = { users: [], orders: [] }
  const link = await gateway.handleHalfFlowAppLink({
    payload: { orderId: row.orderId },
    db,
    repository,
    config,
    now: () => 1760000002000,
    writeDbEntity: () => {},
    flushMongoPersist: async () => {},
  })
  const token = new URL(link.repaymentAddress).searchParams.get('token')

  const first = await gateway.consumeHalfFlowLoginToken({
    orderId: row.orderId,
    token,
    db,
    repository,
    config,
    now: () => 1760000003000,
  })
  assert.equal(first.token, 'mock-token-13812345678')
  assert.equal(first.user.phone, '13812345678')

  await assert.rejects(
    () => gateway.consumeHalfFlowLoginToken({
      orderId: row.orderId,
      token,
      db,
      repository,
      config,
      now: () => 1760000004000,
    }),
    /already used|invalid/,
  )
})

test('rejects a late existing identity without binding or changing the user', async () => {
  const { repository, row, payload } = await seedApprovedApplication()
  const original = {
    id: 'U-OLD',
    name: '历史用户',
    phone: payload.mobile,
    idNumber: '110101199001011234',
    quota: 99,
    registerChannelCode: 'existing-channel',
  }
  const db = { users: [structuredClone(original)] }
  await assert.rejects(
    () => gateway.handleHalfFlowAppLink({
      payload: { orderId: row.orderId },
      db,
      repository,
      config,
      writeDbEntity: () => { throw new Error('must not write') },
      flushMongoPersist: async () => { throw new Error('must not flush') },
    }),
    /用户已存在/,
  )
  assert.deepEqual(db.users[0], original)
  assert.equal((await repository.findByOrderId(row.orderId)).mallUserId, undefined)
})

test('reuses only its own mall user and rotates the H5 token', async () => {
  const { repository, row } = await seedApprovedApplication()
  const db = { users: [] }
  let writes = 0
  const deps = {
    db,
    repository,
    config,
    writeDbEntity: () => { writes += 1 },
    flushMongoPersist: async () => {},
  }
  const first = await gateway.handleHalfFlowAppLink({
    ...deps,
    payload: { orderId: row.orderId },
    now: () => 1760000002000,
  })
  const second = await gateway.handleHalfFlowAppLink({
    ...deps,
    payload: { orderId: row.orderId },
    now: () => 1760000003000,
  })

  assert.equal(db.users.length, 1)
  assert.equal(writes, 1)
  assert.notEqual(
    new URL(first.repaymentAddress).searchParams.get('token'),
    new URL(second.repaymentAddress).searchParams.get('token'),
  )
})

test('recovers its own persisted mall user after the application final save fails', async () => {
  const baseRepository = gateway.createMemoryHalfFlowTrafficRepository()
  const fixture = await seedApprovedApplication({ repository: baseRepository })
  let failFinalSave = true
  const repository = {
    ...baseRepository,
    async save(next) {
      if (failFinalSave && next.mallUserId) {
        failFinalSave = false
        throw new Error('application final save failed')
      }
      return baseRepository.save(next)
    },
  }
  const db = { users: [] }
  let writes = 0
  const deps = {
    db,
    repository,
    config,
    now: () => 1760000002000,
    writeDbEntity: () => { writes += 1 },
    flushMongoPersist: async () => {},
  }

  await assert.rejects(
    () => gateway.handleHalfFlowAppLink({
      ...deps,
      payload: { orderId: fixture.row.orderId, domainUrl: fixture.payload.domainUrl },
    }),
    /application final save failed/,
  )
  assert.equal(db.users.length, 1)
  const pending = await baseRepository.findByOrderId(fixture.row.orderId)
  assert.equal(pending.mallUserId, undefined)
  assert.equal(pending.pendingMallUserId, db.users[0].id)

  const restartedDb = { users: structuredClone(db.users) }
  const retried = await gateway.handleHalfFlowAppLink({
    ...deps,
    db: restartedDb,
    payload: { orderId: fixture.row.orderId, domainUrl: fixture.payload.domainUrl },
  })
  assert.match(retried.repaymentAddress, /^https:\/\//)
  assert.equal(db.users.length, 1)
  assert.equal(restartedDb.users.length, 1)
  assert.equal(writes, 2)
  assert.equal((await baseRepository.findByOrderId(fixture.row.orderId)).mallUserId, restartedDb.users[0].id)
})

test('serializes concurrent H5 requests without creating duplicate mall users', async () => {
  const { repository, row } = await seedApprovedApplication()
  const db = { users: [] }
  let writes = 0
  const args = {
    payload: { orderId: row.orderId },
    db,
    repository,
    config,
    now: () => 1760000002000,
    writeDbEntity: () => { writes += 1 },
    flushMongoPersist: async () => {},
  }

  const results = await Promise.all([
    gateway.handleHalfFlowAppLink(args),
    gateway.handleHalfFlowAppLink(args),
  ])
  assert.equal(results.length, 2)
  assert.equal(db.users.length, 1)
  assert.equal(writes, 1)
})

test('rejects an expired H5 login token', async () => {
  const { repository, row } = await seedApprovedApplication()
  const db = { users: [] }
  const issuedAt = 1760000002000
  const link = await gateway.handleHalfFlowAppLink({
    payload: { orderId: row.orderId },
    db,
    repository,
    config,
    now: () => issuedAt,
    writeDbEntity: () => {},
    flushMongoPersist: async () => {},
  })
  const token = new URL(link.repaymentAddress).searchParams.get('token')
  await assert.rejects(
    () => gateway.consumeHalfFlowLoginToken({
      orderId: row.orderId,
      token,
      db,
      repository,
      config,
      now: () => issuedAt + config.loginTokenTtlMs + 1,
    }),
    /expired/,
  )
})

test('registers only the four isolated routes when enabled and fully configured', () => {
  const disabled = makeRouter()
  gateway.registerHalfFlowTrafficGatewayRoutes(disabled, {
    configProvider: () => ({ enabled: false }),
  })
  assert.equal(disabled.routes.size, 0)

  const warnings = []
  const invalid = makeRouter()
  gateway.registerHalfFlowTrafficGatewayRoutes(invalid, {
    configProvider: () => ({ enabled: true }),
    logger: { warn(...args) { warnings.push(args.join(' ')) } },
  })
  assert.equal(invalid.routes.size, 0)
  assert.equal(warnings.length, 1)

  const router = makeRouter()
  gateway.registerHalfFlowTrafficGatewayRoutes(router, {
    configProvider: () => config,
    repository: gateway.createMemoryHalfFlowTrafficRepository(),
    readDb: () => ({ users: [] }),
  })
  assert.deepEqual([...router.routes.keys()].sort(), [
    '/open/partners/half-flow/admission',
    '/open/partners/half-flow/app/link',
    '/open/partners/half-flow/apply',
    '/open/partners/half-flow/login/consume',
  ])
})

test('handles admission with ChannelCode and encrypted protocol responses', async () => {
  const repository = gateway.createMemoryHalfFlowTrafficRepository()
  const router = makeRouter()
  gateway.registerHalfFlowTrafficGatewayRoutes(router, {
    configProvider: () => config,
    repository,
    readDb: () => ({ users: [] }),
  })
  const payload = {
    mobileMd5: gateway.md5('13812345678'),
    idCardMd5: gateway.md5('32010119900307663X'),
  }
  const ctx = makeCtx(encryptedRequest(payload))
  await router.routes.get(`${config.routePrefix}/admission`)(ctx)

  assert.equal(ctx.status, 200)
  assert.equal(ctx.body.code, 0)
  assert.equal(ctx.body.message, 'success')
  assert.deepEqual(gateway.decryptHalfFlowData(ctx.body.data, config), {
    result: 1,
    reason: '',
    customerServicePhone: config.customerServicePhone,
  })

  const wrongChannel = makeCtx(encryptedRequest(payload), 'wrong-channel')
  await router.routes.get(`${config.routePrefix}/admission`)(wrongChannel)
  assert.equal(wrongChannel.status, 200)
  assert.notEqual(wrongChannel.body.code, 0)
  assert.equal(wrongChannel.body.data, '')
})

test('runs the encrypted apply, callback, H5, and plain one-time login flow', async () => {
  const repository = gateway.createMemoryHalfFlowTrafficRepository()
  const db = { users: [], orders: [] }
  const jobs = []
  const callbacks = []
  const router = makeRouter()
  gateway.registerHalfFlowTrafficGatewayRoutes(router, {
    configProvider: () => config,
    repository,
    readDb: () => db,
    writeDbEntity: () => {},
    flushMongoPersist: async () => {},
    scheduleAsyncJob: job => jobs.push(job),
    httpClient: async (url, options) => {
      callbacks.push({ url, options })
      return { ok: true, status: 200, async text() { return '{"code":0}' } }
    },
    now: () => 1760000000000,
  })

  const payload = makeApplyPayload()
  const admission = makeCtx(encryptedRequest({
    mobileMd5: gateway.md5(payload.mobile),
    idCardMd5: gateway.md5(payload.idCard),
  }))
  await router.routes.get(`${config.routePrefix}/admission`)(admission)
  assert.equal(admission.body.code, 0)

  const apply = makeCtx(encryptedRequest(payload))
  await router.routes.get(`${config.routePrefix}/apply`)(apply)
  assert.equal(apply.body.code, 0)
  assert.deepEqual(gateway.decryptHalfFlowData(apply.body.data, config), {})
  assert.equal(db.users.length, 0)
  assert.equal(jobs.length, 1)

  await jobs[0]()
  assert.equal(callbacks.length, 1)
  assert.equal(gateway.decryptHalfFlowData(JSON.parse(callbacks[0].options.body).data, config).orderStatus, 3)

  const appLink = makeCtx(encryptedRequest({ orderId: payload.orderId, domainUrl: payload.domainUrl }))
  await router.routes.get(`${config.routePrefix}/app/link`)(appLink)
  assert.equal(appLink.body.code, 0)
  assert.equal(db.users.length, 1)
  const repaymentAddress = gateway.decryptHalfFlowData(appLink.body.data, config).repaymentAddress
  const token = new URL(repaymentAddress).searchParams.get('token')

  const consume = makeCtx({ orderId: payload.orderId, token }, '')
  await router.routes.get(`${config.routePrefix}/login/consume`)(consume)
  assert.equal(consume.status, 200)
  assert.equal(consume.body.success, true)
  assert.equal(consume.body.data.user.phone, payload.mobile)

  const reuse = makeCtx({ orderId: payload.orderId, token }, '')
  await router.routes.get(`${config.routePrefix}/login/consume`)(reuse)
  assert.equal(reuse.status, 400)
  assert.equal(reuse.body.success, false)
})

test('refreshes only users for half-flow identity-sensitive endpoints', () => {
  assert.equal(gateway.isHalfFlowTrafficPublicPath('/api/open/partners/half-flow/apply', config), true)
  assert.equal(gateway.isHalfFlowTrafficPublicPath('/api/open/partners/other/apply', config), false)
  assert.deepEqual(
    gateway.resolveHalfFlowTrafficMongoRefreshPlan('POST', '/api/open/partners/half-flow/admission', config),
    { mode: 'partial', keys: ['users'], allowColdPartial: true },
  )
  assert.deepEqual(
    gateway.resolveHalfFlowTrafficMongoRefreshPlan('POST', '/api/open/partners/half-flow/app/link', config),
    { mode: 'partial', keys: ['users'], allowColdPartial: true },
  )
  assert.deepEqual(
    gateway.resolveHalfFlowTrafficMongoRefreshPlan('POST', '/api/open/partners/half-flow/login/consume', config),
    { mode: 'partial', keys: ['users'], allowColdPartial: true },
  )
  assert.deepEqual(
    gateway.resolveHalfFlowTrafficMongoRefreshPlan('POST', '/api/open/partners/half-flow/apply', config),
    { mode: 'skip' },
  )
  assert.equal(gateway.resolveHalfFlowTrafficMongoRefreshPlan('GET', '/api/open/partners/half-flow/apply', config), null)
  assert.equal(gateway.resolveHalfFlowTrafficMongoRefreshPlan('POST', '/api/open/partners/other/apply', config), null)
})

test('wires the half-flow gateway independently into the API entrypoint', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/index.js'), 'utf8')
  assert.match(source, /function loadOptionalHalfFlowTrafficGateway\(\)/)
  assert.match(source, /halfFlowTrafficGateway\.resolveHalfFlowTrafficMongoRefreshPlan/)
  assert.match(source, /halfFlowTrafficGateway\.registerHalfFlowTrafficGatewayRoutes/)
  assert.match(source, /halfFlowTrafficGateway\.isHalfFlowTrafficPublicPath/)
  assert.match(source, /registerDuodiandianGatewayRoutes/)
  assert.match(source, /registerZheyinTrafficGatewayRoutes/)
})

test('returns safe HTTP-200 protocol failures for malformed encrypted requests', async () => {
  const router = makeRouter()
  gateway.registerHalfFlowTrafficGatewayRoutes(router, {
    configProvider: () => config,
    repository: gateway.createMemoryHalfFlowTrafficRepository(),
    readDb: () => ({ users: [] }),
  })
  const handler = router.routes.get(`${config.routePrefix}/admission`)
  for (const body of [{}, { data: 'not-base64' }, { data: 'AA==' }]) {
    const ctx = makeCtx(body)
    await handler(ctx)
    assert.equal(ctx.status, 200)
    assert.notEqual(ctx.body.code, 0)
    assert.equal(ctx.body.data, '')
    assert.equal(typeof ctx.body.message, 'string')
  }
})

test('keeps half-flow production code independent and free of data migration operations', () => {
  const gatewayDir = path.join(__dirname, '../src/halfFlowTrafficGateway')
  const source = fs.readdirSync(gatewayDir)
    .filter(file => file.endsWith('.js'))
    .map(file => fs.readFileSync(path.join(gatewayDir, file), 'utf8'))
    .join('\n')

  assert.doesNotMatch(source, /require\([^)]*(zheyinTrafficGateway|duodiandianGateway)/)
  assert.doesNotMatch(source, /zheyinTrafficApplications|partnerGatewayApplications/)
  assert.doesNotMatch(source, /deleteMany|dropDatabase|renameCollection|createIndex|drop\s*\(/)
})
