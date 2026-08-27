const ADMIN_LOGIN_PUBLIC_REQUESTS = new Set([
  'POST /api/admin/login',
  'POST /api/admin/login/verify',
  'POST /api/login',
  'POST /api/login/verify',
])

const ALL_BUSINESS_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])

function normalizeRequest(method, pathValue) {
  const rawMethod = String(method || 'GET').trim().toUpperCase()
  const normalizedMethod = rawMethod === 'HEAD' ? 'GET' : rawMethod
  const normalizedPath = String(pathValue || '').split('?')[0].replace(/\/+$/, '') || '/'
  return { method: normalizedMethod, path: normalizedPath }
}

function isAdminLoginPublicRequest(method, pathValue) {
  const request = normalizeRequest(method, pathValue)
  return ADMIN_LOGIN_PUBLIC_REQUESTS.has(`${request.method} ${request.path}`)
}

function isAdminOptionalSessionRequest(method, pathValue) {
  const request = normalizeRequest(method, pathValue)
  return request.method === 'GET'
    && (request.path === '/api/products' || /^\/api\/products\/[^/]+$/.test(request.path))
}

function isPublicBusinessRequest(method, pathValue) {
  const request = normalizeRequest(method, pathValue)
  const { method: requestMethod, path } = request
  if (requestMethod === 'GET' && (path === '/api/health' || path === '/api/geocode/reverse')) return true
  if (requestMethod === 'GET' && path.startsWith('/api/static/')) return true
  if (isAdminOptionalSessionRequest(requestMethod, path)) return true
  if (requestMethod === 'POST' && /^\/api\/auth\/(?:register\/sms\/send|login\/sms\/send|register|login)$/.test(path)) return true
  if (requestMethod === 'GET' && path === '/api/users/by-phone') return true
  if (requestMethod === 'POST' && path === '/api/orders') return true
  if (ALL_BUSINESS_METHODS.has(requestMethod)
    && /^\/api\/(?:mall|my|card-packages|addresses|bank-cards|bills|payment\/lakala|ios)(?:\/|$)/.test(path)) return true
  if (requestMethod === 'POST'
    && /^\/api\/(?:bill-risk\/callback|uploads\/id-card|traffic\/channel-click)$/.test(path)) return true
  if ((requestMethod === 'GET' || requestMethod === 'POST')
    && /^\/api\/traffic-partner(?:\/|$)/.test(path)) return true
  if (requestMethod === 'POST' && /^\/api\/open\/partners\//.test(path)) return true
  return requestMethod === 'POST' && /^\/api\/market\/halfFlow\/[^/]+\/open\//.test(path)
}

function isAdminProtectedRequest(method, pathValue) {
  const request = normalizeRequest(method, pathValue)
  if (!request.path.startsWith('/api/')) return false
  return !isAdminLoginPublicRequest(request.method, request.path)
    && !isPublicBusinessRequest(request.method, request.path)
}

module.exports = {
  isAdminLoginPublicRequest,
  isAdminOptionalSessionRequest,
  isAdminProtectedRequest,
  isPublicBusinessRequest,
}
