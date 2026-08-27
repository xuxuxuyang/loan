import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read = relative => fs.readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8')

test('admin login uses an in-memory SMS challenge before storing a session', () => {
  const loginPage = read('src/views/LoginPage.vue')
  const loginCard = read('src/components/auth/LoginCard.vue')
  const adminLogin = read('src/api/adminLogin.ts')

  assert.match(loginPage, /createAdminLoginChallenge/)
  assert.match(loginPage, /verifyAdminLoginChallenge/)
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

test('app revokes then clears an expired session on timer and browser wakeups', () => {
  const app = read('src/App.vue')

  assert.match(app, /revokeAdminLoginSession/)
  assert.match(app, /Date\.parse\(current\.expiresAt\)/)
  assert.match(app, /window\.setTimeout/)
  assert.match(app, /window\.addEventListener\('focus'/)
  assert.match(app, /document\.addEventListener\('visibilitychange'/)
  assert.match(app, /finally\s*\{[\s\S]*clearAdminSession\(\)/)
  assert.match(app, /@confirm="\(\) => logout\(\)"/)
})
