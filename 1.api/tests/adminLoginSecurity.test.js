const test = require('node:test')
const assert = require('node:assert/strict')

const {
  AdminLoginSecurityError,
  createAdminLoginSecurityService,
} = require('../src/adminLoginSecurity')
const {
  createMemoryAdminLoginSecurityStore,
  createMongoAdminLoginSecurityStore,
} = require('../src/adminLoginSecurityStore')

const VALID_SECRET = Buffer.from(Array.from({ length: 48 }, (_, index) => index + 1)).toString('base64url')

function createFixture(options = {}) {
  let nowMs = options.nowMs || Date.parse('2026-08-27T08:00:00.000Z')
  let randomSequence = 1
  const store = options.store || createMemoryAdminLoginSecurityStore()
  const code = options.code || '123456'
  const service = createAdminLoginSecurityService({
    store,
    secret: VALID_SECRET,
    now: () => nowMs,
    randomInt: () => Number(code),
    randomBytes: (size) => Buffer.alloc(size, randomSequence++),
    sendSms: async () => {},
    smsReady: () => true,
    otpTtlMs: 300_000,
    resendMs: 60_000,
    hourlySendLimit: 10,
    maxAttempts: 5,
    sessionTtlMs: 43_200_000,
    ...options,
  })
  return {
    service,
    store,
    code,
    context: {
      passwordVerified: true,
      account: {
        id: 'A1',
        username: 'boss1',
        name: 'Boss One',
        role: 'super_admin',
        phone: '13800138000',
      },
      tenantId: 'tenant-a',
      ip: '203.0.113.7',
      userAgent: 'node-test',
    },
    get nowMs() {
      return nowMs
    },
    setNow(value) {
      nowMs = value
    },
    advance(ms) {
      nowMs += ms
    },
  }
}

test('password-verified account receives a challenge and plaintext code is never stored', async () => {
  const sent = []
  const fixture = createFixture({ sendSms: async (phone, message) => sent.push({ phone, message }) })
  const result = await fixture.service.createChallenge(fixture.context)
  assert.equal(result.phoneMasked, '138****8000')
  assert.equal(sent.length, 1)
  assert.doesNotMatch(JSON.stringify(fixture.store.dump()), /123456/)
})

test('verified code issues a 12 hour opaque session that is not bound to IP', async () => {
  const fixture = createFixture()
  const challenge = await fixture.service.createChallenge(fixture.context)
  const login = await fixture.service.verifyChallenge({ challengeId: challenge.challengeId, code: fixture.code })
  assert.match(login.token, /^admin-session-v1\./)
  assert.equal(Date.parse(login.expiresAt) - fixture.nowMs, 43_200_000)
  assert.equal((await fixture.service.resolveSession(login.token, { ip: '203.0.113.99' })).username, 'boss1')
})

test('a session stops resolving after its fixed expiry', async () => {
  const fixture = createFixture()
  const challenge = await fixture.service.createChallenge(fixture.context)
  const login = await fixture.service.verifyChallenge({ challengeId: challenge.challengeId, code: fixture.code })
  fixture.setNow(fixture.nowMs + 43_200_001)
  await assert.rejects(() => fixture.service.resolveSession(login.token), { code: 'ADMIN_LOGIN_SESSION_EXPIRED' })
})

test('revocation invalidates a live session immediately', async () => {
  const fixture = createFixture()
  const challenge = await fixture.service.createChallenge(fixture.context)
  const login = await fixture.service.verifyChallenge({ challengeId: challenge.challengeId, code: fixture.code })
  await fixture.service.revokeSession(login.token)
  await assert.rejects(() => fixture.service.resolveSession(login.token), { code: 'ADMIN_LOGIN_SESSION_INVALID' })
})

test('a verified challenge cannot issue a second session', async () => {
  const fixture = createFixture()
  const challenge = await fixture.service.createChallenge(fixture.context)
  await fixture.service.verifyChallenge({ challengeId: challenge.challengeId, code: fixture.code })
  await assert.rejects(
    () => fixture.service.verifyChallenge({ challengeId: challenge.challengeId, code: fixture.code }),
    { code: 'ADMIN_LOGIN_CHALLENGE_INVALID' },
  )
})

test('only one concurrent verification can consume a pending challenge', async () => {
  const fixture = createFixture()
  const challenge = await fixture.service.createChallenge(fixture.context)
  const results = await Promise.allSettled([
    fixture.service.verifyChallenge({ challengeId: challenge.challengeId, code: fixture.code }),
    fixture.service.verifyChallenge({ challengeId: challenge.challengeId, code: fixture.code }),
  ])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(results.find(result => result.status === 'rejected')?.reason?.code, 'ADMIN_LOGIN_CHALLENGE_INVALID')
})

test('a challenge is rejected after its five minute expiry', async () => {
  const fixture = createFixture()
  const challenge = await fixture.service.createChallenge(fixture.context)
  fixture.advance(300_000)
  await assert.rejects(
    () => fixture.service.verifyChallenge({ challengeId: challenge.challengeId, code: fixture.code }),
    { code: 'ADMIN_LOGIN_CHALLENGE_EXPIRED' },
  )
})

test('resending within sixty seconds is limited', async () => {
  const fixture = createFixture()
  await fixture.service.createChallenge(fixture.context)
  await assert.rejects(
    () => fixture.service.createChallenge(fixture.context),
    { code: 'ADMIN_LOGIN_RESEND_LIMITED' },
  )
})

test('a successful resend supersedes every older pending challenge for the account and tenant', async () => {
  const fixture = createFixture()
  const first = await fixture.service.createChallenge(fixture.context)
  fixture.advance(60_000)
  const second = await fixture.service.createChallenge(fixture.context)

  const results = await Promise.allSettled([
    fixture.service.verifyChallenge({ challengeId: first.challengeId, code: fixture.code }),
    fixture.service.verifyChallenge({ challengeId: second.challengeId, code: fixture.code }),
  ])
  assert.equal(results[0].status, 'rejected')
  assert.equal(results[0].reason.code, 'ADMIN_LOGIN_CHALLENGE_INVALID')
  assert.equal(results[1].status, 'fulfilled')
  const rows = fixture.store.dump().challenges.filter(item => item.kind === 'challenge')
  assert.equal(rows.find(item => item.id === first.challengeId).status, 'superseded')
  assert.equal(rows.find(item => item.id === second.challengeId).status, 'verified')
})

test('an older challenge cannot be consumed while replacement SMS delivery is in flight', async () => {
  let sendCount = 0
  let signalSecondSend
  let releaseSecondSend
  const secondSendStarted = new Promise((resolve) => {
    signalSecondSend = resolve
  })
  const secondSendGate = new Promise((resolve) => {
    releaseSecondSend = resolve
  })
  const fixture = createFixture({
    sendSms: async () => {
      sendCount += 1
      if (sendCount !== 2) return
      signalSecondSend()
      await secondSendGate
    },
  })
  const first = await fixture.service.createChallenge(fixture.context)
  fixture.advance(60_000)
  const resend = fixture.service.createChallenge(fixture.context)
  await secondSendStarted

  try {
    await assert.rejects(
      () => fixture.service.verifyChallenge({ challengeId: first.challengeId, code: fixture.code }),
      { code: 'ADMIN_LOGIN_CHALLENGE_INVALID' },
    )
  }
  finally {
    releaseSecondSend()
    await resend
  }
})

test('a failed resend preserves the prior pending challenge', async () => {
  let rejectSms = false
  const fixture = createFixture({
    sendSms: async () => {
      if (rejectSms) throw new Error('sms unavailable')
    },
  })
  const first = await fixture.service.createChallenge(fixture.context)
  fixture.advance(60_000)
  rejectSms = true
  await assert.rejects(
    () => fixture.service.createChallenge(fixture.context),
    { code: 'ADMIN_LOGIN_SMS_UNAVAILABLE' },
  )
  const verified = await fixture.service.verifyChallenge({ challengeId: first.challengeId, code: fixture.code })
  assert.match(verified.token, /^admin-session-v1\./)
})

test('the eleventh hourly send is limited', async () => {
  const fixture = createFixture()
  await fixture.service.createChallenge(fixture.context)
  for (let index = 1; index < 10; index += 1) {
    fixture.advance(60_000)
    await fixture.service.createChallenge(fixture.context)
  }
  fixture.advance(60_000)
  await assert.rejects(
    () => fixture.service.createChallenge(fixture.context),
    { code: 'ADMIN_LOGIN_HOURLY_LIMITED' },
  )
})

test('the fifth incorrect code blocks the challenge', async () => {
  const fixture = createFixture()
  const challenge = await fixture.service.createChallenge(fixture.context)
  for (let index = 0; index < 4; index += 1) {
    await assert.rejects(
      () => fixture.service.verifyChallenge({ challengeId: challenge.challengeId, code: '000000' }),
      { code: 'ADMIN_LOGIN_CODE_INVALID' },
    )
  }
  await assert.rejects(
    () => fixture.service.verifyChallenge({ challengeId: challenge.challengeId, code: '000000' }),
    { code: 'ADMIN_LOGIN_CHALLENGE_BLOCKED' },
  )
  const row = fixture.store.dump().challenges.find(item => item.id === challenge.challengeId)
  assert.equal(row.status, 'blocked')
  assert.equal(row.attempts, 5)
})

test('missing phone, unavailable SMS, and incomplete configuration never create sessions', async () => {
  const missingPhone = createFixture()
  missingPhone.context.account.phone = ''
  await assert.rejects(
    () => missingPhone.service.createChallenge(missingPhone.context),
    { code: 'ADMIN_LOGIN_PHONE_MISSING' },
  )

  const unavailableSms = createFixture({ smsReady: () => false })
  await assert.rejects(
    () => unavailableSms.service.createChallenge(unavailableSms.context),
    { code: 'ADMIN_LOGIN_SMS_UNAVAILABLE' },
  )

  assert.throws(() => createFixture({ secret: '' }), { code: 'ADMIN_LOGIN_UNAVAILABLE' })

  assert.equal(missingPhone.store.dump().sessions.length, 0)
  assert.equal(unavailableSms.store.dump().sessions.length, 0)
})

test('service initialization rejects weak secrets, non-12-hour sessions, and unsafe OTP limits', () => {
  const weakSecrets = [
    Buffer.from(Array.from({ length: 31 }, (_, index) => index + 1)).toString('base64url'),
    'A'.repeat(64),
    'this is a long but not randomly encoded secret value',
  ]
  for (const secret of weakSecrets) {
    assert.throws(() => createFixture({ secret }), { code: 'ADMIN_LOGIN_UNAVAILABLE' })
  }
  for (const overrides of [
    { sessionTtlMs: 43_199_999 },
    { sessionTtlMs: 43_200_001 },
    { otpTtlMs: 119_999 },
    { otpTtlMs: 600_001 },
    { resendMs: 29_999 },
    { resendMs: 300_001 },
    { hourlySendLimit: 0 },
    { hourlySendLimit: 11 },
    { maxAttempts: 2 },
    { maxAttempts: 6 },
  ]) {
    assert.throws(() => createFixture(overrides), { code: 'ADMIN_LOGIN_UNAVAILABLE' })
  }
})

test('an unverified password context cannot create a challenge', async () => {
  const fixture = createFixture()
  fixture.context.passwordVerified = false
  await assert.rejects(
    () => fixture.service.createChallenge(fixture.context),
    { code: 'ADMIN_LOGIN_PASSWORD_REQUIRED' },
  )
})

test('Mongo store creates required indexes in the root database', async () => {
  const calls = []
  const collections = {
    adminLoginChallenges: { createIndex: async (...args) => calls.push(['challenge', ...args]) },
    adminLoginSessions: { createIndex: async (...args) => calls.push(['session', ...args]) },
  }
  const client = {
    db(name) {
      assert.equal(name, 'root-security-db')
      return {
        databaseName: name,
        collection(collectionName) {
          return collections[collectionName]
        },
      }
    },
  }
  const store = createMongoAdminLoginSecurityStore({
    getMongoClient: () => client,
    getMongoConfig: () => ({ dbName: 'root-security-db' }),
  })
  await store.ensureIndexes()
  assert.deepEqual(calls, [
    ['challenge', { expireAt: 1 }, { expireAfterSeconds: 0 }],
    ['challenge', { accountId: 1, tenantId: 1, createdAt: -1 }],
    ['session', { expireAt: 1 }, { expireAfterSeconds: 0 }],
    ['session', { tokenHash: 1 }, { unique: true }],
    ['session', { accountId: 1, revokedAt: 1, expireAt: 1 }],
  ])
})

test('Mongo challenge claim uses pending, attempts, and expiry conditions atomically', async () => {
  let captured
  const challenges = {
    async findOneAndUpdate(query, update, options) {
      captured = { query, update, options }
      return { id: 'challenge-1', status: 'verified' }
    },
  }
  const store = createMongoAdminLoginSecurityStore({
    getMongoClient: () => ({
      db: () => ({
        databaseName: 'root-security-db',
        collection: () => challenges,
      }),
    }),
    getMongoConfig: () => ({ dbName: 'root-security-db' }),
  })
  const now = new Date('2026-08-27T08:00:00.000Z')
  await store.claimChallenge('challenge-1', now, 5)
  assert.deepEqual(captured.query, {
    _id: 'challenge-1',
    kind: 'challenge',
    status: 'pending',
    attempts: { $lt: 5 },
    expireAt: { $gt: now },
  })
  assert.deepEqual(captured.update, { $set: { status: 'verified', verifiedAt: now } })
  assert.deepEqual(captured.options, { returnDocument: 'after' })
})

test('Mongo resend transitions suspend old challenges before activating the delivered replacement', async () => {
  const captured = []
  const challenges = {
    async updateMany(query, update) {
      captured.push({ operation: 'updateMany', query, update })
      return { matchedCount: 2, modifiedCount: 2 }
    },
    async findOneAndUpdate(query, update, options) {
      captured.push({ operation: 'findOneAndUpdate', query, update, options })
      return { id: 'challenge-new', status: 'pending' }
    },
  }
  const store = createMongoAdminLoginSecurityStore({
    getMongoClient: () => ({
      db: () => ({
        databaseName: 'root-security-db',
        collection: () => challenges,
      }),
    }),
    getMongoConfig: () => ({ dbName: 'root-security-db' }),
  })
  const now = new Date('2026-08-27T08:00:00.000Z')
  await store.suspendPendingChallengesForResend({
    accountId: 'A1',
    tenantId: 'tenant-a',
    exceptId: 'challenge-new',
    replacementId: 'challenge-new',
    now,
  })
  await store.supersedeSuspendedChallenges({ replacementId: 'challenge-new', now })
  await store.activateChallenge('challenge-new', now)
  assert.deepEqual(captured, [
    {
      operation: 'updateMany',
      query: {
        kind: 'challenge',
        accountId: 'A1',
        tenantId: 'tenant-a',
        status: 'pending',
        _id: { $ne: 'challenge-new' },
      },
      update: {
        $set: {
          status: 'resend_pending',
          replacementId: 'challenge-new',
          suspendedAt: now,
        },
      },
    },
    {
      operation: 'updateMany',
      query: {
        kind: 'challenge',
        status: 'resend_pending',
        replacementId: 'challenge-new',
      },
      update: { $set: { status: 'superseded', supersededAt: now } },
    },
    {
      operation: 'findOneAndUpdate',
      query: { _id: 'challenge-new', kind: 'challenge', status: 'send_pending' },
      update: { $set: { status: 'pending', activatedAt: now } },
      options: { returnDocument: 'after' },
    },
  ])
})

test('AdminLoginSecurityError exposes stable response fields', () => {
  const error = new AdminLoginSecurityError('ADMIN_LOGIN_SAMPLE', 'sample message', 418)
  assert.equal(error.name, 'AdminLoginSecurityError')
  assert.equal(error.code, 'ADMIN_LOGIN_SAMPLE')
  assert.equal(error.message, 'sample message')
  assert.equal(error.status, 418)
})
