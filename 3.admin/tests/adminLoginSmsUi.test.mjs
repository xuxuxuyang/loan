import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const read = relative => fs.readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8')

async function loadContract() {
  const source = read('src/api/adminLoginContract.ts')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`)
}

const validVerifiedLogin = () => ({
  username: 'reviewer-1',
  token: 'admin-session-v1.valid-token',
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  adminRole: 'reviewer',
})

test('verified admin login responses require a valid server session shape', async () => {
  const { AdminLoginApiError, validateVerifiedAdminLogin } = await loadContract()
  const valid = validVerifiedLogin()

  assert.deepEqual(validateVerifiedAdminLogin(valid), valid)
  for (const malformed of [
    { ...valid, token: '' },
    { ...valid, username: '' },
    { ...valid, adminRole: undefined },
    { ...valid, adminRole: 'not-a-role' },
    { ...valid, expiresAt: new Date(Date.now() - 1).toISOString() },
  ]) {
    assert.throws(
      () => validateVerifiedAdminLogin(malformed),
      error => error instanceof AdminLoginApiError && error.code === 'ADMIN_LOGIN_RESPONSE_INVALID',
    )
  }
})

test('challenge errors clear only terminal challenge states', async () => {
  const { AdminLoginApiError, shouldExpireChallengeForError } = await loadContract()

  assert.equal(shouldExpireChallengeForError(new AdminLoginApiError('expired', 403, 'ADMIN_LOGIN_CHALLENGE_EXPIRED')), true)
  assert.equal(shouldExpireChallengeForError(new AdminLoginApiError('invalid', 403, 'ADMIN_LOGIN_CHALLENGE_INVALID')), true)
  assert.equal(shouldExpireChallengeForError(new AdminLoginApiError('blocked', 403, 'ADMIN_LOGIN_CHALLENGE_BLOCKED')), true)
  assert.equal(shouldExpireChallengeForError(new AdminLoginApiError('wrong code', 403, 'ADMIN_LOGIN_CODE_INVALID')), false)
})

test('API error conversion preserves the server status and code', async () => {
  const { adminLoginApiErrorFromResponse } = await loadContract()
  const error = adminLoginApiErrorFromResponse({
    msg: '验证码已过期',
    code: 'ADMIN_LOGIN_CHALLENGE_EXPIRED',
  }, 403)

  assert.equal(error.message, '验证码已过期')
  assert.equal(error.status, 403)
  assert.equal(error.code, 'ADMIN_LOGIN_CHALLENGE_EXPIRED')
})

test('captured logout clears only the still-current token', async () => {
  const { shouldClearCapturedSession } = await loadContract()

  assert.equal(shouldClearCapturedSession('admin-session-v1.old', 'admin-session-v1.old'), true)
  assert.equal(shouldClearCapturedSession('admin-session-v1.new', 'admin-session-v1.old'), false)
  assert.equal(shouldClearCapturedSession(null, 'admin-session-v1.old'), false)
})

test('logout cleanup always handles absent storage but preserves a newer token', async () => {
  const { shouldClearLogoutState, shouldRequestLogoutRevoke } = await loadContract()

  assert.equal(shouldRequestLogoutRevoke(null), false)
  assert.equal(shouldRequestLogoutRevoke('   '), false)
  assert.equal(shouldRequestLogoutRevoke('admin-session-v1.old'), true)

  assert.equal(shouldClearLogoutState(null, null), true)
  assert.equal(shouldClearLogoutState(null, 'admin-session-v1.old'), true)
  assert.equal(shouldClearLogoutState('admin-session-v1.old', 'admin-session-v1.old'), true)
  assert.equal(shouldClearLogoutState('admin-session-v1.new', 'admin-session-v1.old'), false)
})

test('terminal challenge cleanup retains a non-empty server message', async () => {
  const { AdminLoginApiError, challengeResetMessage } = await loadContract()
  const fallback = '验证码已过期，请重新登录'

  assert.equal(
    challengeResetMessage(new AdminLoginApiError('验证码错误次数过多，请稍后再试', 403, 'ADMIN_LOGIN_CHALLENGE_BLOCKED'), fallback),
    '验证码错误次数过多，请稍后再试',
  )
  assert.equal(challengeResetMessage(new Error(''), fallback), fallback)
})

test('admin login uses an in-memory SMS challenge before storing a session', () => {
  const loginPage = read('src/views/LoginPage.vue')
  const loginCard = read('src/components/auth/LoginCard.vue')
  const adminLogin = read('src/api/adminLogin.ts')

  assert.match(loginPage, /createAdminLoginChallenge/)
  assert.match(loginPage, /verifyAdminLoginChallenge/)
  assert.match(loginPage, /shouldExpireChallengeForError/)
  assert.match(loginPage, /const credentials = ref/)
  assert.match(loginPage, /const challenge = ref/)
  assert.match(loginPage, /const verificationCode = ref/)
  assert.match(loginPage, /setAdminSession\([\s\S]*expiresAt/)
  assert.doesNotMatch(loginPage, /localStorage/)
  assert.match(loginCard, /验证码/)
  assert.match(loginCard, /phoneMasked/)
  assert.match(loginCard, /重新发送/)
  assert.match(loginCard, /返回修改账号/)
  assert.match(adminLogin, /admin\/login\/verify/)
  assert.match(adminLogin, /admin\/logout/)
})

test('admin sessions require a non-expired server expiry and trusted auth headers only', () => {
  const adminAuth = read('src/composables/useAdminAuth.ts')
  const adminApi = read('src/composables/useAdminApi.ts')

  assert.match(adminAuth, /expiresAt: string/)
  assert.match(adminAuth, /Date\.parse/)
  assert.match(adminAuth, /window\.localStorage\.removeItem\(STORAGE_KEY\)/)
  assert.doesNotMatch(adminApi, /headers\.set\('x-admin-role'/)
  assert.doesNotMatch(adminApi, /headers\.set\('x-admin-username'/)
  assert.match(adminApi, /headers\.set\('Authorization'/)
  assert.match(adminApi, /headers\.set\('x-tenant-id'/)
  assert.match(adminApi, /headers\.set\('x-workspace-type'/)
})

test('app starts revoke before conditionally clearing an expired session on timer and browser wakeups', () => {
  const app = read('src/App.vue')
  const adminAuth = read('src/composables/useAdminAuth.ts')

  assert.match(app, /revokeAdminLoginSession/)
  assert.match(app, /Date\.parse\(current\.expiresAt\)/)
  assert.match(app, /window\.setTimeout/)
  assert.match(app, /window\.addEventListener\('focus'/)
  assert.match(app, /document\.addEventListener\('visibilitychange'/)
  assert.match(adminAuth, /clearAdminSessionIfTokenMatches/)
  assert.match(app, /clearAdminSessionIfTokenMatches\(capturedToken\)/)
  assert.match(app, /shouldClearLogoutState/)
  assert.match(app, /shouldRequestLogoutRevoke/)
  const logoutBody = app.slice(app.indexOf('function logout('))
  const tokenRevoke = logoutBody.indexOf('revokeAdminLoginSession(token)')
  const tokenCleanup = logoutBody.indexOf('clearLocalLogoutState(token)', tokenRevoke)
  assert.ok(tokenRevoke >= 0 && tokenRevoke < tokenCleanup)
  assert.match(app, /logoutRequests = new Map/)
  assert.match(app, /request\.then\(/)
  assert.doesNotMatch(app, /request\.finally\(/)
  assert.match(app, /@confirm="\(\) => logout\(\)"/)
})
