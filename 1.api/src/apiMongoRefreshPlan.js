const { SHARDED_ENTITY_KEYS: ALL_ENTITY_KEYS } = require('./mongo')

function plan(mode, keys, requiresFresh) {
  return { mode, keys: [...keys], requiresFresh, ...(mode === 'partial' ? { allowColdPartial: true } : {}) }
}

function resolveCoreApiMongoRefreshPlan({ method = 'GET', path = '', query = {}, optimizeEnabled = false, safeOrderFilter = null } = {}) {
  method = String(method).trim().toUpperCase()
  // Match Router defaults using a local copy; never rewrite request paths or parameter values.
  path = String(path).toLowerCase().replace(/\/$/, '')
  if (method === 'GET' && ['/api/health', '/api/payment/lakala/config'].includes(path)) return plan('skip', [], false)

  const paymentKeys = ['users', 'orders', 'lakalaPayments']
  if (method === 'GET' && path === '/api/admin/orders/repayment-records') {
    return plan('partial', ['lakalaPayments', 'users', 'orders', 'trafficChannels'], false)
  }
  if (method === 'POST' && path === '/api/payment/lakala/preorder') {
    return plan('partial', ['products', ...paymentKeys], true)
  }
  if ((method === 'POST' && (
    path === '/api/payment/lakala/notify'
    || path === '/api/payment/lakala/sync-pending'
    || /^\/api\/payment\/lakala\/mock-complete\/[^/]+$/.test(path)
  )) || (method === 'GET' && /^\/api\/payment\/lakala\/status\/[^/]+$/.test(path))) {
    return plan('partial', paymentKeys, true)
  }

  const orderReadKeys = ['orders', 'users', 'trafficChannels']
  // These GET handlers persist state, so neither direct-read skips nor stale reads apply.
  if (method === 'GET') {
    if (path.startsWith('/api/platform/')) return plan('full', ALL_ENTITY_KEYS, true)
    if (/^\/api\/admin\/cs\/sessions\/[^/]+$/.test(path)
      && !['0', 'false', 'no'].includes(String(query.read || '1').toLowerCase())) {
      return plan('partial', ['csSessions', 'users'], true)
    }
    if (/^\/api\/card-packages\/[^/]+\/contract-(view|flow)$/.test(path)) {
      return plan('partial', ['users', 'orders'], true)
    }
    if (path === '/api/mall/cs/session') return plan('partial', ['users', 'csSessions'], true)
    if (path === '/api/orders' && String(query.listScope || '').trim() === 'card-data') {
      return plan('partial', orderReadKeys, true)
    }
  }
  if (method !== 'GET') return plan('full', ALL_ENTITY_KEYS, true)
  if (!optimizeEnabled) return plan('full', ALL_ENTITY_KEYS, false)

  const paginated = query.page != null && String(query.page).trim() !== ''
  if (['/api/admin/accounts', '/api/admin/orders/sidebar-counts', '/api/products'].includes(path)) {
    return plan('skip', [], false)
  }
  if (path === '/api/orders' && paginated && safeOrderFilter) return plan('skip', [], false)

  const trafficOverviewKeys = ['adminAccounts', 'trafficChannels', 'trafficPartners', 'users', 'orders']
  const trafficListKeys = ['adminAccounts', 'trafficChannels', 'trafficPartners', 'users']
  const csSessionsWithUsersKeys = ['csSessions', 'users']
  const mallOrdersUsersKeys = ['users', 'orders']
  const byPath = {
    '/api/admin/dashboard/kpis': ['orders'],
    '/api/admin/cs/badge': ['csSessions'],
    '/api/admin/cs/unread-sum': ['csSessions'],
    '/api/admin/traffic-channels/overview': trafficOverviewKeys,
    '/api/admin/traffic-channels/portal-stats': trafficOverviewKeys,
    '/api/admin/traffic-channels/quality': trafficOverviewKeys,
    '/api/admin/traffic-channels/daily-disbursement': trafficOverviewKeys,
    '/api/traffic-partner/stats': trafficOverviewKeys,
    '/api/admin/traffic-channels': trafficListKeys,
    '/api/admin/cs/sessions': csSessionsWithUsersKeys,
    '/api/my/summary': ['users', 'orders', 'bankCards'],
    '/api/my/orders': ['users', 'orders', 'trafficChannels'],
    '/api/orders': orderReadKeys,
    '/api/mall/me/bill-risk': ['users'],
    '/api/mall/contacts/status': mallOrdersUsersKeys,
    '/api/mall/contacts/upload/start': mallOrdersUsersKeys,
    '/api/mall/contacts/upload/complete': mallOrdersUsersKeys,
    '/api/mall/contract-pending': mallOrdersUsersKeys,
    '/api/card-packages': mallOrdersUsersKeys,
    '/api/bills': mallOrdersUsersKeys,
    '/api/addresses': ['addresses'],
    '/api/bank-cards': ['bankCards'],
  }
  if (Object.hasOwn(byPath, path)) return plan('partial', byPath[path], false)
  if (/^\/api\/products\/[^/]+$/.test(path)) return plan('partial', ['products'], false)
  if (/^\/api\/admin\/cs\/sessions\/[^/]+$/.test(path)) return plan('partial', csSessionsWithUsersKeys, false)
  if (path === '/api/mall/contacts/upload/batch') return plan('skip', [], false)
  if (/^\/api\/orders\/[^/]+$/.test(path)) return plan('partial', ['adminAccounts', 'orders', 'users', 'trafficChannels'], false)
  if (/^\/api\/users\/[^/]+$/.test(path)) return plan('partial', ['adminAccounts', 'users', 'orders', 'trafficChannels'], false)
  if (path === '/api/users' && paginated) return plan('partial', ['orders', 'users', 'trafficChannels'], false)
  return plan('full', ALL_ENTITY_KEYS, false)
}

module.exports = { resolveCoreApiMongoRefreshPlan }
