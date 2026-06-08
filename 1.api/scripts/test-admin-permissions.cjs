const assert = require('assert')
const {
  ADMIN_PERMISSION_TREE,
  ADMIN_PERMISSION_ACTIONS,
  ADMIN_PERMISSION_ACTION_LABELS,
  normalizeAdminPermissions,
  defaultAdminPermissionsForRole,
  effectiveAdminPermissions,
  hasAdminPermission,
  normalizeAdminUsersListView,
  adminUsersPermissionKeyForView,
  hasAdminUsersListViewPermission,
  hasAdminUsersPermissionOnAny,
  hasAdminMarkPaidPermission,
  hasAdminShipmentTrackingPermission,
  hasAdminOrderDeletePermission,
  canGrantAdminPermissions,
  resetAdminPermissionsForRole,
  canManageRolePermissions,
  adminOrderPermissionKeyForListScope,
  adminProductPermissionKeyForSalesMode,
  adminReceivablePermissionKeyForDueDate,
  hasAdminPermissionCompat,
} = require('../src/adminPermissions')

/** 与 3.admin 各页面按钮/表单能力一一对应；变更页面功能时须同步更新 */
const PAGE_PERMISSION_SPEC = {
  'cs.messages': ['view', 'reply'],
  'orders.review': ['view', 'review', 'delete'],
  'orders.approved': ['view', 'update', 'updateStatus', 'fillTracking', 'updateContract', 'issueCard', 'delete'],
  'orders.cardData': ['view', 'fillTracking', 'issueCard', 'markPaid', 'delayRepayment', 'settleAmount', 'negotiateRepayment', 'revokePaid'],
  'orders.receivable.today': ['view'],
  'orders.receivable.tomorrow': ['view'],
  'users.registered': ['view', 'create', 'update', 'setQuota', 'remark', 'blacklist', 'riskCheck', 'resetPassword', 'delete', 'export'],
  'users.noOrder': ['view', 'update', 'setQuota', 'remark', 'blacklist', 'riskCheck', 'resetPassword', 'delete'],
  'users.ordering': ['view', 'update', 'setQuota', 'remark', 'blacklist', 'riskCheck', 'resetPassword', 'delete'],
  'products.installment': ['view', 'create', 'update', 'toggleOnSale', 'uploadImage', 'delete'],
  'products.mall': ['view', 'create', 'update', 'toggleOnSale', 'uploadImage', 'delete'],
  accounts: ['view', 'create', 'update', 'toggleStatus', 'changeRole', 'resetPassword', 'delete', 'permission'],
  traffic: ['view', 'create', 'update', 'toggleStatus', 'remark', 'editChannel', 'bindPortalAccount', 'delete'],
  dashboard: ['view'],
  'tenants.system': ['view', 'create', 'update', 'delete', 'purgeTenantData', 'switchTenant'],
  'tenants.mallUsersData': ['view'],
}

function flattenPermissionActionNodes(nodes = ADMIN_PERMISSION_TREE) {
  const out = []
  nodes.forEach((node) => {
    out.push(node)
    if (Array.isArray(node.children)) {
      out.push(...flattenPermissionActionNodes(node.children))
    }
  })
  return out
}

flattenPermissionActionNodes().forEach((node) => {
  if (!Object.prototype.hasOwnProperty.call(PAGE_PERMISSION_SPEC, node.key)) {
    return
  }
  assert.deepEqual(node.actions, PAGE_PERMISSION_SPEC[node.key], `actions mismatch for ${node.key}`)
})

Object.keys(PAGE_PERMISSION_SPEC).forEach((key) => {
  const node = flattenPermissionActionNodes().find(item => item.key === key)
  assert.ok(node, `PAGE_PERMISSION_SPEC key missing from tree: ${key}`)
})

assert.ok(Array.isArray(ADMIN_PERMISSION_TREE), 'permission tree should be an array')
assert.ok(ADMIN_PERMISSION_TREE.some(item => item.key === 'orders'), 'orders menu should exist')
assert.equal(ADMIN_PERMISSION_ACTIONS.includes('reply'), true)
assert.equal(ADMIN_PERMISSION_ACTION_LABELS.reply, '回复')

const csNode = ADMIN_PERMISSION_TREE.find(item => item.key === 'cs')
assert.deepEqual(csNode.actions, ['view'])
assert.deepEqual(csNode.children[0].actions, ['view', 'reply'])

assert.equal(hasAdminOrderDeletePermission({ role: 'reviewer', permissions: {
  menus: ['orders', 'orders.review'],
  actions: { 'orders.review': ['view', 'review', 'delete'] },
} }, 'reviewing'), true)
assert.equal(hasAdminOrderDeletePermission({ role: 'reviewer', permissions: {
  menus: ['orders', 'orders.approved'],
  actions: { 'orders.approved': ['view', 'delete'] },
} }, 'shipping'), true)
assert.equal(hasAdminOrderDeletePermission({ role: 'reviewer', permissions: {
  menus: ['orders', 'orders.review'],
  actions: { 'orders.review': ['view', 'review'] },
} }, 'reviewing'), false)

assert.equal(hasAdminMarkPaidPermission({ role: 'collector', permissions: {
  menus: ['orders', 'orders.cardData'],
  actions: { 'orders.cardData': ['view', 'markPaid'] },
} }), true)
assert.equal(hasAdminMarkPaidPermission({ role: 'collector', permissions: {
  menus: ['orders', 'orders.receivable.today'],
  actions: { 'orders.receivable.today': ['view'] },
} }), false)
assert.equal(hasAdminPermission({ role: 'collector', permissions: {
  menus: ['orders', 'orders.cardData'],
  actions: { 'orders.cardData': ['view', 'issueCard'] },
} }, 'orders.cardData', 'issueCard'), true)
assert.equal(hasAdminPermission({ role: 'collector', permissions: {
  menus: ['orders', 'orders.approved'],
  actions: { 'orders.approved': ['view', 'update'] },
} }, 'orders.approved', 'issueCard'), false)
assert.equal(hasAdminPermission({ role: 'boss', permissions: {
  menus: ['orders', 'orders.approved'],
  actions: { 'orders.approved': ['view', 'issueCard'] },
} }, 'orders.approved', 'issueCard'), true)
assert.equal(hasAdminPermission({ role: 'boss', permissions: {
  menus: ['orders', 'orders.cardData'],
  actions: { 'orders.cardData': ['view', 'fillTracking'] },
} }, 'orders.cardData', 'fillTracking'), true)
assert.equal(hasAdminPermissionCompat({ role: 'boss', permissions: {
  menus: ['orders', 'orders.approved'],
  actions: { 'orders.approved': ['view', 'update'] },
} }, 'orders.approved', 'updateStatus', 'update'), true)
assert.equal(adminOrderPermissionKeyForListScope('pending'), 'orders.review')
assert.equal(adminOrderPermissionKeyForListScope('card-data'), 'orders.cardData')
assert.equal(adminOrderPermissionKeyForListScope(''), 'orders.approved')
assert.equal(adminProductPermissionKeyForSalesMode('installment'), 'products.installment')
assert.equal(adminProductPermissionKeyForSalesMode('mall'), 'products.mall')
assert.equal(adminReceivablePermissionKeyForDueDate('2099-01-02', '2099-01-01'), 'orders.receivable.tomorrow')
assert.equal(adminReceivablePermissionKeyForDueDate('2099-01-03', '2099-01-01'), 'orders.receivable.today')
assert.equal(hasAdminShipmentTrackingPermission({ role: 'boss', permissions: {
  menus: ['orders', 'orders.cardData'],
  actions: { 'orders.cardData': ['view', 'fillTracking'] },
} }), true)
assert.equal(hasAdminShipmentTrackingPermission({ role: 'reviewer', permissions: {
  menus: ['orders', 'orders.approved'],
  actions: { 'orders.approved': ['view', 'update'] },
} }), false)
assert.equal(hasAdminShipmentTrackingPermission({ role: 'reviewer', permissions: {
  menus: ['orders', 'orders.approved'],
  actions: { 'orders.approved': ['view', 'fillTracking'] },
} }), true)
assert.equal(hasAdminPermission({ role: 'collector', permissions: {
  menus: ['orders', 'orders.cardData'],
  actions: { 'orders.cardData': ['view', 'markPaid'] },
} }, 'orders.cardData', 'fillTracking'), false)
assert.equal(ADMIN_PERMISSION_ACTION_LABELS.fillTracking, '填写单号')
assert.equal(ADMIN_PERMISSION_ACTION_LABELS.updateStatus, '修改订单状态')
assert.equal(ADMIN_PERMISSION_ACTION_LABELS.updateContract, '修改合同签署状态')

assert.equal(normalizeAdminUsersListView('no-order'), 'no-order')
assert.equal(adminUsersPermissionKeyForView('ordering'), 'users.ordering')
assert.equal(hasAdminUsersListViewPermission({ role: 'reviewer', permissions: {
  menus: ['users', 'users.noOrder'],
  actions: { 'users.noOrder': ['view', 'update', 'delete'] },
} }, 'no-order'), true)
assert.equal(hasAdminUsersListViewPermission({ role: 'reviewer', permissions: {
  menus: ['users', 'users.noOrder'],
  actions: { 'users.noOrder': ['view'] },
} }, 'registered'), false)
assert.equal(hasAdminUsersPermissionOnAny({ role: 'reviewer', permissions: {
  menus: ['users', 'users.ordering'],
  actions: { 'users.ordering': ['view', 'update'] },
} }, 'update'), true)
assert.equal(hasAdminUsersPermissionOnAny({ role: 'reviewer', permissions: {
  menus: ['users', 'users.noOrder'],
  actions: { 'users.noOrder': ['view'] },
} }, 'delete'), false)

const reviewerDefaults = defaultAdminPermissionsForRole('reviewer')
assert.equal(reviewerDefaults.menus.includes('orders.review'), true)
assert.equal(reviewerDefaults.actions['orders.review'].includes('view'), true)
assert.equal(reviewerDefaults.actions['orders.review'].includes('review'), true)
assert.deepEqual(reviewerDefaults.actions['orders.approved'], ['view'])
assert.equal(reviewerDefaults.menus.includes('users'), true)
assert.deepEqual(reviewerDefaults.actions['users.registered'], ['view'])
assert.equal(reviewerDefaults.actions['users.registered'].includes('delete'), false)

const collectorDefaults = defaultAdminPermissionsForRole('collector')
assert.equal(collectorDefaults.menus.includes('orders.receivable.today'), true)
assert.equal(collectorDefaults.actions['orders.receivable.today'].includes('view'), true)
assert.equal(Boolean(collectorDefaults.actions['orders.review']?.includes('review')), false)

const bossDefaults = defaultAdminPermissionsForRole('boss')
assert.equal(bossDefaults.menus.includes('accounts'), true)
assert.equal(bossDefaults.menus.includes('tenants'), false)
assert.equal(bossDefaults.menus.includes('tenants.system'), false)

const normalized = normalizeAdminPermissions({
  menus: ['orders', 'orders.review', 'bad-key'],
  actions: {
    'orders.review': ['view', 'review', 'delete', 'bad-action'],
    'cs.messages': ['view', 'reply', 'delete'],
    'bad-key': ['view'],
  },
})
assert.deepEqual(normalized.menus, ['orders', 'orders.review', 'cs.messages'])
assert.deepEqual(normalized.actions['orders.review'], ['view', 'review', 'delete'])
assert.deepEqual(normalized.actions['cs.messages'], ['view', 'reply'])
assert.equal(normalized.actions['bad-key'], undefined)

assert.equal(canManageRolePermissions('super_admin'), true)
assert.equal(canManageRolePermissions('boss'), true)
assert.equal(canManageRolePermissions('reviewer'), false)

assert.equal(hasAdminPermission({ role: 'super_admin' }, 'tenants.system', 'delete'), true)
assert.equal(hasAdminPermission({ role: 'reviewer' }, 'orders.review', 'review'), true)
assert.equal(hasAdminPermission({ role: 'reviewer' }, 'users.registered', 'delete'), false)
assert.equal(hasAdminPermission({
  role: 'reviewer',
  permissions: {
    menus: ['orders', 'orders.review'],
    actions: { 'orders.review': ['view'] },
  },
}, 'orders.review', 'review'), false)
assert.equal(hasAdminPermission({
  role: 'reviewer',
  permissions: {
    menus: ['orders', 'orders.review'],
    actions: { 'orders.review': ['view', 'review'] },
  },
}, 'orders.review', 'review'), true)

const emptyEffective = effectiveAdminPermissions('reviewer', { menus: [], actions: {} })
assert.equal(emptyEffective.menus.includes('orders.review'), false)
assert.equal(hasAdminPermission({ role: 'reviewer', permissions: emptyEffective }, 'orders.review', 'view'), false)

assert.equal(canGrantAdminPermissions({
  role: 'boss',
  permissions: defaultAdminPermissionsForRole('boss'),
}, {
  menus: ['accounts'],
  actions: { accounts: ['view', 'permission'] },
}), true)
assert.equal(canGrantAdminPermissions({
  role: 'boss',
  permissions: defaultAdminPermissionsForRole('boss'),
}, {
  menus: ['tenants.system'],
  actions: { 'tenants.system': ['view', 'delete'] },
}), false)
assert.equal(canGrantAdminPermissions({
  role: 'reviewer',
  permissions: defaultAdminPermissionsForRole('reviewer'),
}, {
  menus: ['orders.review'],
  actions: { 'orders.review': ['view'] },
}), false)

assert.deepEqual(resetAdminPermissionsForRole('collector'), defaultAdminPermissionsForRole('collector'))

console.log('admin permission tests passed')
