const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.join(__dirname, '..', '..')
const platformFile = path.join(repoRoot, '2.shop', 'src', 'utils', 'iosNativePlatform.ts')

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

test('iOS dispatch uses only the Capacitor native platform contract', () => {
  assert.equal(fs.existsSync(platformFile), true, 'iosNativePlatform.ts must define the isolated platform boundary')
  const source = fs.readFileSync(platformFile, 'utf8')

  assert.match(source, /Capacitor\.isNativePlatform\(\)/)
  assert.match(source, /Capacitor\.getPlatform\(\) === 'ios'/)
  assert.doesNotMatch(source, /userAgent|navigator|review|audit|domain|hostname/i)
})

test('thin views dispatch iOS components while retaining legacy branches', () => {
  const cases = [
    ['2.shop/src/views/MallRegisterView.vue', 'RegisterForm', 'IosRegisterForm'],
    ['2.shop/src/views/MallOrderCreateView.vue', 'OrderCreate', 'IosOrderCreate'],
    ['2.shop/src/views/MallCardPackageView.vue', 'MyCardPackageMobile', 'IosCardPackageMobile'],
    ['2.shop/src/views/MallMyView.vue', 'MyCenterMobile', 'IosMyCenterMobile'],
  ]

  for (const [relativePath, legacyName, iosName] of cases) {
    const source = read(relativePath)
    assert.match(source, /isIosNativeApp/)
    assert.match(source, new RegExp(`<${iosName}\\b`))
    assert.match(source, new RegExp(`<${legacyName}\\b`))
    assert.match(source, /v-if="useIosFlow"/)
    assert.match(source, /v-else/)
  }
})

test('OTA exits on iOS before invoking the updater and keeps Android code', () => {
  const source = read('2.shop/src/composables/useAppOtaUpdate.ts')
  const iosGuard = source.indexOf("Capacitor.getPlatform() === 'ios'")
  const notify = source.indexOf('CapacitorUpdater.notifyAppReady()')

  assert.ok(iosGuard >= 0, 'iOS OTA guard must exist')
  assert.ok(notify > iosGuard, 'iOS guard must run before the updater')
  assert.match(source, /CapacitorUpdater\.download/)
  assert.match(source, /CapacitorUpdater\.set/)
})

test('API entrypoint mounts the isolated iOS module without changing legacy route paths', () => {
  const source = read('1.api/src/index.js')

  assert.match(source, /require\('\.\/ios'\)/)
  assert.match(source, /registerIosAppRoutes\(router,/)
  assert.match(source, /router\.post\('\/auth\/register'/)
  assert.match(source, /router\.post\('\/orders'/)
  assert.doesNotMatch(source, /router\.post\('\/auth\/register'.*\/ios\//)
})

test('iOS registration UI and API collect no identity or emergency contact fields', () => {
  const api = read('2.shop/src/api/modules/iosMall.ts')
  const form = read('2.shop/src/components/ios/auth/IosRegisterForm.vue')

  assert.match(api, /\/ios\/auth\/register/)
  assert.match(api, /\/ios\/auth\/register\/sms\/send/)
  assert.match(form, /form\.phone/)
  assert.match(form, /form\.smsCode/)
  assert.match(form, /form\.password/)
  assert.match(form, /form\.passwordConfirm/)
  assert.doesNotMatch(form, /idNumber|idCardFront|idCardBack|idCardHandheld|emergencyContact/i)
})

test('iOS installment identity collection lives only in the isolated order components', () => {
  const api = read('2.shop/src/api/modules/iosMall.ts')
  const order = read('2.shop/src/components/ios/order/IosOrderCreate.vue')
  const profileForm = read('2.shop/src/components/ios/order/IosInstallmentProfileForm.vue')
  const profileSummary = read('2.shop/src/components/ios/order/IosInstallmentProfileSummary.vue')

  assert.match(api, /\/ios\/uploads\/id-card/)
  assert.match(api, /\/ios\/installment\/profile/)
  assert.match(order, /IosInstallmentProfileForm/)
  assert.match(order, /IosInstallmentProfileSummary/)
  assert.match(profileForm, /idCardFront/)
  assert.match(profileForm, /idCardBack/)
  assert.match(profileForm, /idCardHandheld/)
  assert.match(profileForm, /emergencyContacts/)
  assert.match(profileSummary, /使用已有资料/)
  assert.match(profileSummary, /重新填写/)
})

test('iOS installment order runs every isolated risk step before the isolated order request', () => {
  const api = read('2.shop/src/api/modules/iosMall.ts')
  const order = read('2.shop/src/components/ios/order/IosOrderCreate.vue')

  assert.match(api, /\/ios\/installment-risk\/wave/)
  assert.match(api, /\/ios\/installment\/orders/)
  const riskCall = order.indexOf('runIosInstallmentRiskStep')
  const orderCall = order.indexOf('createIosInstallmentOrder')
  assert.ok(riskCall >= 0)
  assert.ok(orderCall > riskCall, 'order creation must appear after risk-step execution')
  assert.match(order, /payType: 'full'/)
})

test('iOS requests only authorized contacts after an approved order enters the contract flow', () => {
  const api = read('2.shop/src/api/modules/iosMall.ts')
  const cardPackage = read('2.shop/src/components/ios/my/IosCardPackageMobile.vue')
  const consent = read('2.shop/src/components/ios/my/IosContactsConsent.vue')
  const backendContacts = read('1.api/src/ios/contacts.js')

  assert.match(api, /\/ios\/orders\/\$\{encodeURIComponent\(orderId\)\}\/contacts\/upload/)
  assert.match(api, /\$\{path\}\/start/)
  assert.match(api, /\$\{path\}\/batch/)
  assert.match(api, /\$\{path\}\/complete/)
  assert.match(cardPackage, /readNativeDeviceContacts/)
  assert.match(cardPackage, /uploadIosAuthorizedContacts/)
  assert.match(consent, /合同签署前/)
  assert.match(consent, /系统实际授权/)
  assert.match(backendContacts, /dedupeByPhone:\s*true/)
  assert.doesNotMatch(cardPackage + consent, /完全访问|全部联系人/)
})

test('iOS skips a repeated contacts prompt when the contract is already available', () => {
  const cardPackage = read('2.shop/src/components/ios/my/IosCardPackageMobile.vue')
  assert.match(cardPackage, /async function beginContract[\s\S]*fetchCardPackageContractFlow[\s\S]*consentVisible\.value = true/)
})

test('iOS identity images are converted before upload and full purchases enter payment', () => {
  const profileForm = read('2.shop/src/components/ios/order/IosInstallmentProfileForm.vue')
  const order = read('2.shop/src/components/ios/order/IosOrderCreate.vue')

  assert.match(profileForm, /compressIosIdentityImage/)
  assert.match(profileForm, /image\/jpeg/)
  assert.match(order, /LakalaPaySheet/)
  assert.match(order, /payPreorderPayload/)
})

test('iOS personal center exposes complete in-app account deletion', () => {
  const api = read('2.shop/src/api/modules/iosMall.ts')
  const center = read('2.shop/src/components/ios/my/IosMyCenterMobile.vue')
  const security = read('2.shop/src/components/ios/my/IosAccountSecurity.vue')

  assert.match(api, /\/ios\/account\/deletion-eligibility/)
  assert.match(api, /\/ios\/account\/delete/)
  assert.match(api, /confirm: true/)
  assert.match(center, /账号与安全/)
  assert.match(center, /localStorage\.removeItem\('mall-orders'\)/)
  assert.match(center, /localStorage\.removeItem\('mall_cs_visitor_key'\)/)
  assert.match(center, /localStorage\.removeItem\('mall_cs_session_id'\)/)
  assert.match(center, /localStorage\.removeItem\('mall_cs_secret'\)/)
  assert.match(center, /sessionStorage\.removeItem\('lakala_pending_pay'\)/)
  assert.doesNotMatch(center, /(?:localStorage|sessionStorage)\.clear\(\)/)
  assert.match(center, /orders\.value = \[\]/)
  assert.match(center, /addresses\.value = \[\]/)
  assert.match(center, /bankCards\.value = \[\]/)
  assert.match(center, /cardPackages\.value = \[\]/)
  assert.match(center, /bills\.value = \[\]/)
  assert.match(security, /currentPassword/)
  assert.match(security, /永久注销账号/)
  assert.doesNotMatch(security, /联系客服|发送邮件|拨打电话/)
})

test('iOS privacy usage strings match the deferred collection moments', () => {
  const plist = read('2.shop/ios/App/App/Info.plist')

  assert.match(plist, /NSContactsUsageDescription/)
  assert.match(plist, /订单审核通过/)
  assert.match(plist, /合同签署前/)
  assert.match(plist, /NSCameraUsageDescription/)
  assert.match(plist, /NSPhotoLibraryUsageDescription/)
  assert.match(plist, /主动申请先享后付/)
  assert.doesNotMatch(plist, /完全访问/)
})
