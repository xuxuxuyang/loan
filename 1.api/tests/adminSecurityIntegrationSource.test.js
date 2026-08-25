const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const api = fs.readFileSync(path.join(__dirname, '../src/index.js'), 'utf8')
const permissions = fs.readFileSync(path.join(__dirname, '../src/adminPermissions.js'), 'utf8')
const securityStore = fs.readFileSync(path.join(__dirname, '../src/adminSecurityStore.js'), 'utf8')
const securityService = fs.readFileSync(path.join(__dirname, '../src/adminSecurityService.js'), 'utf8')
const envExample = fs.readFileSync(path.join(__dirname, '../.env.example'), 'utf8')

function routeSource(routeStart) {
  const start = api.indexOf(routeStart)
  const nextRoute = api.indexOf('\nrouter.', start + routeStart.length)
  assert.ok(start >= 0, `${routeStart} should exist`)
  return api.slice(start, nextRoute === -1 ? api.length : nextRoute)
}

test('admin security routes expose status, challenge verification and readonly audit logs', () => {
  assert.match(api, /router\.get\('\/admin\/security\/status'/)
  assert.match(api, /router\.post\('\/admin\/security\/challenges'/)
  assert.match(api, /router\.post\('\/admin\/security\/challenges\/:id\/verify'/)
  assert.match(api, /router\.get\('\/admin\/security\/audit-logs'/)
  assert.match(api, /router\.get\('\/admin\/security\/audit-logs\/:id'/)
  assert.doesNotMatch(api, /admin\/security\/audit-logs[^\n]*rollback/)
})

test('every planned sensitive API action enters the shared security guard', () => {
  const calls = api.match(/beginAdminSensitiveOperation\(ctx,/g) || []
  assert.equal(calls.length, 8)
  assert.match(api, /ACTION_CODES\.REPAYMENT_MARK_PAID/)
  assert.match(api, /ACTION_CODES\.REPAYMENT_CHANGE_DUE_DATE/)
  assert.match(api, /ACTION_CODES\.REPAYMENT_NEGOTIATE/)
  assert.match(api, /ACTION_CODES\.REPAYMENT_SETTLE_AMOUNT/)
  assert.match(api, /ACTION_CODES\.REPAYMENT_NEGOTIATION_PAID/)
  assert.match(api, /ACTION_CODES\.USER_DELETE/)
  assert.match(api, /ACTION_CODES\.ORDER_DELETE/)
  assert.match(api, /ACTION_CODES\.USER_EXPORT/)
})

test('all repayment routes re-find and revalidate live state after security authorization', () => {
  const routeStarts = [
    "router.patch('/orders/:id/installments/:period/pay'",
    "router.patch('/orders/:id/installments/:period/due-date'",
    "router.patch('/orders/:id/installments/:period/settle-amount'",
    "router.patch('/orders/:id/installments/:period/negotiate'",
    "router.patch('/orders/:id/installments/:period/negotiation/history/:historyIndex/paid'",
  ]

  routeStarts.forEach((routeStart) => {
    const source = routeSource(routeStart)
    const authorization = source.indexOf('beginAdminSensitiveOperation(ctx,')
    const liveDbRead = source.indexOf('db = readDb()', authorization)
    const revalidation = source.indexOf('revalidateAdminRepaymentOperation(')
    const liveNormalization = source.indexOf('ensureOrderInstallmentPlan(target)')

    assert.ok(authorization >= 0, `${routeStart} should authorize the action`)
    assert.ok(liveDbRead > authorization, `${routeStart} should reacquire the current database after authorization`)
    assert.ok(revalidation > liveDbRead, `${routeStart} should revalidate the reacquired database`)
    assert.ok(liveNormalization > revalidation, `${routeStart} must revalidate before mutating the live order`)
    assert.doesNotMatch(source, /await revalidateAdminRepaymentOperation\(/, `${routeStart} must not yield after live revalidation`)
  })

  assert.match(api, /function revalidateAdminRepaymentOperation[\s\S]*db\.orders\.find[\s\S]*findAdminSecurityInstallmentPlanItem/)
  assert.match(api, /async function failAdminRepaymentRevalidation[\s\S]*status: 'failed'[\s\S]*fail\(ctx,/)
})

test('post-guard repayment revalidation repeats each route state-dependent rule', () => {
  const expectations = [
    {
      route: "router.patch('/orders/:id/installments/:period/pay'",
      patterns: [/revalidateAdminRepaymentOperation/, /findInstallmentPlanItemByPeriod/],
    },
    {
      route: "router.patch('/orders/:id/installments/:period/due-date'",
      patterns: [/revalidateAdminRepaymentOperation/, /installmentItemIsPaid/, /hasNegotiatedRepaymentDueDateTarget/, /resolveDeferRepaymentBaseDueDateKey/],
    },
    {
      route: "router.patch('/orders/:id/installments/:period/settle-amount'",
      patterns: [/revalidateAdminRepaymentOperation/, /payType !== 'installment'/, /cardPackageIssued/, /installmentItemIsPaid/, /negotiationPayPending/],
    },
    {
      route: "router.patch('/orders/:id/installments/:period/negotiate'",
      patterns: [/revalidateAdminRepaymentOperation/, /payType !== 'installment'/, /cardPackageIssued/, /installmentItemIsPaid/, /negotiationPayPending/, /negotiateExtensionFeeRemainderAmount/],
    },
    {
      route: "router.patch('/orders/:id/installments/:period/negotiation/history/:historyIndex/paid'",
      patterns: [/revalidateAdminRepaymentOperation/, /payType !== 'installment'/, /cardPackageIssued/, /installmentItemIsPaid/, /negotiationHistory/],
    },
  ]

  expectations.forEach(({ route, patterns }) => {
    const source = routeSource(route)
    const guard = source.indexOf('beginAdminSensitiveOperation(ctx,')
    const postGuardSource = source.slice(guard)
    patterns.forEach(pattern => assert.match(postGuardSource, pattern, `${route} must repeat ${pattern}`))
  })
})

test('security audit permission is readonly and available only to boss and super admin defaults', () => {
  assert.match(permissions, /key: 'security\.audit', label: '操作记录', actions: \['view'\]/)
  assert.match(permissions, /role === 'boss'[\s\S]*security\.audit/)

  const listRoute = routeSource("router.get('/admin/security/audit-logs'")
  const detailRoute = routeSource("router.get('/admin/security/audit-logs/:id'")
  assert.match(listRoute, /strictRoles: true/)
  assert.match(detailRoute, /strictRoles: true/)
  assert.match(api, /permissionKey[\s\S]*strictRoles[\s\S]*roleMatchesAllowedRoles\(role, allowedRoles, true\)/)
})

test('challenge and live paid routes reject non-booleans and use the same revoke authorization mapping', () => {
  const markPaidRoute = routeSource("router.patch('/orders/:id/installments/:period/pay'")
  const negotiationPaidRoute = routeSource("router.patch('/orders/:id/installments/:period/negotiation/history/:historyIndex/paid'")
  assert.match(api, /normalizeAdminPaidInput\(rawInput\)/)
  assert.match(markPaidRoute, /normalizeAdminPaidInput\(payload\)/)
  assert.match(negotiationPaidRoute, /normalizeAdminPaidInput\(payload\)/)
  assert.doesNotMatch(markPaidRoute, /Boolean\(payload\.paid\)/)
  assert.doesNotMatch(negotiationPaidRoute, /Boolean\(payload\.paid\)/)
})

test('order deletion rechecks the order id after the awaited security guard before splicing', () => {
  const source = routeSource("router.delete('/orders/:id'")
  const authorization = source.indexOf('beginAdminSensitiveOperation(ctx,')
  const liveDbRead = source.indexOf('db = readDb()', authorization)
  const liveLookup = source.indexOf('db.orders.findIndex', authorization)
  const splice = source.indexOf('db.orders.splice(liveIdx, 1)')

  assert.ok(liveDbRead > authorization)
  assert.ok(liveLookup > liveDbRead)
  assert.ok(splice > liveLookup)
  assert.doesNotMatch(source, /db\.orders\.splice\(idx, 1\)/)
})

test('order delete permission is checked generally before target existence is disclosed', () => {
  const start = api.indexOf('async function requireAdminOrderDeletePermission(ctx)')
  const end = api.indexOf('\nasync function resolveEffectiveTenantId', start)
  const source = api.slice(start, end)
  const generalPermission = source.indexOf("hasAdminPermissionOnAny(account, ['orders.review', 'orders.approved'], 'delete')")
  const targetLookup = source.indexOf('db.orders.findIndex')

  assert.ok(generalPermission >= 0)
  assert.ok(targetLookup > generalPermission)

  const challengeStart = api.indexOf('if (actionCode === ACTION_CODES.ORDER_DELETE)')
  const challengeEnd = api.indexOf('if (actionCode === ACTION_CODES.USER_EXPORT)', challengeStart)
  const challengeSource = api.slice(challengeStart, challengeEnd)
  const challengeGeneralPermission = challengeSource.indexOf("hasAdminPermissionOnAny(securityContext.account, ['orders.review', 'orders.approved'], 'delete')")
  const challengeTargetLookup = challengeSource.indexOf('db.orders.find')
  assert.ok(challengeGeneralPermission >= 0)
  assert.ok(challengeTargetLookup > challengeGeneralPermission)
})

test('OTP transitions and SMS reservations are atomic in the existing challenge collection', () => {
  assert.equal((securityStore.match(/adminSecurity[A-Z][A-Za-z]+/g) || []).filter((value, index, all) => all.indexOf(value) === index).length, 3)
  assert.match(securityStore, /async recordChallengeFailure[\s\S]*findOneAndUpdate[\s\S]*status: 'pending'[\s\S]*expireAt/)
  assert.match(securityStore, /async claimChallengeVerification[\s\S]*attempts: \{ \$lt: maxAttempts \}[\s\S]*expireAt: \{ \$gt:/)
  assert.match(securityStore, /async reserveChallengeSend[\s\S]*findOneAndUpdate[\s\S]*sendReservations/)
})

test('all tunable admin security settings are documented as environment variables', () => {
  assert.match(envExample, /ADMIN_SECURITY_MODE=off/)
  assert.match(envExample, /ADMIN_SECURITY_TENANTS=/)
  assert.match(envExample, /ADMIN_SECURITY_SECRET=/)
  assert.match(envExample, /ADMIN_SECURITY_SMS_MSG_TEMPLATE=/)
  assert.match(envExample, /ADMIN_SECURITY_LOG_RETENTION_DAYS=365/)
  assert.match(envExample, /ADMIN_SECURITY_OTP_TTL_MS=300000/)
  assert.match(envExample, /ADMIN_SECURITY_OTP_RESEND_MS=60000/)
  assert.match(envExample, /ADMIN_SECURITY_OTP_HOURLY_SEND_LIMIT=10/)
  assert.match(envExample, /ADMIN_SECURITY_OTP_MAX_ATTEMPTS=5/)
  assert.match(envExample, /ADMIN_SECURITY_REPAYMENT_PROOF_TTL_MS=1800000/)

  assert.doesNotMatch(api, /process\.env\.ADMIN_SECURITY_[A-Z_]+\s*\|\|/)
  assert.match(api, /logRetentionDays:\s*Number\(process\.env\.ADMIN_SECURITY_LOG_RETENTION_DAYS\)/)
  assert.match(api, /otpTtlMs:\s*Number\(process\.env\.ADMIN_SECURITY_OTP_TTL_MS\)/)
  assert.match(api, /resendMs:\s*Number\(process\.env\.ADMIN_SECURITY_OTP_RESEND_MS\)/)
  assert.match(api, /hourlySendLimit:\s*Number\(process\.env\.ADMIN_SECURITY_OTP_HOURLY_SEND_LIMIT\)/)
  assert.match(api, /maxAttempts:\s*Number\(process\.env\.ADMIN_SECURITY_OTP_MAX_ATTEMPTS\)/)
  assert.match(api, /repaymentProofTtlMs:\s*Number\(process\.env\.ADMIN_SECURITY_REPAYMENT_PROOF_TTL_MS\)/)
  assert.doesNotMatch(securityService, /options\.(?:otpTtlMs|resendMs|repaymentProofTtlMs|logRetentionDays|hourlySendLimit|maxAttempts)\s*\|\|/)
})
