import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read = relativePath => fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8')

test('limits the review hide switch to the native iOS runtime', () => {
  const source = read('../src/utils/iosBnplReviewVisibility.ts')
  const nativePlatformSource = read('../src/utils/iosNativePlatform.ts')

  assert.match(source, /isIosNativeApp\(\)/)
  assert.match(source, /export function isIosBnplReviewHidden\(\): boolean/)
  assert.doesNotMatch(source, /userAgent|VITE_|import\.meta\.env/)
  assert.match(nativePlatformSource, /Capacitor\.isNativePlatform\(\)/)
  assert.match(nativePlatformSource, /Capacitor\.getPlatform\(\) === 'ios'/)
})

test('keeps routes declared but redirects finance routes only behind the iOS switch', () => {
  const source = read('../src/router/index.ts')

  for (const name of ['installment', 'bill', 'bill-risk-result', 'card-package', 'traffic-login']) {
    assert.match(source, new RegExp(`name: '${name}'`))
    assert.match(source, new RegExp(`'${name}'`))
  }
  assert.match(source, /isIosBnplReviewHidden\(\)/)
  assert.match(source, /router\.beforeEach/)
  assert.match(source, /return \{ path: '\/', replace: true \}/)
})

test('does not mount the finance lead dialog in the iOS review path', () => {
  const source = read('../src/App.vue')

  assert.match(source, /isIosBnplReviewHidden/)
  assert.match(source, /<TrafficCreditLeadDialog v-if="!hideIosBnplForReview"/)
})

test('pins the iOS home and list to regular mall products', () => {
  const home = read('../src/views/MallHomeView.vue')
  const banner = read('../src/components/index/HomeBannerMobile.vue')
  const list = read('../src/views/MallListView.vue')

  assert.match(home, /hideIosBnplForReview/)
  assert.match(home, /:hide-installment-zone="hideIosBnplForReview"/)
  assert.match(banner, /hideInstallmentZone/)
  assert.match(banner, /v-if="!hideInstallmentZone"/)
  assert.match(list, /hideIosBnplForReview/)
  assert.match(list, /item\.key !== 'installment'/)
})

test('removes installment products from iOS search before rendering', () => {
  const source = read('../src/components/search/MallSearchMobile.vue')

  assert.match(source, /hideIosBnplForReview/)
  assert.match(source, /if \(!hideIosBnplForReview\)/)
  assert.match(source, /仅搜索商城专区的全部商品/)
})

test('blocks cached or deep-linked installment products before iOS checkout', () => {
  const detail = read('../src/views/MallProductDetailView.vue')
  const checkout = read('../src/components/order/create.vue')

  assert.match(detail, /hideIosBnplForReview/)
  assert.match(detail, /salesMode === 'installment'/)
  assert.match(detail, /smartNavigate\('\/'\)/)
  assert.match(checkout, /hideIosBnplForReview/)
  assert.match(checkout, /selectedProduct\.value\?\.salesMode === 'installment'/)
  assert.match(checkout, /该商品在当前 iOS 版本暂不可用/)
  assert.doesNotMatch(checkout, /先享后付商品在当前 iOS 版本暂不可用/)
})

test('hides finance shortcuts and recommendations only in the iOS review path', () => {
  const source = read('../src/components/my/MyCenterMobile.vue')

  assert.match(source, /hideIosBnplForReview/)
  assert.match(source, /v-if="!hideIosBnplForReview"[\s\S]*@click="handleBill"/)
  assert.match(source, /v-if="!hideIosBnplForReview"[\s\S]*@click="handleCardPackage"/)
  assert.match(source, /v-if="!hideIosBnplForReview"[\s\S]*先享后付/)
})

test('filters historical installment orders from iOS without mutating order data', () => {
  const source = read('../src/components/my/order/MyOrderMobile.vue')

  assert.match(source, /hideIosBnplForReview/)
  assert.match(source, /!hideIosBnplForReview \|\| item\.payType !== 'installment'/)
  assert.doesNotMatch(source, /splice\(|orders\.value\s*=/)
})

test('keeps original finance policy text for H5 and Android behind the iOS condition', () => {
  const agreement = read('../src/components/my/user-agreement/UserAgreementContent.vue')
  const privacy = read('../src/components/my/privacy-policy/PrivacyPolicyContent.vue')

  assert.match(agreement, /v-if="!hideIosBnplForReview"/)
  assert.match(agreement, /商品、订单与先享后付/)
  assert.match(privacy, /v-if="hideIosBnplForReview"/)
  assert.match(privacy, /v-else/)
  assert.match(privacy, /支付与先享后付相关信息/)
})
