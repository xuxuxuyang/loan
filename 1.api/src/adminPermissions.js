const ADMIN_PERMISSION_ACTION_LABELS = {
  view: '查看',
  reply: '回复',
  review: '审核',
  issueCard: '发卡包',
  fillTracking: '填写单号',
  markPaid: '标记回款',
  delayRepayment: '\u5ef6\u671f\u8fd8\u6b3e',
  settleAmount: '\u534f\u5546\u7ed3\u6e05\u91d1\u989d',
  negotiateRepayment: '\u534f\u5546\u8fd8\u6b3e',
  revokePaid: '\u64a4\u9500\u56de\u6b3e',
  updateStatus: '\u4fee\u6539\u8ba2\u5355\u72b6\u6001',
  updateContract: '\u4fee\u6539\u5408\u540c\u7b7e\u7f72\u72b6\u6001',
  setQuota: '\u8c03\u6574\u989d\u5ea6',
  remark: '\u5907\u6ce8',
  blacklist: '\u62c9\u9ed1\u4e0b\u5355',
  riskCheck: '\u98ce\u63a7\u6838\u67e5',
  resetPassword: '\u91cd\u7f6e\u5bc6\u7801',
  toggleOnSale: '\u4e0a\u4e0b\u67b6',
  uploadImage: '\u4e0a\u4f20\u56fe\u7247',
  toggleStatus: '\u542f\u505c',
  changeRole: '\u4fee\u6539\u89d2\u8272',
  editChannel: '\u7f16\u8f91\u6e20\u9053',
  bindPortalAccount: '\u7ed1\u5b9a\u6570\u636e\u540e\u53f0\u8d26\u53f7',
  purgeTenantData: '\u6e05\u7a7a\u5b50\u7cfb\u7edf\u6570\u636e',
  export: '导出',
  create: '新增',
  update: '编辑',
  delete: '删除',
  permission: '分配权限',
  switchTenant: '切换子系统',
}

const ADMIN_PERMISSION_TREE = [
  {
    key: 'cs',
    label: '客服消息',
    actions: ['view'],
    children: [
      { key: 'cs.messages', label: '客服会话', actions: ['view', 'reply'] },
    ],
  },
  {
    key: 'orders',
    label: '订单管理',
    actions: ['view'],
    children: [
      { key: 'orders.review', label: '未审核订单', actions: ['view', 'review', 'delete'] },
      { key: 'orders.approved', label: '已审核订单', actions: ['view', 'update', 'updateStatus', 'fillTracking', 'updateContract', 'issueCard', 'delete'] },
      { key: 'orders.cardData', label: '订单数据', actions: ['view', 'fillTracking', 'issueCard', 'markPaid', 'delayRepayment', 'settleAmount', 'negotiateRepayment', 'revokePaid'] },
      { key: 'orders.receivable.today', label: '今日待收', actions: ['view'] },
      { key: 'orders.receivable.tomorrow', label: '明日待收', actions: ['view'] },
    ],
  },
  {
    key: 'users',
    label: '用户管理',
    actions: ['view'],
    children: [
      { key: 'users.registered', label: '注册用户', actions: ['view', 'create', 'update', 'setQuota', 'remark', 'blacklist', 'riskCheck', 'resetPassword', 'delete', 'export'] },
      { key: 'users.noOrder', label: '未下单用户', actions: ['view', 'update', 'setQuota', 'remark', 'blacklist', 'riskCheck', 'resetPassword', 'delete'] },
      { key: 'users.ordering', label: '下单用户', actions: ['view', 'update', 'setQuota', 'remark', 'blacklist', 'riskCheck', 'resetPassword', 'delete'] },
    ],
  },
  {
    key: 'products',
    label: '产品管理',
    actions: ['view'],
    children: [
      { key: 'products.installment', label: '先享后付产品', actions: ['view', 'create', 'update', 'toggleOnSale', 'uploadImage', 'delete'] },
      { key: 'products.mall', label: '商城产品', actions: ['view', 'create', 'update', 'toggleOnSale', 'uploadImage', 'delete'] },
    ],
  },
  { key: 'accounts', label: '账号管理', actions: ['view', 'create', 'update', 'toggleStatus', 'changeRole', 'resetPassword', 'delete', 'permission'] },
  { key: 'traffic', label: '流量管理', actions: ['view', 'create', 'update', 'toggleStatus', 'remark', 'editChannel', 'bindPortalAccount', 'delete'] },
  { key: 'dashboard', label: '财务报表', actions: ['view'] },
  {
    key: 'tenants',
    label: '子系统管理',
    actions: ['view'],
    children: [
      { key: 'tenants.system', label: '系统与账号', actions: ['view', 'create', 'update', 'delete', 'purgeTenantData', 'switchTenant'] },
      { key: 'tenants.mallUsersData', label: '子系统数据', actions: ['view'] },
    ],
  },
]

const ADMIN_PERMISSION_ACTIONS = Object.keys(ADMIN_PERMISSION_ACTION_LABELS)

function flattenPermissionKeys(nodes = ADMIN_PERMISSION_TREE) {
  const keys = []
  nodes.forEach((node) => {
    keys.push(node.key)
    if (Array.isArray(node.children)) {
      keys.push(...flattenPermissionKeys(node.children))
    }
  })
  return keys
}

const ADMIN_PERMISSION_KEY_SET = new Set(flattenPermissionKeys())

function flattenPermissionNodes(nodes = ADMIN_PERMISSION_TREE) {
  const out = []
  nodes.forEach((node) => {
    out.push(node)
    if (Array.isArray(node.children)) {
      out.push(...flattenPermissionNodes(node.children))
    }
  })
  return out
}

const ADMIN_PERMISSION_NODE_MAP = new Map(flattenPermissionNodes().map(node => [node.key, node]))

function allowedActionsForPermissionKey(key) {
  const node = ADMIN_PERMISSION_NODE_MAP.get(key)
  const actions = Array.isArray(node?.actions) && node.actions.length ? node.actions : ['view']
  return actions.filter(action => ADMIN_PERMISSION_ACTION_LABELS[action])
}

function uniqueValidKeys(values, validSet) {
  const out = []
  if (!Array.isArray(values)) {
    return out
  }
  values.forEach((raw) => {
    const value = String(raw || '').trim()
    if (value && validSet.has(value) && !out.includes(value)) {
      out.push(value)
    }
  })
  return out
}

function normalizeAdminPermissions(input) {
  const raw = input && typeof input === 'object' ? input : {}
  const menus = uniqueValidKeys(raw.menus, ADMIN_PERMISSION_KEY_SET)
  const menuSet = new Set(menus)
  const actions = {}
  const rawActions = raw.actions && typeof raw.actions === 'object' ? raw.actions : {}
  Object.entries(rawActions).forEach(([rawKey, rawList]) => {
    const key = String(rawKey || '').trim()
    if (!ADMIN_PERMISSION_KEY_SET.has(key)) {
      return
    }
    const list = uniqueValidKeys(rawList, new Set(allowedActionsForPermissionKey(key)))
    if (list.length) {
      actions[key] = list
      if (!menuSet.has(key)) {
        menus.push(key)
        menuSet.add(key)
      }
    }
  })
  return { menus, actions }
}

function permissionsFromMenuActions(menuKeys, actionsByMenu) {
  return normalizeAdminPermissions({
    menus: menuKeys,
    actions: actionsByMenu,
  })
}

function allPermissionKeys() {
  return flattenPermissionKeys()
}

function fullAdminPermissions(options = {}) {
  const menus = allPermissionKeys().filter((key) => {
    if (options.excludeTenants && (key === 'tenants' || key.startsWith('tenants.'))) {
      return false
    }
    return true
  })
  const actions = {}
  menus.forEach((key) => {
    actions[key] = allowedActionsForPermissionKey(key)
  })
  return { menus, actions }
}

function defaultAdminPermissionsForRole(role) {
  if (role === 'super_admin') {
    return fullAdminPermissions()
  }
  if (role === 'boss') {
    return fullAdminPermissions({ excludeTenants: true })
  }
  if (role === 'collector') {
    return permissionsFromMenuActions(
      ['orders', 'orders.approved', 'orders.cardData', 'orders.receivable.today', 'orders.receivable.tomorrow'],
      {
        orders: ['view'],
        'orders.approved': ['view'],
        'orders.cardData': ['view'],
        'orders.receivable.today': ['view'],
        'orders.receivable.tomorrow': ['view'],
      },
    )
  }
  return permissionsFromMenuActions(
    ['cs', 'cs.messages', 'orders', 'orders.review', 'orders.approved', 'orders.cardData', 'users', 'users.registered'],
    {
      cs: ['view'],
      'cs.messages': ['view', 'reply'],
      orders: ['view'],
      'orders.review': ['view', 'review'],
      'orders.approved': ['view'],
      'orders.cardData': ['view'],
      users: ['view'],
      'users.registered': ['view'],
    },
  )
}

function effectiveAdminPermissions(role, stored) {
  if (!stored || typeof stored !== 'object') {
    return defaultAdminPermissionsForRole(role)
  }
  return normalizeAdminPermissions(stored)
}

function resetAdminPermissionsForRole(role) {
  return defaultAdminPermissionsForRole(role)
}

function hasAdminPermissionOnAny(accountOrRole, permissionKeys, action = 'view') {
  const keys = Array.isArray(permissionKeys) ? permissionKeys : [permissionKeys]
  return keys.some((key) => hasAdminPermission(accountOrRole, key, action))
}

const ADMIN_USERS_PAGE_PERMISSION_KEYS = ['users.registered', 'users.noOrder', 'users.ordering']

function normalizeAdminUsersListView(raw) {
  const view = String(raw || '').trim()
  if (view === 'ordering') {
    return 'ordering'
  }
  if (view === 'no-order') {
    return 'no-order'
  }
  return 'registered'
}

function adminUsersPermissionKeyForView(view) {
  const normalized = normalizeAdminUsersListView(view)
  if (normalized === 'ordering') {
    return 'users.ordering'
  }
  if (normalized === 'no-order') {
    return 'users.noOrder'
  }
  return 'users.registered'
}

function hasAdminUsersListViewPermission(accountOrRole, view) {
  return hasAdminPermission(accountOrRole, adminUsersPermissionKeyForView(view), 'view')
}

function hasAdminUsersPermissionOnAny(accountOrRole, action = 'view') {
  return hasAdminPermissionOnAny(accountOrRole, ADMIN_USERS_PAGE_PERMISSION_KEYS, action)
}

function hasAdminMarkPaidPermission(accountOrRole) {
  return hasAdminPermission(accountOrRole, 'orders.cardData', 'markPaid')
}

/** 登记快递单号：必须具备对应的「填写单号」按钮权限 */
function hasAdminShipmentTrackingPermission(accountOrRole) {
  return hasAdminPermission(accountOrRole, 'orders.approved', 'fillTracking')
    || hasAdminPermission(accountOrRole, 'orders.cardData', 'fillTracking')
}

function hasAdminOrderDeletePermission(accountOrRole, orderStatus) {
  const status = String(orderStatus || '').trim()
  const key = status === 'reviewing' ? 'orders.review' : 'orders.approved'
  return hasAdminPermission(accountOrRole, key, 'delete')
}

function hasAdminPermission(accountOrRole, permissionKey, action = 'view') {
  const role = typeof accountOrRole === 'string' ? accountOrRole : accountOrRole?.role
  if (role === 'super_admin') {
    return true
  }
  const key = String(permissionKey || '').trim()
  const act = String(action || 'view').trim() || 'view'
  if (!ADMIN_PERMISSION_KEY_SET.has(key)) {
    return false
  }
  const permissions = effectiveAdminPermissions(role, accountOrRole?.permissions)
  if (!permissions.menus.includes(key)) {
    return false
  }
  const allowed = permissions.actions?.[key]
  return Array.isArray(allowed) && allowed.includes(act)
}

function hasAdminPermissionCompat(accountOrRole, permissionKey, action = 'view', legacyAction = '') {
  if (hasAdminPermission(accountOrRole, permissionKey, action)) {
    return true
  }
  const legacy = String(legacyAction || '').trim()
  return Boolean(legacy && hasAdminPermission(accountOrRole, permissionKey, legacy))
}

function adminOrderPermissionKeyForListScope(scope) {
  const value = String(scope || '').trim()
  if (value === 'pending') {
    return 'orders.review'
  }
  if (value === 'card-data') {
    return 'orders.cardData'
  }
  return 'orders.approved'
}

function adminProductPermissionKeyForSalesMode(salesMode) {
  return String(salesMode || '').trim() === 'installment'
    ? 'products.installment'
    : 'products.mall'
}

function adminReceivablePermissionKeyForDueDate(dueDate, todayKey) {
  const due = String(dueDate || '').trim()
  const today = String(todayKey || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    return 'orders.receivable.today'
  }
  const dt = new Date(`${today}T12:00:00`)
  dt.setDate(dt.getDate() + 1)
  const tomorrow = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
  return due === tomorrow ? 'orders.receivable.tomorrow' : 'orders.receivable.today'
}

function canGrantAdminPermissions(operatorAccount, requestedPermissions) {
  const role = operatorAccount?.role
  if (!canManageRolePermissions(role)) {
    return false
  }
  if (role === 'super_admin') {
    return true
  }
  const requested = normalizeAdminPermissions(requestedPermissions)
  return requested.menus.every((key) => {
    if (!hasAdminPermission(operatorAccount, key, 'view')) {
      return false
    }
    const actions = requested.actions?.[key] || []
    return actions.every(action => hasAdminPermission(operatorAccount, key, action))
  })
}

function canManageRolePermissions(role) {
  return role === 'super_admin' || role === 'boss'
}

module.exports = {
  ADMIN_PERMISSION_ACTIONS,
  ADMIN_PERMISSION_ACTION_LABELS,
  ADMIN_PERMISSION_TREE,
  normalizeAdminPermissions,
  defaultAdminPermissionsForRole,
  effectiveAdminPermissions,
  resetAdminPermissionsForRole,
  hasAdminPermission,
  hasAdminPermissionCompat,
  hasAdminPermissionOnAny,
  adminOrderPermissionKeyForListScope,
  adminProductPermissionKeyForSalesMode,
  adminReceivablePermissionKeyForDueDate,
  normalizeAdminUsersListView,
  adminUsersPermissionKeyForView,
  hasAdminUsersListViewPermission,
  hasAdminUsersPermissionOnAny,
  hasAdminMarkPaidPermission,
  hasAdminShipmentTrackingPermission,
  hasAdminOrderDeletePermission,
  canGrantAdminPermissions,
  canManageRolePermissions,
}
