import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const orderReview = fs.readFileSync(new URL('../src/views/OrderReviewPage.vue', import.meta.url), 'utf8')
const ordersPage = fs.readFileSync(new URL('../src/views/OrdersPage.vue', import.meta.url), 'utf8')
const receivablePage = fs.readFileSync(new URL('../src/views/ReceivableByDatePage.vue', import.meta.url), 'utf8')
const orderStore = fs.readFileSync(new URL('../src/stores/useOrdersStore.ts', import.meta.url), 'utf8')

test('order review page renders register channel column after user and exposes channel filter', () => {
  assert.match(orderReview, /import TrafficChannelNameTag/)
  assert.match(orderReview, /const registerChannelFilter = ref/)
  assert.match(orderReview, /fetchTrafficChannelsForFilter/)
  assert.match(orderReview, /registerChannel: registerChannelFilter\.value/)
  assert.match(orderReview, /<th>用户<\/th>\s*<th>注册渠道<\/th>/)
  assert.match(orderReview, /<td class="td-user-risk">[\s\S]*?<\/td>\s*<td class="td-register-channel">/)
})

test('approved and card-data order tables render register channel column after user', () => {
  assert.match(ordersPage, /import TrafficChannelNameTag/)
  assert.match(ordersPage, /<th>用户<\/th>\s*<th>注册渠道<\/th>/)
  assert.match(ordersPage, /<td class="td-user-risk">[\s\S]*?<\/td>\s*<td class="td-register-channel">/)
  assert.match(ordersPage, /orderTableColspan = computed\(\(\) => \(isCardPackageDataPage\.value \? 16 : 15\)\)/)
})

test('receivable tables render register channel column after registered user', () => {
  assert.match(receivablePage, /import TrafficChannelNameTag/)
  assert.match(receivablePage, /label="用户（注册）"[\s\S]*?<\/el-table-column>\s*<el-table-column[\s\S]*?label="注册渠道"/)
  assert.match(receivablePage, /class="td-register-channel"/)
})

test('order store maps register channel fields from API payload', () => {
  assert.match(orderStore, /registerChannelCode\?: string/)
  assert.match(orderStore, /registerChannelName\?: string/)
  assert.match(orderStore, /registerChannelLabel\?: string/)
  assert.match(orderStore, /registerChannelCode: typeof order\.registerChannelCode === 'string'/)
  assert.match(orderStore, /if \(params\.registerChannel/)
})
