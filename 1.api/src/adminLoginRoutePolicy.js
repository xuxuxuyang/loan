const ADMIN_LOGIN_PUBLIC_REQUESTS = new Set([
  'POST /api/admin/login',
  'POST /api/admin/login/verify',
  'POST /api/login',
  'POST /api/login/verify',
])

const PUBLIC_MOUNTED_ROUTE_RULES = Object.freeze([
  Object.freeze({
    methods: Object.freeze(['GET', 'HEAD']),
    path: Object.freeze(/^\/(?:api\/)?static\//),
  }),
])

const PUBLIC_BUSINESS_REQUEST_RULES = Object.freeze([
  { methods: ['GET'], path: /^\/api\/(?:health|geocode\/reverse)$/ },
  { methods: ['GET'], path: /^\/api\/products(?:\/[^/]+)?$/ },
  { methods: ['POST'], path: /^\/api\/auth\/(?:register\/sms\/send|login\/sms\/send|register|login)$/ },
  { methods: ['GET'], path: /^\/api\/users\/by-phone$/ },
  { methods: ['POST'], path: /^\/api\/orders$/ },
  { methods: ['POST'], path: /^\/api\/mall\/(?:me\/emergency-contacts|installment-risk\/wave(?:\/[^/]+\/step\/[^/]+)?)$/ },
  { methods: ['GET'], path: /^\/api\/mall\/(?:me\/bill-risk|contacts\/status|contract-pending|cs\/session)$/ },
  { methods: ['POST'], path: /^\/api\/mall\/contacts\/upload\/(?:start|batch|complete)$/ },
  { methods: ['POST'], path: /^\/api\/mall\/cs\/(?:session\/open|messages(?:\/image)?)$/ },
  { methods: ['GET'], path: /^\/api\/my\/(?:summary|orders)$/ },
  { methods: ['GET'], path: /^\/api\/card-packages(?:\/[^/]+\/(?:contract-view|contract-flow))?$/ },
  { methods: ['POST'], path: /^\/api\/card-packages\/[^/]+\/(?:contract-ack|contract-sign-reset)$/ },
  { methods: ['GET', 'POST'], path: /^\/api\/addresses$/ },
  { methods: ['PATCH'], path: /^\/api\/addresses\/[^/]+(?:\/default)?$/ },
  { methods: ['GET', 'POST'], path: /^\/api\/bank-cards$/ },
  { methods: ['DELETE'], path: /^\/api\/bank-cards\/[^/]+$/ },
  { methods: ['GET'], path: /^\/api\/bills$/ },
  { methods: ['POST'], path: /^\/api\/bills\/(?:repay|repay-negotiated)$/ },
  { methods: ['POST'], path: /^\/api\/payment\/lakala\/(?:preorder|sync-pending|mock-complete\/[^/]+|notify)$/ },
  { methods: ['GET'], path: /^\/api\/payment\/lakala\/(?:status\/[^/]+|config)$/ },
  { methods: ['POST'], path: /^\/api\/ios\/(?:auth\/register(?:\/sms\/send)?|uploads\/id-card|installment-risk\/wave(?:\/[^/]+\/step\/[^/]+)?|installment\/orders|orders\/[^/]+\/contacts\/upload\/(?:start|batch|complete)|account\/delete)$/ },
  { methods: ['PUT'], path: /^\/api\/ios\/installment\/profile$/ },
  { methods: ['GET'], path: /^\/api\/ios\/(?:installment\/profile|account\/deletion-eligibility)$/ },
  { methods: ['POST'], path: /^\/api\/(?:bill-risk\/callback|uploads\/id-card|traffic\/channel-click)$/ },
  { methods: ['POST'], path: /^\/api\/traffic-partner\/login$/ },
  { methods: ['GET'], path: /^\/api\/traffic-partner\/stats$/ },
  { methods: ['POST'], path: /^\/api\/open\/partners\/[^/]+\/(?:admission|contracts|credit\/(?:apply|query)|app\/link|login\/consume|apply|checkPrefix|checkPrefIx|contractQuery|getUrl|order\/(?:status|bindCard|replayPlan|replay|sign)\/notify)$/ },
  { methods: ['POST'], path: /^\/api\/market\/halfFlow\/[^/]+\/open\/(?:checkPrefix|checkPrefIx|contractQuery|apply|login\/consume|getUrl|order\/(?:status|bindCard|replayPlan|replay|sign)\/notify)$/ },
])

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

function isPublicMountedRequest(method, pathValue) {
  const request = normalizeRequest(method, pathValue)
  return PUBLIC_MOUNTED_ROUTE_RULES.some(rule => rule.path.test(request.path)
    && (request.method === 'OPTIONS' || rule.methods.includes(request.method)))
}

function isPublicBusinessRequest(method, pathValue) {
  const request = normalizeRequest(method, pathValue)
  const { method: requestMethod, path } = request
  if (isPublicMountedRequest(requestMethod, path)) return true
  if (requestMethod === 'OPTIONS') {
    return PUBLIC_BUSINESS_REQUEST_RULES.some(rule => rule.path.test(path))
  }
  return PUBLIC_BUSINESS_REQUEST_RULES.some(rule => rule.methods.includes(requestMethod) && rule.path.test(path))
}

function isAdminProtectedRequest(method, pathValue) {
  const request = normalizeRequest(method, pathValue)
  if (!request.path.startsWith('/api/')) return false
  return !isAdminLoginPublicRequest(request.method, request.path)
    && !isPublicBusinessRequest(request.method, request.path)
}

module.exports = {
  PUBLIC_MOUNTED_ROUTE_RULES,
  isAdminLoginPublicRequest,
  isAdminOptionalSessionRequest,
  isAdminProtectedRequest,
  isPublicBusinessRequest,
  isPublicMountedRequest,
}
