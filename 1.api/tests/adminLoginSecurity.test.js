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

function createFixture(options = {}) {
  let nowMs = options.nowMs || Date.parse('2026-08-27T08:00:00.000Z')
  let randomSequence = 1
  const store = options.store || createMemoryAdminLoginSecurityStore()
  const code = options.code || '123456'
  const service = createAdminLoginSecurityService({
    store,
    secret: 'test-admin-login-secret-with-enough-entropy',
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
  const fixture = createFixture({ sessionTtlMs: 1000 })
  const challenge = await fixture.service.createChallenge(fixture.context)
  const login = await fixture.service.verifyChallenge({ challengeId: challenge.challengeId, code: fixture.code })
  fixture.setNow(fixture.nowMs + 1001)
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

  const incompleteConfig = createFixture({ secret: '' })
  await assert.rejects(
    () => incompleteConfig.service.createChallenge(incompleteConfig.context),
    { code: 'ADMIN_LOGIN_UNAVAILABLE' },
  )

  assert.equal(missingPhone.store.dump().sessions.length, 0)
  assert.equal(unavailableSms.store.dump().sessions.length, 0)
  assert.equal(incompleteConfig.store.dump().sessions.length, 0)
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

test('AdminLoginSecurityError exposes stable response fields', () => {
  const error = new AdminLoginSecurityError('ADMIN_LOGIN_SAMPLE', 'sample message', 418)
  assert.equal(error.name, 'AdminLoginSecurityError')
  assert.equal(error.code, 'ADMIN_LOGIN_SAMPLE')
  assert.equal(error.message, 'sample message')
  assert.equal(error.status, 418)
})
