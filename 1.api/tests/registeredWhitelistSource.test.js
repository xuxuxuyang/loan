const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const apiSource = fs.readFileSync(path.join(__dirname, '../src/index.js'), 'utf8')
const permissionsSource = fs.readFileSync(path.join(__dirname, '../src/adminPermissions.js'), 'utf8')

function extractFunction(name) {
  const start = apiSource.indexOf(`function ${name}`)
  assert.notEqual(start, -1, `${name} must exist`)
  const next = apiSource.indexOf('\nfunction ', start + 1)
  return apiSource.slice(start, next === -1 ? apiSource.length : next)
}

test('registered whitelist is a separate readonly user permission and list view', () => {
  assert.match(permissionsSource, /key: 'users\.registeredWhitelist', label: '注册白名单', actions: \['view'\]/)
  assert.match(permissionsSource, /ADMIN_USERS_PAGE_PERMISSION_KEYS = \['users\.registered', 'users\.registeredWhitelist', 'users\.noOrder'/)
  assert.match(permissionsSource, /view === 'registered-whitelist'[\s\S]*return 'registered-whitelist'/)
  assert.match(permissionsSource, /normalized === 'registered-whitelist'[\s\S]*return 'users\.registeredWhitelist'/)
})

test('registered whitelist contains only users without orders and without risk checks', () => {
  const markerBody = extractFunction('mallUserHasWhitelistExclusionMarker')
  assert.match(markerBody, /manualRejectReason/)
  assert.match(markerBody, /orderBlacklisted === true/)
  assert.match(markerBody, /duodiandianApplyNo/)
  assert.match(markerBody, /duodiandianPartnerOrderNo/)
  assert.match(markerBody, /riskReviewStatus/)
  assert.match(markerBody, /riskReviewSource/)

  const fieldsBody = extractFunction('hasRegisteredWhitelistFields')
  assert.match(fieldsBody, /registeredWhitelistEligible === true/)
  assert.match(fieldsBody, /mallInstallmentRiskAttempted === false/)

  const whitelistBody = extractFunction('isRegisteredWhitelistUser')
  assert.match(whitelistBody, /hasRegisteredWhitelistFields\(user\)/)
  assert.match(whitelistBody, /!mallUserHasSubmittedOrder\(submittedOrderIndex, user\)/)
  assert.match(whitelistBody, /displayCreditStatusFromOrderSevenSnapshot\(user\?\.riskControlSnapshot\) === '待风控'/)
  assert.match(whitelistBody, /mallInstallmentRiskAttempted !== true/)
  assert.match(whitelistBody, /!mallUserHasWhitelistExclusionMarker\(user\)/)

  const createBody = extractFunction('createMallUserFromRegisterPayload')
  assert.match(createBody, /registeredWhitelistEligible: true/)
  assert.match(createBody, /mallInstallmentRiskAttempted: false/)

  const filteredRowsBody = extractFunction('listAdminUsersFilteredRows')
  assert.match(filteredRowsBody, /view === 'no-order' \|\| view === 'registered-whitelist'[\s\S]*buildMallUserSubmittedOrderIndex\(db\)/)
  assert.match(filteredRowsBody, /view === 'no-order'[\s\S]*isNoOrderWhiteUser\(submittedOrderUserIds, item\.user\)/)
  assert.match(filteredRowsBody, /view === 'registered-whitelist'[\s\S]*isRegisteredWhitelistUser\(submittedOrderUserIds, item\.user\)/)
})

test('GET /users recognizes registered whitelist view instead of falling back to registered', () => {
  const routeStart = apiSource.indexOf("router.get('/users', async (ctx) => {")
  assert.notEqual(routeStart, -1, 'GET /users route must exist')
  const routeEnd = apiSource.indexOf("\nrouter.get('/users/by-phone'", routeStart + 1)
  assert.notEqual(routeEnd, -1, 'GET /users/by-phone route must follow GET /users')
  const routeBody = apiSource.slice(routeStart, routeEnd)
  assert.match(routeBody, /viewRaw === 'registered-whitelist'[\s\S]*\? 'registered-whitelist'/)
  assert.match(routeBody, /view === 'registered-whitelist'[\s\S]*isRegisteredWhitelistUser\(submittedOrderUserIds, item\)/)
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