import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')

test('operation logs have a protected readonly route and sidebar entry', () => {
  const router = read('src/router/index.ts')
  const permissions = read('src/composables/useAdminPermissions.ts')
  const app = read('src/App.vue')
  const page = read('src/views/OperationLogsPage.vue')

  assert.match(router, /path: '\/security\/operation-logs'/)
  assert.match(router, /permissionKey: 'security\.audit'/)
  assert.match(router, /path: '\/security\/operation-logs'[\s\S]*strictRoles: true/)
  assert.match(router, /strictRoles\s*\|\|\s*!adminHasConfiguredPermissions\(session\)/)
  assert.match(permissions, /'\/security\/operation-logs': 'security\.audit'/)
  const menuViewStart = permissions.indexOf('export function adminHasMenuView')
  const menuViewEnd = permissions.indexOf('\nexport function adminHasConfiguredPermissions', menuViewStart)
  const menuViewSource = permissions.slice(menuViewStart, menuViewEnd)
  assert.match(menuViewSource, /session\.role === 'super_admin'[\s\S]*key === 'security\.audit'/)
  assert.match(app, /label: '操作记录', path: '\/security\/operation-logs'/)
  assert.ok(app.indexOf("label: '财务汇算'") < app.indexOf("label: '操作记录'"))
  assert.ok(app.indexOf("label: '操作记录'") < app.indexOf("label: '子系统管理'"))
  assert.match(page, /admin\/security\/audit-logs/)
  assert.doesNotMatch(page, /回滚|删除日志|编辑日志/)
})

test('operation logs use one date filter and show only key record information', () => {
  const page = read('src/views/OperationLogsPage.vue')

  assert.match(page, /const operationDate = ref<Date>\(new Date\(\)\)/)
  assert.match(page, /type="date"/)
  assert.match(page, /@change="changeOperationDate"/)
  assert.match(page, /const pageSize = ref\(50\)/)
  assert.match(page, /当日共/)
  assert.match(page, /当日暂无操作记录/)
  assert.match(page, /label="时间"/)
  assert.match(page, /label="操作人 \/ 角色"/)
  assert.match(page, /label="操作类型"/)
  assert.match(page, /label="操作对象"/)
  assert.match(page, /label="变更内容"/)
  assert.match(page, /label="IP"/)
  assert.match(page, /label="结果"/)
  assert.doesNotMatch(page, /SECURITY TRACE|security-mode-card|fetchAdminSecurityStatus/)
  assert.doesNotMatch(page, /categoryOptions|statusOptions|actorOptions|const keyword = ref/)
})

test('shared sensitive operation guard keeps proofs in memory and drives the SMS dialog', () => {
  const api = read('src/api/adminSecurity.ts')
  const guard = read('src/composables/useSensitiveOperationGuard.ts')
  const dialog = read('src/components/SensitiveOperationConfirmDialog.vue')
  const app = read('src/App.vue')

  assert.match(api, /admin\/security\/status/)
  assert.match(api, /admin\/security\/challenges/)
  assert.match(api, /X-Admin-Security-Proof/)
  assert.match(guard, /repaymentProof/)
  assert.doesNotMatch(guard, /localStorage|sessionStorage/)
  assert.match(dialog, /发送验证码/)
  assert.match(dialog, /身份已验证/)
  assert.match(dialog, /六位验证码/)
  assert.match(app, /SensitiveOperationConfirmDialog/)
})

test('all planned frontend mutations request a proof and pass it to the API', () => {
  const ordersPage = read('src/views/OrdersPage.vue')
  const reviewPage = read('src/views/OrderReviewPage.vue')
  const usersPage = read('src/views/UsersPage.vue')
  const ordersStore = read('src/stores/useOrdersStore.ts')

  assert.match(usersPage, /ACTION_CODES\.USER_DELETE/)
  assert.match(usersPage, /ACTION_CODES\.USER_EXPORT/)
  assert.match(ordersPage, /ACTION_CODES\.ORDER_DELETE/)
  assert.match(reviewPage, /ACTION_CODES\.ORDER_DELETE/)
  assert.match(ordersPage, /ACTION_CODES\.REPAYMENT_MARK_PAID/)
  assert.match(ordersPage, /ACTION_CODES\.REPAYMENT_CHANGE_DUE_DATE/)
  assert.match(ordersPage, /ACTION_CODES\.REPAYMENT_SETTLE_AMOUNT/)
  assert.match(ordersPage, /ACTION_CODES\.REPAYMENT_NEGOTIATE/)
  assert.match(ordersPage, /ACTION_CODES\.REPAYMENT_NEGOTIATION_PAID/)
  assert.ok((ordersStore.match(/adminSecurityProofHeaders\(proofToken\)/g) || []).length >= 6)
  assert.match(ordersStore, /clearSensitiveOperationProof/)
})

test('repayment submissions stay disabled until the sensitive request finishes', () => {
  const ordersPage = read('src/views/OrdersPage.vue')

  assert.match(ordersPage, /const repaymentSavingKey = ref\(''\)/)
  assert.match(ordersPage, /repaymentSavingKey\.value = `\$\{order\.id\}-\$\{period\.period\}`/)
  assert.match(ordersPage, /finally \{\s*repaymentSavingKey\.value = ''\s*\}/)
  assert.match(ordersPage, /:disabled="[^"]*!!repaymentSavingKey/)
})
