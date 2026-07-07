const assert = require('node:assert/strict')
const test = require('node:test')

const gateway = require('../src/zheyinTrafficGateway')

const config = {
  enabled: true,
  routePrefix: '/open/partners/zheyin',
  channel: 'zheyin_test',
  registerChannelName: '上海企浩',
  aesKey: 'aB3$kL9@mN2#pQ7&',
  aesIv: 'xY4*zW8!vU5&tS1@',
  orderIdPrefix: 'ZY',
  defaultAmount: 2750,
  defaultUserQuota: 2750,
  periods: [1],
  yearRate: '12%',
  creditType: 1,
  creditExpireDays: 365,
  loanUrlTemplate: 'https://shop.example.com/login?trafficLogin=1&channel={channel}&applyNo={orderId}&token={token}&consumePath={consumePath}&redirect={redirectUrl}',
  contractsByScene: {
    '1': [{ contractName: '个人征信授权协议', contractUrl: 'https://shop.example.com/contract/credit.pdf' }],
  },
  creditNotifyUrl: 'https://partner.example.com/zheyin-jr-api/api/dlApp/recCredit',
}

function makeRouter() {
  const routes = new Map()
  return {
    routes,
    post(path, handler) {
      routes.set(path, handler)
    },
  }
}

function makeCtx(body) {
  return {
    request: { body },
    status: 0,
    body: null,
    path: '',
  }
}

function envelope(payload, overrides = {}) {
  return gateway.buildZheyinTrafficEnvelope(payload, {
    ...config,
    ...(overrides.config || {}),
  }, {
    requestNo: overrides.requestNo || 'REQ-001',
  })
}

test('encrypts and decrypts doc-defined zheyin traffic envelopes', () => {
  const payload = { phoneMd5: '6643f667b12386a1bb2e1adf8f054d0e', idCardMd5: '95dbf70af76519537e4fa8801f339ee2' }
  const body = envelope(payload)

  assert.equal(body.channel, config.channel)
  assert.equal(body.requestNo, 'REQ-001')
  assert.match(body.data, /^[A-Za-z0-9+/=]+$/)
  assert.equal(Object.hasOwn(body, 'timestamp'), false)
  assert.equal(Object.hasOwn(body, 'sign'), false)

  const parsed = gateway.parseZheyinTrafficEnvelope(body, config, { now: 1760000000000 })
  assert.deepEqual(parsed, payload)
})

test('rejects invalid channel and missing doc-defined envelope fields', () => {
  const payload = { applyNo: 'APPLY-001' }
  assert.throws(() => gateway.parseZheyinTrafficEnvelope(envelope(payload, { config: { channel: 'wrong' } }), config, { now: 1760000000000 }), /channel/i)
  assert.throws(() => gateway.parseZheyinTrafficEnvelope({ ...envelope(payload), data: '' }, config, { now: 1760000000000 }), /data/i)
  assert.throws(() => gateway.parseZheyinTrafficEnvelope({ ...envelope(payload), requestNo: '' }, config, { now: 1760000000000 }), /requestNo/i)
})

test('registers isolated routes only when enabled', () => {
  const disabledRouter = makeRouter()
  gateway.registerZheyinTrafficGatewayRoutes(disabledRouter, {
    configProvider: () => ({ ...config, enabled: false }),
  })
  assert.equal(disabledRouter.routes.size, 0)

  const incompleteRouter = makeRouter()
  assert.doesNotThrow(() => gateway.registerZheyinTrafficGatewayRoutes(incompleteRouter, {
    configProvider: () => ({ enabled: true }),
    logger: { warn() {} },
  }))
  assert.equal(incompleteRouter.routes.size, 0)

  const router = makeRouter()
  gateway.registerZheyinTrafficGatewayRoutes(router, {
    configProvider: () => config,
    repository: gateway.createMemoryZheyinTrafficRepository(),
  })
  assert.deepEqual([...router.routes.keys()].sort(), [
    '/open/partners/zheyin/admission',
    '/open/partners/zheyin/app/link',
    '/open/partners/zheyin/contracts',
    '/open/partners/zheyin/credit/apply',
    '/open/partners/zheyin/credit/query',
    '/open/partners/zheyin/login/consume',
  ])
})

test('returns doc-style failure body with HTTP 200 for invalid requests', async () => {
  const router = makeRouter()
  gateway.registerZheyinTrafficGatewayRoutes(router, {
    configProvider: () => config,
    repository: gateway.createMemoryZheyinTrafficRepository(),
  })

  const ctx = makeCtx({ channel: config.channel, requestNo: 'REQ-MISSING-DATA', data: '' })
  await router.routes.get('/open/partners/zheyin/admission')(ctx)

  assert.equal(ctx.status, 200)
  assert.equal(ctx.body.code, 400)
  assert.match(ctx.body.msg, /data/i)
  assert.equal(Object.hasOwn(ctx.body, 'data'), false)
})

test('handles admission, credit apply, async review, query and app link without touching duodiandian data', async () => {
  const repository = gateway.createMemoryZheyinTrafficRepository()
  const jobs = []
  const notifyCalls = []
  const partialWrites = []
  let flushCount = 0
  const db = {
    users: [],
    orders: [],
    partnerGatewayApplications: [{ applyNo: 'DONT-TOUCH', channel: 'duodiandian' }],
  }
  const router = makeRouter()

  gateway.registerZheyinTrafficGatewayRoutes(router, {
    configProvider: () => config,
    repository,
    readDb: () => db,
    writeDbPartial: (nextDb, keys) => partialWrites.push({ nextDb, keys }),
    flushMongoPersist: async () => { flushCount += 1 },
    scheduleAsyncJob: (fn) => jobs.push(fn),
    runCreditReview: async () => ({ allPassed: true, message: '', steps: [] }),
    httpClient: async (url, options) => {
      notifyCalls.push({ url, options })
      return { ok: true, status: 200, async text() { return JSON.stringify({ code: 200, msg: 'success' }) } }
    },
    now: () => 1760000000000,
  })

  const admissionCtx = makeCtx(envelope({
    phoneMd5: '6643f667b12386a1bb2e1adf8f054d0e',
    idCardMd5: '95dbf70af76519537e4fa8801f339ee2',
    name: '张三',
  }))
  await router.routes.get('/open/partners/zheyin/admission')(admissionCtx)
  assert.equal(admissionCtx.status, 200)
  assert.equal(admissionCtx.body.code, 200)
  assert.equal(admissionCtx.body.data.status, '1')
  const respSeq = admissionCtx.body.data.respSeq
  assert.match(respSeq, /^ZYR/)

  const applyCtx = makeCtx(envelope({
    applyNo: respSeq,
    userInfo: {
      mobile: '13812345678',
      name: '张三',
      idCardNo: '32010119900307663X',
      homeAddress: '科技城锦峰路188号',
      marriage: '2',
      degree: '2',
      purpose: 'shxf',
      occupation: '7',
    },
    idCardInfo: {
      frontImgUrl: 'https://cdn.example.com/front.jpg',
      backImgUrl: 'https://cdn.example.com/back.jpg',
      nation: '汉',
      sex: '0',
      address: '身份证地址',
      issuedBy: '公安局',
      validityStart: '2015-01-01',
      validityEnd: '2025-01-01',
      faceImgUrl: 'https://cdn.example.com/face.jpg',
    },
    contactList: [{ relation: '7', name: '李四', mobile: '13912345678' }],
    deviceInfo: { deviceType: 'ANDROID', ip: '127.0.0.1' },
  }))
  await router.routes.get('/open/partners/zheyin/credit/apply')(applyCtx)
  assert.equal(applyCtx.status, 200)
  assert.equal(applyCtx.body.data.status, 1)
  const orderId = applyCtx.body.data.orderId
  assert.equal(orderId, respSeq)
  assert.equal(jobs.length, 1)

  const pendingQueryCtx = makeCtx(envelope({ applyNo: orderId }))
  await router.routes.get('/open/partners/zheyin/credit/query')(pendingQueryCtx)
  assert.equal(pendingQueryCtx.body.data.auditStatus, 2)

  await jobs[0]()

  assert.equal(db.users.length, 1)
  assert.equal(db.users[0].phone, '13812345678')
  assert.equal(db.users[0].idNumber, '32010119900307663X')
  assert.equal(db.users[0].idCardFront, 'https://cdn.example.com/front.jpg')
  assert.equal(db.users[0].idCardBack, 'https://cdn.example.com/back.jpg')
  assert.equal(db.users[0].idCardHandheld, 'https://cdn.example.com/face.jpg')
  assert.equal(db.users[0].registerChannelCode, 'zheyin_test')
  assert.equal(db.users[0].registerChannelName, '上海企浩')
  assert.equal(db.users[0].quota, 2750)
  assert.equal(db.users[0].zheyinApplyNo, orderId)
  assert.equal(partialWrites.at(-1).keys.includes('users'), true)
  assert.equal(flushCount > 0, true)

  const passedQueryCtx = makeCtx(envelope({ applyNo: orderId }))
  await router.routes.get('/open/partners/zheyin/credit/query')(passedQueryCtx)
  assert.equal(passedQueryCtx.body.data.auditStatus, 1)
  assert.equal(passedQueryCtx.body.data.totalAmount, 2750)
  assert.deepEqual(passedQueryCtx.body.data.periods, [1])

  const linkCtx = makeCtx(envelope({ applyNo: orderId, redirectUrl: 'https://partner.example.com/return' }))
  await router.routes.get('/open/partners/zheyin/app/link')(linkCtx)
  assert.equal(linkCtx.status, 200)
  const loginUrl = new URL(linkCtx.body.data.loanUrl)
  assert.equal(loginUrl.pathname, '/login')
  assert.equal(loginUrl.searchParams.get('trafficLogin'), '1')
  assert.equal(loginUrl.searchParams.get('applyNo'), orderId)
  assert.equal(loginUrl.searchParams.get('channel'), 'zheyin_test')
  assert.equal(loginUrl.searchParams.get('consumePath'), '/api/open/partners/zheyin/login/consume')
  const loginToken = loginUrl.searchParams.get('token')
  assert(loginToken)

  const consumeCtx = makeCtx({ applyNo: orderId, token: loginToken })
  await router.routes.get('/open/partners/zheyin/login/consume')(consumeCtx)
  assert.equal(consumeCtx.status, 200)
  assert.equal(consumeCtx.body.success, true)
  assert.equal(consumeCtx.body.data.token, 'mock-token-13812345678')
  assert.equal(consumeCtx.body.data.user.phone, '13812345678')

  const reuseCtx = makeCtx({ applyNo: orderId, token: loginToken })
  await router.routes.get('/open/partners/zheyin/login/consume')(reuseCtx)
  assert.equal(reuseCtx.status, 400)
  assert.notEqual(reuseCtx.body.success, true)

  const linkWithoutRedirectCtx = makeCtx(envelope({ applyNo: orderId }))
  await router.routes.get('/open/partners/zheyin/app/link')(linkWithoutRedirectCtx)
  assert.equal(linkWithoutRedirectCtx.status, 200)
  assert.equal(linkWithoutRedirectCtx.body.code, 200)
  assert.equal(new URL(linkWithoutRedirectCtx.body.data.loanUrl).searchParams.get('applyNo'), orderId)
  assert.equal(new URL(linkWithoutRedirectCtx.body.data.loanUrl).searchParams.get('redirect'), '')

  assert.equal(db.partnerGatewayApplications.length, 1)
  assert.equal(db.partnerGatewayApplications[0].applyNo, 'DONT-TOUCH')
  assert.equal(notifyCalls.length, 1)
  assert.equal(notifyCalls[0].url, config.creditNotifyUrl)
  const notifyBody = JSON.parse(notifyCalls[0].options.body)
  assert.deepEqual(Object.keys(notifyBody).sort(), ['channel', 'data', 'requestNo'])
  assert.equal(notifyBody.channel, 'zheyin_test')
  assert.match(notifyBody.requestNo, /^NOTIFY-/)
  assert.equal(gateway.parseZheyinTrafficEnvelope(notifyBody, config, { now: 1760000000000 }).auditStatus, 1)
})

test('resolves lightweight refresh plans for only zheyin paths', () => {
  assert.deepEqual(
    gateway.resolveZheyinTrafficMongoRefreshPlan('POST', '/api/open/partners/zheyin/admission', config),
    { mode: 'partial', keys: ['users'], allowColdPartial: true },
  )
  assert.deepEqual(
    gateway.resolveZheyinTrafficMongoRefreshPlan('POST', '/api/open/partners/zheyin/contracts', config),
    { mode: 'skip' },
  )
  assert.equal(gateway.resolveZheyinTrafficMongoRefreshPlan('POST', '/api/open/partners/other/admission', config), null)
  assert.equal(gateway.isZheyinTrafficPublicPath('/api/open/partners/zheyin/credit/apply', config), true)
})

test('app link lazily binds approved zheyin applications created before passwordless rollout', async () => {
  const orderId = 'ZYR-LEGACY-PASS'
  const repository = gateway.createMemoryZheyinTrafficRepository([{
    id: orderId,
    orderId,
    applyNo: orderId,
    admissionRespSeq: orderId,
    channel: config.channel,
    auditStatus: 1,
    auditStatusName: 'auth_success',
    rawApplyPayload: {
      applyNo: orderId,
      userInfo: {
        mobile: '15959415271',
        name: 'Legacy User',
        idCardNo: '32010119900307663X',
        homeAddress: 'legacy address',
      },
      idCardInfo: {
        frontImgUrl: 'https://cdn.example.com/legacy-front.jpg',
        backImgUrl: 'https://cdn.example.com/legacy-back.jpg',
        faceImgUrl: 'https://cdn.example.com/legacy-face.jpg',
      },
      contactList: [{ relation: '7', name: 'Contact', mobile: '13912345678' }],
    },
    notifyLogs: [],
  }])
  const db = { users: [], orders: [], partnerGatewayApplications: [] }
  const writes = []
  const router = makeRouter()
  gateway.registerZheyinTrafficGatewayRoutes(router, {
    configProvider: () => config,
    repository,
    readDb: () => db,
    writeDbPartial: (nextDb, keys) => writes.push({ nextDb, keys }),
    flushMongoPersist: async () => {},
    now: () => 1760000000000,
  })

  const ctx = makeCtx(envelope({ applyNo: orderId }))
  await router.routes.get('/open/partners/zheyin/app/link')(ctx)

  assert.equal(ctx.status, 200)
  assert.equal(db.users.length, 1)
  assert.equal(db.users[0].phone, '15959415271')
  assert.equal(db.users[0].zheyinApplyNo, orderId)
  assert.equal(db.users[0].registerChannelName, '上海企浩')
  assert.equal(writes.at(-1).keys.includes('users'), true)
  const url = new URL(ctx.body.data.loanUrl)
  assert.equal(url.searchParams.get('trafficLogin'), '1')
  assert(url.searchParams.get('token'))
})
