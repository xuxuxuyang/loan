const ROUTE_EXPECTATIONS = Object.freeze([
  {
    name: 'admin login endpoints',
    category: 'admin-login-public',
    methods: ['POST'],
    routePattern: /^\/api\/(?:admin\/login(?:\/verify)?|login(?:\/verify)?)$/,
  },
  {
    name: 'health and reverse geocode',
    category: 'business-public',
    methods: ['GET'],
    routePattern: /^\/api\/(?:health|geocode\/reverse)$/,
  },
  {
    name: 'product reads',
    category: 'business-public',
    methods: ['GET'],
    routePattern: /^\/api\/products(?:\/:id)?$/,
  },
  {
    name: 'shopper authentication',
    category: 'business-public',
    methods: ['POST'],
    routePattern: /^\/api\/auth\/(?:register\/sms\/send|login\/sms\/send|register|login)$/,
  },
  {
    name: 'shopper phone lookup',
    category: 'business-public',
    methods: ['GET'],
    routePattern: /^\/api\/users\/by-phone$/,
  },
  {
    name: 'shopper order submission',
    category: 'business-public',
    methods: ['POST'],
    routePattern: /^\/api\/orders$/,
  },
  {
    name: 'mall profile and risk writes',
    category: 'business-public',
    methods: ['POST'],
    routePattern: /^\/api\/mall\/(?:me\/emergency-contacts|installment-risk\/wave(?:\/:waveId\/step\/:stepKey)?)$/,
  },
  {
    name: 'mall profile and contact reads',
    category: 'business-public',
    methods: ['GET'],
    routePattern: /^\/api\/mall\/(?:me\/bill-risk|contacts\/status|contract-pending|cs\/session)$/,
  },
  {
    name: 'mall contact upload writes',
    category: 'business-public',
    methods: ['POST'],
    routePattern: /^\/api\/mall\/contacts\/upload\/(?:start|batch|complete)$/,
  },
  {
    name: 'mall customer service writes',
    category: 'business-public',
    methods: ['POST'],
    routePattern: /^\/api\/mall\/cs\/(?:session\/open|messages(?:\/image)?)$/,
  },
  {
    name: 'shopper account reads',
    category: 'business-public',
    methods: ['GET'],
    routePattern: /^\/api\/my\/(?:summary|orders)$/,
  },
  {
    name: 'card package reads',
    category: 'business-public',
    methods: ['GET'],
    routePattern: /^\/api\/card-packages(?:\/:orderId\/(?:contract-view|contract-flow))?$/,
  },
  {
    name: 'card package writes',
    category: 'business-public',
    methods: ['POST'],
    routePattern: /^\/api\/card-packages\/:orderId\/(?:contract-ack|contract-sign-reset)$/,
  },
  {
    name: 'address reads and creation',
    category: 'business-public',
    methods: ['GET', 'POST'],
    routePattern: /^\/api\/addresses$/,
  },
  {
    name: 'address updates',
    category: 'business-public',
    methods: ['PATCH'],
    routePattern: /^\/api\/addresses\/:id(?:\/default)?$/,
  },
  {
    name: 'bank card reads and creation',
    category: 'business-public',
    methods: ['GET', 'POST'],
    routePattern: /^\/api\/bank-cards$/,
  },
  {
    name: 'bank card deletion',
    category: 'business-public',
    methods: ['DELETE'],
    routePattern: /^\/api\/bank-cards\/:id$/,
  },
  {
    name: 'bill reads',
    category: 'business-public',
    methods: ['GET'],
    routePattern: /^\/api\/bills$/,
  },
  {
    name: 'bill repayment writes',
    category: 'business-public',
    methods: ['POST'],
    routePattern: /^\/api\/bills\/(?:repay|repay-negotiated)$/,
  },
  {
    name: 'Lakala payment writes',
    category: 'business-public',
    methods: ['POST'],
    routePattern: /^\/api\/payment\/lakala\/(?:preorder|sync-pending|mock-complete\/:outTradeNo|notify)$/,
  },
  {
    name: 'Lakala payment reads',
    category: 'business-public',
    methods: ['GET'],
    routePattern: /^\/api\/payment\/lakala\/(?:status\/:outTradeNo|config)$/,
  },
  {
    name: 'iOS registration and account writes',
    category: 'business-public',
    methods: ['POST'],
    routePattern: /^\/api\/ios\/(?:auth\/register(?:\/sms\/send)?|uploads\/id-card|installment-risk\/wave(?:\/:waveId\/step\/:stepKey)?|installment\/orders|orders\/:orderId\/contacts\/upload\/(?:start|batch|complete)|account\/delete)$/,
  },
  {
    name: 'iOS profile write',
    category: 'business-public',
    methods: ['PUT'],
    routePattern: /^\/api\/ios\/installment\/profile$/,
  },
  {
    name: 'iOS account reads',
    category: 'business-public',
    methods: ['GET'],
    routePattern: /^\/api\/ios\/(?:installment\/profile|account\/deletion-eligibility)$/,
  },
  {
    name: 'storefront callbacks and uploads',
    category: 'business-public',
    methods: ['POST'],
    routePattern: /^\/api\/(?:bill-risk\/callback|uploads\/id-card|traffic\/channel-click)$/,
  },
  {
    name: 'traffic partner endpoints',
    category: 'business-public',
    methods: ['GET', 'POST'],
    routePattern: /^\/api\/traffic-partner\/(?:login|stats)$/,
  },
  {
    name: 'open partner endpoints',
    category: 'business-public',
    methods: ['POST'],
    routePattern: /^\/api\/open\/partners\/[^/]+\/(?:admission|contracts|credit\/(?:apply|query)|app\/link|login\/consume|apply)$/,
  },
  {
    name: 'half-flow partner endpoints',
    category: 'business-public',
    methods: ['POST'],
    routePattern: /^\/api\/market\/halfFlow\/[^/]+\/open\/(?:checkPrefix|checkPrefIx|contractQuery|apply|login\/consume|getUrl|order\/(?:status|bindCard|replayPlan|replay|sign)\/notify)$/,
  },
  {
    name: 'product administration',
    category: 'admin-protected',
    methods: ['POST', 'PATCH', 'DELETE'],
    routePattern: /^\/api\/products(?:\/:id)?$/,
  },
  {
    name: 'admin namespace',
    category: 'admin-protected',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    routePattern: /^\/api\/admin\/(?!login(?:\/verify)?$).+/,
  },
  {
    name: 'platform namespace',
    category: 'admin-protected',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    routePattern: /^\/api\/platform(?:\/|$)/,
  },
  {
    name: 'user administration',
    category: 'admin-protected',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    routePattern: /^\/api\/users(?:$|\/(?!by-phone$).+)/,
  },
  {
    name: 'order administration reads and mutations',
    category: 'admin-protected',
    methods: ['GET', 'PUT', 'PATCH', 'DELETE'],
    routePattern: /^\/api\/orders(?:\/|$)/,
  },
  {
    name: 'non-submission order posts',
    category: 'admin-protected',
    methods: ['POST'],
    routePattern: /^\/api\/orders\//,
  },
  {
    name: 'admin public-image upload',
    category: 'admin-protected',
    methods: ['POST'],
    routePattern: /^\/api\/uploads\/public-image$/,
  },
])

const INDEPENDENT_PUBLIC_EXPECTATIONS = Object.freeze([
  {
    name: 'non-api half-flow partner endpoints',
    methods: ['POST'],
    routePattern: /^\/market\/halfFlow\/[^/]+\/open\//,
  },
  {
    name: 'risk health endpoint',
    methods: ['GET'],
    routePattern: /^\/risk-api\/health$/,
  },
  {
    name: 'risk API endpoints',
    methods: ['POST'],
    routePattern: /^\/risk-api\/v1\//,
  },
])

function samplePath(routePath) {
  return String(routePath).replace(/:([A-Za-z0-9_]+)/g, 'sample-$1')
}

function matchesExpectation(expectation, method, routePath) {
  return expectation.methods.includes(String(method).toUpperCase())
    && expectation.routePattern.test(String(routePath))
}

function routeRequests(router, expectations = ROUTE_EXPECTATIONS) {
  const requests = []
  for (const layer of router.stack) {
    for (const method of layer.methods || []) {
      if (method === 'HEAD') continue
      const matches = expectations.filter(expectation => matchesExpectation(expectation, method, layer.path))
      requests.push({
        method,
        path: samplePath(layer.path),
        routePath: layer.path,
        matches,
      })
    }
  }
  return requests
}

function isExpectedPublicBusinessPath(routePath) {
  return ROUTE_EXPECTATIONS.some(expectation => expectation.category === 'business-public'
    && expectation.routePattern.test(String(routePath)))
}

module.exports = {
  INDEPENDENT_PUBLIC_EXPECTATIONS,
  ROUTE_EXPECTATIONS,
  isExpectedPublicBusinessPath,
  routeRequests,
  samplePath,
}
