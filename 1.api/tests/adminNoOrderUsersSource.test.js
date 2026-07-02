const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const apiSource = fs.readFileSync(path.join(__dirname, '../src/index.js'), 'utf8')

function extractFunction(name) {
  const start = apiSource.indexOf(`function ${name}`)
  assert.notEqual(start, -1, `${name} must exist`)
  const next = apiSource.indexOf('\nfunction ', start + 1)
  return apiSource.slice(start, next === -1 ? apiSource.length : next)
}

test('no-order users are filtered by submitted orders, not approved order stats', () => {
  const submittedIndexBody = extractFunction('buildMallUserSubmittedOrderIndex')
  assert.match(submittedIndexBody, /for \(const order of db\.orders \|\| \[\]\)/)
  assert.match(submittedIndexBody, /order\?\.mallUserId/)
  assert.match(submittedIndexBody, /order\?\.buyerPhone/)
  assert.match(submittedIndexBody, /order\?\.userPhone/)
  assert.doesNotMatch(submittedIndexBody, /receiverPhone/)
  assert.doesNotMatch(submittedIndexBody, /status === 'reviewing'/)
  assert.doesNotMatch(submittedIndexBody, /riskStatus/)

  const matcherBody = extractFunction('mallUserHasSubmittedOrder')
  assert.match(matcherBody, /byUserId\.has\(uid\)/)
  assert.match(matcherBody, /byBuyerPhone\.has\(phone\)/)

  const whiteUserBody = extractFunction('isNoOrderWhiteUser')
  assert.match(whiteUserBody, /!mallUserHasSubmittedOrder\(submittedOrderIndex, user\)/)
  assert.match(whiteUserBody, /displayCreditStatusFromOrderSevenSnapshot\(user\?\.riskControlSnapshot\) === '待风控'/)

  const filteredRowsBody = extractFunction('listAdminUsersFilteredRows')
  assert.match(filteredRowsBody, /view === 'no-order'[\s\S]*buildMallUserSubmittedOrderIndex\(db\)/)
  assert.match(filteredRowsBody, /isNoOrderWhiteUser\(submittedOrderUserIds, item\.user\)/)
  assert.doesNotMatch(filteredRowsBody, /view === 'no-order'[\s\S]{0,160}Number\(item\.orderCount \|\| 0\) === 0/)
})

test('GET /users no-order fallback path uses submitted-order index consistently', () => {
  const routeStart = apiSource.indexOf("router.get('/users', async (ctx) => {")
  assert.notEqual(routeStart, -1, 'GET /users route must exist')
  const routeEnd = apiSource.indexOf("\nrouter.get('/users/by-phone'", routeStart + 1)
  assert.notEqual(routeEnd, -1, 'GET /users/by-phone route must follow GET /users')
  const routeBody = apiSource.slice(routeStart, routeEnd)

  assert.match(routeBody, /view === 'no-order'[\s\S]*buildMallUserSubmittedOrderIndex\(db\)/)
  assert.match(routeBody, /isNoOrderWhiteUser\(submittedOrderUserIds, item\)/)
  assert.doesNotMatch(routeBody, /view === 'no-order'[\s\S]{0,160}Number\(item\.orderCount \|\| 0\) === 0/)
})