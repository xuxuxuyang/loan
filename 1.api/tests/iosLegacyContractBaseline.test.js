const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.join(__dirname, '..', '..')

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

test('legacy registration remains on the existing endpoint and fields', () => {
  const auth = read('2.shop/src/composables/useMallAuth.ts')
  const form = read('2.shop/src/components/auth/RegisterForm.vue')

  assert.match(auth, /\/auth\/register`/)
  assert.match(form, /idCardFront/)
  assert.match(form, /idCardBack/)
  assert.match(form, /idCardHandheld/)
  assert.match(form, /emergencyContact1Phone/)
  assert.doesNotMatch(auth, /\/ios\//)
  assert.doesNotMatch(form, /\/ios\//)
})

test('legacy order and card package endpoints remain the default outside guarded iOS actions', () => {
  const orders = read('2.shop/src/composables/useMallOrders.ts')
  const contacts = read('2.shop/src/composables/useMallContacts.ts')
  const orderComponent = read('2.shop/src/components/order/create.vue')
  const cardPackage = read('2.shop/src/components/my/CardPackageSection.vue')

  assert.match(orders, /ORDER_CREATE_PATH = '\/orders'/)
  assert.match(contacts, /\/mall\/contacts\/upload\/start/)
  assert.match(orderComponent, /installment-risk\/wave/)
  assert.match(cardPackage, /uploadMallContactsForOrder/)
  assert.doesNotMatch(orders, /\/ios\//)
  assert.doesNotMatch(contacts, /\/ios\//)
  assert.match(orderComponent, /const useIosReviewFlow = isIosNativeApp\(\)/)
  assert.match(orderComponent, /if \(!useIosReviewFlow\)[\s\S]*installment-risk\/wave/)
  assert.match(cardPackage, /if \(useIosReviewFlow\)[\s\S]*uploadIosAuthorizedContacts[\s\S]*return[\s\S]*uploadMallContactsForOrder/)
})

test('thin views still point to the legacy components before iOS dispatch', () => {
  assert.match(read('2.shop/src/views/MallRegisterView.vue'), /components\/auth\/RegisterForm\.vue/)
  assert.match(read('2.shop/src/views/MallOrderCreateView.vue'), /components\/order\/create\.vue/)
  assert.match(read('2.shop/src/views/MallCardPackageView.vue'), /components\/my\/card-package\/MyCardPackageMobile\.vue/)
  assert.match(read('2.shop/src/views/MallMyView.vue'), /components\/my\/MyCenterMobile\.vue/)
})
