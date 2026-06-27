import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const orderReview = fs.readFileSync(new URL('../src/views/OrderReviewPage.vue', import.meta.url), 'utf8')
const orderStore = fs.readFileSync(new URL('../src/stores/useOrdersStore.ts', import.meta.url), 'utf8')
const usersPage = fs.readFileSync(new URL('../src/views/UsersPage.vue', import.meta.url), 'utf8')

test('manual reject reason is collected and displayed in failed review rows', () => {
  assert.match(orderReview, /promptManualRejectReason/)
  assert.match(orderReview, /rejectOrderReview\(order\.id, reason\)/)
  assert.match(orderReview, /<th[^>]*>不通过原因<\/th>/)
  assert.match(orderReview, /manualRejectReason \|\| item\.riskReason/)
})

test('manual reject reason flows through order store and user export selector', () => {
  assert.match(orderStore, /manualRejectReason: string/)
  assert.match(orderStore, /manualRejectReason\?: string/)
  assert.match(orderStore, /manualRejectReason: order\.manualRejectReason \|\| ''/)
  assert.match(usersPage, /key: 'manualRejectReason', label: '不通过原因'/)
})
