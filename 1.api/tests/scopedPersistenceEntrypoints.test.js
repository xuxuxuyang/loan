const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

const source = fs.readFileSync(path.resolve(__dirname, '../src/index.js'), 'utf8')

function routeBody(routeStart) {
  const start = source.indexOf(routeStart)
  assert.notEqual(start, -1, `${routeStart} route must exist`)
  const nextRoute = source.indexOf('\nrouter.', start + routeStart.length)
  assert.notEqual(nextRoute, -1, `${routeStart} must be followed by another route`)
  return source.slice(start, nextRoute)
}

test('high-traffic and single-collection write routes use scoped persistence helpers', () => {
  const expectations = [
    ["router.post('/products'", 'writeProductsDb(db)'],
    ["router.patch('/products/:id'", 'writeProductsDb(db)'],
    ["router.delete('/products/:id'", 'writeProductsDb(db)'],
    ["router.post('/auth/register'", 'writeUsersDb(db)'],
    ["router.post('/traffic/channel-click'", 'writeTrafficChannelsDb(db)'],
    ["router.post('/users/:id/risk-slot/:slotKey'", 'writeUsersDb(db)'],
    ["router.post('/users/:id/risk-check'", 'writeUsersDb(db)'],
    ["router.post('/users'", 'writeUsersDb(db)'],
  ]

  for (const [route, helper] of expectations) {
    const body = routeBody(route)
    assert.match(body, new RegExp(helper.replace(/[()]/g, '\\$&')))
    assert.doesNotMatch(body, /writeDb\(db\)/)
  }
})
