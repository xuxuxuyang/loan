const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const apiSource = fs.readFileSync(path.join(__dirname, '../src/index.js'), 'utf8')
const permissionsSource = fs.readFileSync(path.join(__dirname, '../src/adminPermissions.js'), 'utf8')

function extractFunction(name) {
  const start = apiSource.indexOf(`function ${name}(`)
  assert.notEqual(start, -1, `${name} must exist`)
  const next = apiSource.indexOf('\nfunction ', start + 1)
  return apiSource.slice(start, next === -1 ? apiSource.length : next)
}

test('registered whitelist is a separate readonly user permission and list view', () => {
  assert.match(permissionsSource, /key: 'users\.registeredWhitelist', label: '注册白名单', actions: \['view', 'remove'\]/)
  assert.match(permissionsSource, /remove: '移除'/)
  assert.match(permissionsSource, /ADMIN_USERS_PAGE_PERMISSION_KEYS = \['users\.registered', 'users\.registeredWhitelist', 'users\.noOrder'/)
  assert.match(permissionsSource, /view === 'registered-whitelist'[\s\S]*return 'registered-whitelist'/)
  assert.match(permissionsSource, /normalized === 'registered-whitelist'[\s\S]*return 'users\.registeredWhitelist'/)
})

test('registered whitelist contains only users without orders and without risk checks', () => {
  const removedMarkerBody = extractFunction('mallUserHasRegisteredWhitelistRemoved')
  assert.match(removedMarkerBody, /registeredWhitelistRemovedAt/)

  const markerBody = extractFunction('mallUserHasWhitelistExclusionMarker')
  assert.match(markerBody, /mallUserHasRegisteredWhitelistRemoved/)
  assert.match(markerBody, /mallUserHasNonRemovalWhitelistExclusionMarker/)

  const nonRemovalMarkerBody = extractFunction('mallUserHasNonRemovalWhitelistExclusionMarker')
  assert.match(nonRemovalMarkerBody, /manualRejectReason/)
  assert.match(nonRemovalMarkerBody, /orderBlacklisted === true/)
  assert.match(nonRemovalMarkerBody, /duodiandianApplyNo/)
  assert.match(nonRemovalMarkerBody, /duodiandianPartnerOrderNo/)
  assert.match(nonRemovalMarkerBody, /riskReviewStatus/)
  assert.match(nonRemovalMarkerBody, /riskReviewSource/)

  const fieldsBody = extractFunction('hasRegisteredWhitelistFields')
  assert.match(fieldsBody, /registeredWhitelistEligible === true/)
  assert.match(fieldsBody, /mallInstallmentRiskAttempted === false/)

  const whitelistByStatusBody = extractFunction('isRegisteredWhitelistUserByStatus')
  assert.match(whitelistByStatusBody, /isRegisteredWhitelistBaseUser\(submittedOrderIndex, user\)/)
  assert.match(whitelistByStatusBody, /normalizeRegisteredWhitelistStatus\(statusRaw\)/)
  assert.match(whitelistByStatusBody, /status === 'all'/)
  assert.match(whitelistByStatusBody, /status === 'removed'/)

  const whitelistBody = extractFunction('isRegisteredWhitelistUser')
  assert.match(whitelistBody, /isRegisteredWhitelistUserByStatus\(submittedOrderIndex, user, 'active'\)/)

  const createBody = extractFunction('createMallUserFromRegisterPayload')
  assert.match(createBody, /registeredWhitelistEligible: true/)
  assert.match(createBody, /mallInstallmentRiskAttempted: false/)

  const filteredRowsBody = extractFunction('listAdminUsersFilteredRows')
  assert.match(filteredRowsBody, /view === 'no-order' \|\| view === 'registered-whitelist'[\s\S]*buildMallUserSubmittedOrderIndex\(db\)/)
  assert.match(filteredRowsBody, /view === 'no-order'[\s\S]*isNoOrderWhiteUser\(submittedOrderUserIds, item\.user\)/)
  assert.match(filteredRowsBody, /view === 'registered-whitelist'[\s\S]*isRegisteredWhitelistUserByStatus\(submittedOrderUserIds, item\.user, query\.registeredWhitelistStatus\)/)
})

test('GET /users recognizes registered whitelist view instead of falling back to registered', () => {
  const routeStart = apiSource.indexOf("router.get('/users', async (ctx) => {")
  assert.notEqual(routeStart, -1, 'GET /users route must exist')
  const routeEnd = apiSource.indexOf("\nrouter.get('/users/by-phone'", routeStart + 1)
  assert.notEqual(routeEnd, -1, 'GET /users/by-phone route must follow GET /users')
  const routeBody = apiSource.slice(routeStart, routeEnd)
  assert.match(routeBody, /viewRaw === 'registered-whitelist'[\s\S]*\? 'registered-whitelist'/)
  assert.match(routeBody, /registeredWhitelistStatus = normalizeRegisteredWhitelistStatus\(ctx\.query\.registeredWhitelistStatus\)/)
  assert.match(routeBody, /registeredWhitelistStatus,[\s\S]*orderDate,[\s\S]*page/)
  assert.match(routeBody, /view === 'registered-whitelist'[\s\S]*isRegisteredWhitelistUserByStatus\(submittedOrderUserIds, item, registeredWhitelistStatus\)/)
})

test('registered whitelist remove and restore routes only toggle removal marker', () => {
  const routeStart = apiSource.indexOf("router.patch('/users/:id/registered-whitelist/remove'")
  assert.notEqual(routeStart, -1, 'registered whitelist remove route must exist')
  const routeEnd = apiSource.indexOf("\n/** 管理端：用户详情", routeStart + 1)
  assert.notEqual(routeEnd, -1, 'remove/restore routes must be before generic user routes')
  const routeBody = apiSource.slice(routeStart, routeEnd)
  assert.match(routeBody, /router\.patch\('\/users\/:id\/registered-whitelist\/restore'/)
  assert.match(routeBody, /permissionKey: 'users\.registeredWhitelist'/)
  assert.match(routeBody, /permissionAction: 'remove'/)
  assert.match(routeBody, /markRegisteredWhitelistRemoved\(target, operator\)/)
  assert.match(routeBody, /restoreRegisteredWhitelistRemoved\(target\)/)
  assert.match(routeBody, /if \(changed\) \{[\s\S]*writeUsersDb\(db\)/)
  assert.doesNotMatch(routeBody, /splice\(/)
  assert.doesNotMatch(routeBody, /db\.users\s*=/)

  const markBody = extractFunction('markRegisteredWhitelistRemoved')
  assert.match(markBody, /registeredWhitelistRemovedAt = new Date\(\)\.toISOString\(\)/)
  assert.match(markBody, /registeredWhitelistRemovedBy = by/)
  const restoreBody = extractFunction('restoreRegisteredWhitelistRemoved')
  assert.match(restoreBody, /delete user\.registeredWhitelistRemovedAt/)
  assert.match(restoreBody, /delete user\.registeredWhitelistRemovedBy/)
})

test('shop installment risk wave marks only a lightweight user attempt flag', () => {
  const markBody = extractFunction('markMallInstallmentRiskAttempted')
  assert.match(markBody, /normalizePhone\(phone\)/)
  assert.match(markBody, /mallInstallmentRiskAttempted === true/)
  assert.match(markBody, /user\.mallInstallmentRiskAttempted = true/)
  assert.doesNotMatch(markBody, /push\(/)
  assert.doesNotMatch(markBody, /riskAttempts/)

  const routeStart = apiSource.indexOf("router.post('/mall/installment-risk/wave'")
  assert.notEqual(routeStart, -1, 'installment risk wave route must exist')
  const routeEnd = apiSource.indexOf("\nrouter.post('/mall/installment-risk/wave/:waveId/step/:stepKey'", routeStart + 1)
  assert.notEqual(routeEnd, -1, 'step route must follow wave route')
  const routeBody = apiSource.slice(routeStart, routeEnd)
  assert.match(routeBody, /markMallInstallmentRiskAttempted\(db, wavePhone\)/)
  assert.match(routeBody, /writeUsersDb\(db\)/)
})