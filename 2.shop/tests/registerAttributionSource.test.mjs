import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

function readSource(relativePath) {
  return fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')
}

test('pending register channel is persisted across browser sessions with expiry', () => {
  const source = readSource('src/composables/useRegisterChannel.ts')

  assert.match(source, /localStorage/)
  assert.match(source, /PENDING_REGISTER_CHANNEL_TTL_MS/)
  assert.match(source, /expiresAt/)
  assert.match(source, /JSON\.parse/)
  assert.match(source, /JSON\.stringify/)
})

test('app download entrypoints use the guarded download flow instead of opening APK directly', () => {
  const gatePath = new URL('../src/composables/useGuardedAppDownload.ts', import.meta.url)
  assert.equal(fs.existsSync(gatePath), true, 'guarded app download composable must exist')
  const gateSource = fs.readFileSync(gatePath, 'utf8')

  const routerSource = readSource('src/router/index.ts')
  const myCenterSource = readSource('src/components/my/MyCenterMobile.vue')
  const cardPackageSource = readSource('src/components/my/CardPackageSection.vue')

  assert.match(gateSource, /notifyInfo\('请登录后下载APP'\)[\s\S]*?path: '\/login'/)
  assert.match(gateSource, /downloadAfterAuth: '1'/)
  assert.match(routerSource, /path: '\/app-download'/)
  assert.match(myCenterSource, /useGuardedAppDownload/)
  assert.match(cardPackageSource, /useGuardedAppDownload/)
  assert.doesNotMatch(myCenterSource, /VITE_MALL_APP_APK_URL/)
  assert.doesNotMatch(cardPackageSource, /VITE_MALL_APP_APK_URL/)
  assert.doesNotMatch(gateSource, /downloadAfterRegister/)
  assert.doesNotMatch(gateSource, /isRegistered/)
})

test('login and registration can complete the app download auth flow directly', () => {
  const gateSource = readSource('src/composables/useGuardedAppDownload.ts')
  const loginSource = readSource('src/components/auth/LoginForm.vue')
  const registerSource = readSource('src/components/auth/RegisterForm.vue')
  const appDownloadSource = readSource('src/views/MallAppDownloadView.vue')

  assert.match(gateSource, /successMessage\?: string/)
  assert.match(gateSource, /skipAuthSync\?: boolean/)
  assert.match(loginSource, /useGuardedAppDownload/)
  assert.match(loginSource, /route\.query\.downloadAfterAuth === '1'/)
  assert.match(loginSource, /successMessage: '登录成功，正在下载APP。'/)
  assert.match(loginSource, /skipAuthSync: true/)
  assert.match(loginSource, /const downloadAfterAuth = typeof route\.query\.downloadAfterAuth === 'string'[\s\S]*\.\.\.\(downloadAfterAuth \? \{ downloadAfterAuth \} : \{\}\)/)
  assert.match(registerSource, /useGuardedAppDownload/)
  assert.match(registerSource, /route\.query\.downloadAfterAuth === '1'/)
  assert.match(registerSource, /successMessage: '注册完成，正在下载APP。'/)
  assert.match(registerSource, /skipAuthSync: true/)
  assert.match(registerSource, /successMessage: '注册完成，正在下载APP。'[\s\S]*?await smartNavigate\('\/my'\)/)
  assert.doesNotMatch(appDownloadSource, /请先完成实名注册并登录/)
})
