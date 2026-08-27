const ADMIN_LOGIN_PUBLIC_REQUESTS = new Set([
  'POST /api/admin/login',
  'POST /api/admin/login/verify',
  'POST /api/login',
  'POST /api/login/verify',
])

function normalizeRequest(method, pathValue) {
  const normalizedMethod = String(method || 'GET').trim().toUpperCase()
  const normalizedPath = String(pathValue || '').split('?')[0].replace(/\/+$/, '') || '/'
  return { method: normalizedMethod, path: normalizedPath }
}

function isAdminLoginPublicRequest(method, pathValue) {
  const request = normalizeRequest(method, pathValue)
  return ADMIN_LOGIN_PUBLIC_REQUESTS.has(`${request.method} ${request.path}`)
}

function isAdminProtectedRequest(method, pathValue) {
  const request = normalizeRequest(method, pathValue)
  if (isAdminLoginPublicRequest(request.method, request.path)) return false
  if (!request.path.startsWith('/api/')) return false
  if (request.path === '/api/admin' || request.path.startsWith('/api/admin/')) return true
  if (request.path === '/api/platform' || request.path.startsWith('/api/platform/')) return true
  if (request.path === '/api/users/by-phone' && request.method === 'GET') return false
  if (request.path === '/api/users' || request.path.startsWith('/api/users/')) return true
  if (request.path === '/api/orders' && request.method === 'POST') return false
  if (request.path === '/api/orders' || request.path.startsWith('/api/orders/')) return true
  if (request.path === '/api/products' || request.path.startsWith('/api/products/')) {
    return request.method !== 'GET'
  }
  return request.path === '/api/uploads/public-image'
    || request.path.startsWith('/api/uploads/public-image/')
}

module.exports = {
  isAdminLoginPublicRequest,
  isAdminProtectedRequest,
}
