const test = require('node:test')
const assert = require('node:assert/strict')

const {
  ACTION_CODES,
  canonicalActionFingerprint,
  maskPhone,
  normalizeAdminPaidInput,
  normalizeAuditDateFilter,
  resolveAdminSecurityMode,
  resolveTrustedClientIp,
  sanitizeAuditTarget,
} = require('../src/adminSecurityCore')
const { createMemoryAdminSecurityStore, createMongoAdminSecurityStore } = require('../src/adminSecurityStore')
const { createAdminSecurityService } = require('../src/adminSecurityService')
const { createAdminSecuritySmsSender } = require('../src/adminSecuritySms')
const { hasAdminPermission } = require('../src/adminPermissions')

function createContext(overrides = {}) {
  return {
    account: {
      id: 'A1',
      username: 'collector-a',
      name: '催收甲',
      role: 'collector',
      phone: '13800138000',
    },
    tenantId: 'tenant-a',
    ip: '203.0.113.7',
    userAgent: 'node-test',
    ...overrides,
  }
}

function createService(options = {}) {
  let nowMs = options.nowMs || Date.parse('2026-08-25T08:00:00.000Z')
  const store = options.store || createMemoryAdminSecurityStore({ now: () => nowMs })
  const sent = []
  const service = createAdminSecurityService({
    store,
    secret: 'test-secret-with-enough-entropy',
    smsTemplate: '【测试】您正在进行{action}，验证码{code}，5分钟内有效',
    modeResolver: () => 'enforce',
    now: () => nowMs,
    sendSms: async (phone, message) => sent.push({ phone, message }),
    logRetentionDays: 365,
    otpTtlMs: 300_000,
    resendMs: 60_000,
    hourlySendLimit: 10,
    maxAttempts: 5,
    repaymentProofTtlMs: 30 * 60_000,
    ...options,
  })
  return {
    service,
    store,
    sent,
    advance(ms) {
      nowMs += ms
    },
  }
}

test('security mode is off unless the tenant is explicitly enabled', () => {
  assert.equal(resolveAdminSecurityMode('enforce', 'tenant-a', 'tenant-a,tenant-b'), 'enforce')
  assert.equal(resolveAdminSecurityMode('audit', 'tenant-c', '*'), 'audit')
  assert.equal(resolveAdminSecurityMode('enforce', 'tenant-c', 'tenant-a,tenant-b'), 'off')
  assert.equal(resolveAdminSecurityMode('unexpected', 'tenant-a', '*'), 'off')
})

test('trusted client IP accepts X-Real-IP only from a loopback reverse proxy', () => {
  assert.equal(resolveTrustedClientIp({
    headers: { 'x-real-ip': '198.51.100.9' },
    req: { socket: { remoteAddress: '::ffff:127.0.0.1' } },
  }), '198.51.100.9')
  assert.equal(resolveTrustedClientIp({
    headers: { 'x-real-ip': '198.51.100.9', 'x-forwarded-for': '192.0.2.4' },
    req: { socket: { remoteAddress: '203.0.113.8' } },
  }), '203.0.113.8')
  assert.equal(resolveTrustedClientIp({
    headers: { 'x-forwarded-for': '192.0.2.4' },
    req: { socket: { remoteAddress: '::ffff:203.0.113.8' } },
  }), '203.0.113.8')
})

test('action fingerprints are stable and phone numbers are masked', () => {
  const a = canonicalActionFingerprint('user.delete', { userId: 'U1' }, { hard: true, count: 2 })
  const b = canonicalActionFingerprint('user.delete', { userId: 'U1' }, { count: 2, hard: true })
  assert.equal(a, b)
  assert.equal(maskPhone('13800138000'), '138****8000')
  assert.equal(maskPhone('bad'), '')
  assert.equal(sanitizeAuditTarget({ orderId: 'OD1', period: 2, historyIndex: 0 }).historyIndex, 0)
})

test('audit date filters accept valid timestamps and ignore invalid input', () => {
  assert.equal(normalizeAuditDateFilter('2026-08-25T08:00:00+08:00'), '2026-08-25T00:00:00.000Z')
  assert.equal(normalizeAuditDateFilter('not-a-date'), '')
  assert.equal(normalizeAuditDateFilter(''), '')
})

test('critical proof is single-use, action-bound and never stores the plaintext code', async () => {
  const { service, store, sent } = createService()
  const ctx = createContext()
  const intent = { actionCode: ACTION_CODES.USER_DELETE, target: { userId: 'U1' }, input: {} }

  const challenge = await service.createChallenge(ctx, intent)
  assert.equal(sent.length, 1)
  const code = sent[0].message.match(/(\d{6})/)[1]
  const storedChallenge = await store.getChallenge(challenge.challengeId)
  assert.equal(Object.hasOwn(storedChallenge, 'code'), false)
  assert.notEqual(storedChallenge.codeHash, code)

  const verified = await service.verifyChallenge(ctx, challenge.challengeId, code)
  const allowed = await service.authorize(ctx, { ...intent, proofToken: verified.proofToken })
  assert.equal(allowed.ok, true)
  assert.equal(allowed.verificationMode, 'sms')

  await assert.rejects(
    service.authorize(ctx, { ...intent, proofToken: verified.proofToken }),
    error => error && error.code === 'ADMIN_SECURITY_PROOF_INVALID' && error.status === 403,
  )
  await assert.rejects(
    service.authorize(ctx, {
      actionCode: ACTION_CODES.ORDER_DELETE,
      target: { orderId: 'OD1' },
      input: {},
      proofToken: verified.proofToken,
    }),
    error => error && error.code === 'ADMIN_SECURITY_PROOF_INVALID',
  )
})

test('the same SMS challenge can only be verified once under concurrent requests', async () => {
  const { service, sent } = createService()
  const ctx = createContext()
  const intent = { actionCode: ACTION_CODES.ORDER_DELETE, target: { orderId: 'OD1' }, input: {} }
  const challenge = await service.createChallenge(ctx, intent)
  const code = sent[0].message.match(/(\d{6})/)[1]

  const results = await Promise.allSettled([
    service.verifyChallenge(ctx, challenge.challengeId, code),
    service.verifyChallenge(ctx, challenge.challengeId, code),
  ])

  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  const rejected = results.find(result => result.status === 'rejected')
  assert.equal(rejected?.reason?.code, 'ADMIN_SECURITY_CHALLENGE_INVALID')
})

test('a fifth invalid OTP that wins the race blocks a concurrent correct claim exactly once', async () => {
  const baseStore = createMemoryAdminSecurityStore()
  let releaseFifthFailure
  let releaseClaimAttempt
  const fifthFailureWon = new Promise(resolve => { releaseFifthFailure = resolve })
  const claimAttempted = new Promise(resolve => { releaseClaimAttempt = resolve })
  const store = {
    ...baseStore,
    async incrementChallengeAttempts(id) {
      const updated = await baseStore.incrementChallengeAttempts(id)
      if (Number(updated?.attempts || 0) === 5) {
        releaseFifthFailure()
        await claimAttempted
      }
      return updated
    },
    async recordChallengeFailure(...args) {
      const result = await baseStore.recordChallengeFailure(...args)
      if (result?.blockedNow) releaseFifthFailure()
      return result
    },
    async claimChallengeVerification(...args) {
      await fifthFailureWon
      const result = await baseStore.claimChallengeVerification(...args)
      releaseClaimAttempt()
      return result
    },
  }
  const { service, sent } = createService({ store })
  const ctx = createContext()
  const intent = { actionCode: ACTION_CODES.ORDER_DELETE, target: { orderId: 'OD-RACE' }, input: {} }
  const challenge = await service.createChallenge(ctx, intent)
  const code = sent[0].message.match(/(\d{6})/)[1]

  for (let i = 0; i < 4; i += 1) {
    await assert.rejects(
      service.verifyChallenge(ctx, challenge.challengeId, '000000'),
      error => error?.code === 'ADMIN_SECURITY_CODE_INVALID',
    )
  }

  const [invalidResult, correctResult] = await Promise.allSettled([
    service.verifyChallenge(ctx, challenge.challengeId, '000000'),
    service.verifyChallenge(ctx, challenge.challengeId, code),
  ])

  assert.equal(invalidResult.status, 'rejected')
  assert.equal(invalidResult.reason?.code, 'ADMIN_SECURITY_CHALLENGE_BLOCKED')
  assert.equal(correctResult.status, 'rejected')
  assert.equal(correctResult.reason?.code, 'ADMIN_SECURITY_CHALLENGE_INVALID')
  const logs = await store.listAuditLogs({ tenantId: 'tenant-a' })
  assert.equal(logs.items.filter(row => row.status === 'blocked').length, 1)
})

test('concurrent SMS requests atomically reserve one resend slot per actor and tenant', async () => {
  const { service, sent } = createService()
  const ctx = createContext()
  const intent = { actionCode: ACTION_CODES.ORDER_DELETE, target: { orderId: 'OD-RATE' }, input: {} }

  const results = await Promise.allSettled(
    Array.from({ length: 20 }, () => service.createChallenge(ctx, intent)),
  )

  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(sent.length, 1)
  assert.equal(results.filter(result => result.status === 'rejected' && result.reason?.status === 429).length, 19)
})

test('Mongo SMS reservation treats a concurrent first upsert duplicate as rate limited', async () => {
  const now = new Date('2026-08-25T08:00:00.000Z')
  const calls = []
  const challenges = {
    async findOneAndUpdate(query, update, options) {
      calls.push({ query, update, options })
      if (calls.length === 1) {
        const error = new Error('E11000 duplicate key error')
        error.code = 11000
        throw error
      }
      return {
        _id: query._id,
        lastReservationId: 'reservation-from-concurrent-request',
        sendReservations: [now],
      }
    },
  }
  const store = createMongoAdminSecurityStore({
    getDb: () => ({
      databaseName: 'admin-security-test',
      collection(name) {
        if (name === 'adminSecurityChallenges') return challenges
        return {}
      },
    }),
  })

  const result = await store.reserveChallengeSend({
    actorId: 'A1',
    tenantId: 'tenant-a',
    now,
    resendMs: 60_000,
    hourlyLimit: 10,
    reservationId: 'current-reservation',
  })

  assert.deepEqual(result, { reserved: false, reason: 'resend' })
  assert.equal(calls.length, 2)
  assert.equal(calls[0].options.upsert, true)
  assert.equal(calls[1].options.upsert, false)
})

test('SMS reservations allow exactly ten sends in a rolling hour', async () => {
  const { service, sent, advance } = createService()
  const ctx = createContext()
  const intent = { actionCode: ACTION_CODES.ORDER_DELETE, target: { orderId: 'OD-HOURLY' }, input: {} }

  await service.createChallenge(ctx, intent)
  for (let i = 1; i < 10; i += 1) {
    advance(60_000)
    await service.createChallenge(ctx, intent)
  }
  advance(60_000)
  await assert.rejects(
    service.createChallenge(ctx, intent),
    error => error?.code === 'ADMIN_SECURITY_SMS_RATE_LIMIT' && error.status === 429,
  )
  assert.equal(sent.length, 10)
})

test('SMS hourly send limit is controlled by service configuration', async () => {
  const { service, sent, advance } = createService({ hourlySendLimit: 2 })
  const ctx = createContext()
  const intent = { actionCode: ACTION_CODES.ORDER_DELETE, target: { orderId: 'OD-CONFIG-RATE' }, input: {} }

  await service.createChallenge(ctx, intent)
  advance(60_000)
  await service.createChallenge(ctx, intent)
  advance(60_000)
  await assert.rejects(
    service.createChallenge(ctx, intent),
    error => error?.code === 'ADMIN_SECURITY_SMS_RATE_LIMIT' && error.status === 429,
  )
  assert.equal(sent.length, 2)
})

test('repayment proof can be reused for configured thirty minutes only by the same actor tenant and IP', async () => {
  const { service, sent, advance } = createService()
  const ctx = createContext()
  const firstIntent = {
    actionCode: ACTION_CODES.REPAYMENT_MARK_PAID,
    target: { orderId: 'OD1', period: 1 },
    input: { paid: true },
  }
  const challenge = await service.createChallenge(ctx, firstIntent)
  const code = sent[0].message.match(/(\d{6})/)[1]
  const verified = await service.verifyChallenge(ctx, challenge.challengeId, code)

  const first = await service.authorize(ctx, { ...firstIntent, proofToken: verified.proofToken })
  assert.equal(first.verificationMode, 'sms')
  const second = await service.authorize(ctx, {
    actionCode: ACTION_CODES.REPAYMENT_CHANGE_DUE_DATE,
    target: { orderId: 'OD2', period: 2 },
    input: { addDays: 3 },
    proofToken: verified.proofToken,
  })
  assert.equal(second.verificationMode, 'repayment_window')

  await assert.rejects(
    service.authorize(createContext({ ip: '203.0.113.99' }), { ...firstIntent, proofToken: verified.proofToken }),
    error => error && error.code === 'ADMIN_SECURITY_PROOF_INVALID',
  )
  advance(30 * 60 * 1000 + 1)
  await assert.rejects(
    service.authorize(ctx, { ...firstIntent, proofToken: verified.proofToken }),
    error => error && error.code === 'ADMIN_SECURITY_PROOF_INVALID',
  )
})

test('five invalid verification attempts block the challenge and append one blocked audit log', async () => {
  const { service, store } = createService()
  const ctx = createContext()
  const intent = { actionCode: ACTION_CODES.ORDER_DELETE, target: { orderId: 'OD1' }, input: {} }
  const challenge = await service.createChallenge(ctx, intent)

  for (let i = 0; i < 4; i += 1) {
    await assert.rejects(
      service.verifyChallenge(ctx, challenge.challengeId, '000000'),
      error => error && error.code === 'ADMIN_SECURITY_CODE_INVALID',
    )
  }
  await assert.rejects(
    service.verifyChallenge(ctx, challenge.challengeId, '000000'),
    error => error && error.code === 'ADMIN_SECURITY_CHALLENGE_BLOCKED',
  )

  const logs = await store.listAuditLogs({ tenantId: 'tenant-a', page: 1, pageSize: 20 })
  assert.equal(logs.total, 1)
  assert.equal(logs.items[0].status, 'blocked')
  assert.equal(logs.items[0].actor.phoneMasked, '138****8000')
})

test('maximum OTP attempts is controlled by service configuration', async () => {
  const { service, store } = createService({ maxAttempts: 2 })
  const ctx = createContext()
  const intent = { actionCode: ACTION_CODES.ORDER_DELETE, target: { orderId: 'OD-CONFIG-ATTEMPTS' }, input: {} }
  const challenge = await service.createChallenge(ctx, intent)

  await assert.rejects(
    service.verifyChallenge(ctx, challenge.challengeId, '000000'),
    error => error?.code === 'ADMIN_SECURITY_CODE_INVALID',
  )
  await assert.rejects(
    service.verifyChallenge(ctx, challenge.challengeId, '000000'),
    error => error?.code === 'ADMIN_SECURITY_CHALLENGE_BLOCKED',
  )

  const logs = await store.listAuditLogs({ tenantId: 'tenant-a' })
  assert.equal(logs.total, 1)
})

test('off and audit modes never require proof while enforce mode fails closed', async () => {
  const off = createService({ modeResolver: () => 'off' })
  const audit = createService({ modeResolver: () => 'audit' })
  const enforce = createService({ modeResolver: () => 'enforce' })
  const ctx = createContext()
  const intent = { actionCode: ACTION_CODES.USER_EXPORT, target: { view: 'registered' }, input: { fields: 'name' } }

  assert.equal((await off.service.authorize(ctx, intent)).verificationMode, 'off')
  assert.equal((await audit.service.authorize(ctx, intent)).verificationMode, 'audit')
  await assert.rejects(
    enforce.service.authorize(ctx, intent),
    error => error && error.code === 'ADMIN_SECURITY_PROOF_REQUIRED' && error.status === 428,
  )
})

test('audit records keep only masked target data and finalize without business snapshots', async () => {
  const { service, store } = createService({ modeResolver: () => 'audit' })
  const ctx = createContext()
  const pending = await service.beginAudit(ctx, {
    actionCode: ACTION_CODES.USER_DELETE,
    target: { userId: 'U1', userName: '测试用户', userPhone: '13900139000' },
    summary: '准备删除用户',
    verificationMode: 'audit',
  })
  await service.completeAudit(pending, {
    status: 'success',
    summary: '已删除用户测试用户，地址 1 条，银行卡 2 张',
    changes: [{ label: '用户状态', before: '存在', after: '已删除' }],
  })

  const stored = await store.getAuditLog(pending.id)
  assert.equal(stored.status, 'success')
  assert.equal(stored.target.phoneMasked, '139****9000')
  assert.equal(JSON.stringify(stored).includes('13900139000'), false)
  assert.equal(Object.hasOwn(stored, 'snapshot'), false)
})

test('audit mode tolerates log storage failure while enforce mode fails closed', async () => {
  const failingStore = {
    ...createMemoryAdminSecurityStore(),
    insertAuditLog: async () => { throw new Error('db unavailable') },
  }
  const audit = createService({ store: failingStore, modeResolver: () => 'audit' })
  const enforce = createService({ store: failingStore, modeResolver: () => 'enforce' })
  const detail = { actionCode: ACTION_CODES.ORDER_DELETE, target: { orderId: 'OD1' } }

  assert.equal(await audit.service.beginAudit(createContext(), detail), null)
  await assert.rejects(
    enforce.service.beginAudit(createContext(), detail),
    error => error && error.code === 'ADMIN_SECURITY_UNAVAILABLE' && error.status === 503,
  )
})

test('readonly audit queries do not require the OTP secret', async () => {
  const store = createMemoryAdminSecurityStore()
  await store.insertAuditLog({
    id: 'ASL1',
    tenantId: 'tenant-a',
    status: 'success',
    createdAt: new Date('2026-08-25T08:00:00.000Z'),
  })
  const service = createAdminSecurityService({
    store,
    secret: '',
    modeResolver: () => 'off',
  })

  const result = await service.listAuditLogs({ tenantId: 'tenant-a' })
  assert.equal(result.total, 1)
  assert.equal((await service.getAuditLog('ASL1')).status, 'success')
  const invalidPage = await service.listAuditLogs({ tenantId: 'tenant-a', page: 'bad', pageSize: 'bad' })
  assert.equal(invalidPage.page, 1)
  assert.equal(invalidPage.pageSize, 20)
})

test('existing boss accounts receive readonly audit access without migrating stored permissions', () => {
  const legacyBoss = {
    role: 'boss',
    permissions: { menus: ['dashboard'], actions: { dashboard: ['view'] } },
  }
  const legacyCollector = {
    role: 'collector',
    permissions: { menus: ['orders'], actions: { orders: ['view'] } },
  }

  assert.equal(hasAdminPermission(legacyBoss, 'security.audit', 'view'), true)
  assert.equal(hasAdminPermission(legacyBoss, 'security.audit', 'delete'), false)
  assert.equal(hasAdminPermission(legacyCollector, 'security.audit', 'view'), false)
})

test('paid authorization input accepts booleans only and maps false to revokePaid', () => {
  assert.deepEqual(normalizeAdminPaidInput({ paid: true }), { paid: true, permissionAction: 'markPaid' })
  assert.deepEqual(normalizeAdminPaidInput({ paid: false }), { paid: false, permissionAction: 'revokePaid' })
  assert.equal(normalizeAdminPaidInput({}), null)
  assert.equal(normalizeAdminPaidInput({ paid: 0 }), null)
  assert.equal(normalizeAdminPaidInput({ paid: 'false' }), null)
})

test('security status reports actual OTP readiness in every rollout mode', async () => {
  const missingConfig = createAdminSecurityService({
    store: createMemoryAdminSecurityStore(),
    secret: '',
    smsTemplate: '',
    modeResolver: () => 'audit',
    logRetentionDays: 365,
    otpTtlMs: 300_000,
    resendMs: 60_000,
    hourlySendLimit: 10,
    maxAttempts: 5,
    repaymentProofTtlMs: 30 * 60_000,
  })
  const ready = createService({ modeResolver: () => 'off' }).service

  assert.equal((await missingConfig.getStatus(createContext())).otpReady, false)
  assert.equal((await ready.getStatus(createContext())).otpReady, true)
})

test('security status stays unready when the SMS upstream is unavailable', async () => {
  const { service } = createService({ smsReady: () => false, modeResolver: () => 'enforce' })
  assert.equal((await service.getStatus(createContext())).otpReady, false)
})

test('admin security SMS sender rejects unavailable and rejected upstream responses', async () => {
  const unavailable = createAdminSecuritySmsSender({ isConfigured: () => false })
  await assert.rejects(unavailable('13800138000', 'message'), /短信通道未配置/)

  const rejected = createAdminSecuritySmsSender({
    isConfigured: () => true,
    postSms: async () => ({ status: 200, json: { code: 50001, msg: 'rejected' } }),
    parseResponse: () => ({ ok: false, reason: '上游拒绝' }),
  })
  await assert.rejects(rejected('13800138000', 'message'), /上游拒绝/)

  const calls = []
  const sender = createAdminSecuritySmsSender({
    isConfigured: () => true,
    postSms: async payload => calls.push(payload),
    parseResponse: () => ({ ok: true }),
  })
  await sender('13800138000', 'security message')
  assert.deepEqual(calls, [{ phone: '13800138000', msg: 'security message' }])
})
