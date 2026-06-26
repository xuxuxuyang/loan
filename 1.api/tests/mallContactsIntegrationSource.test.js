const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const source = fs.readFileSync(path.resolve(__dirname, '../src/index.js'), 'utf8')

function routeBody(routeStart) {
  const start = source.indexOf(routeStart)
  assert.notEqual(start, -1, `${routeStart} route must exist`)
  const nextRoute = source.indexOf('\nrouter.', start + routeStart.length)
  assert.notEqual(nextRoute, -1, `${routeStart} must be followed by another route`)
  return source.slice(start, nextRoute)
}

test('index registers mall contacts routes from the independent module', () => {
  assert.match(source, /require\('\.\/mallContacts\/router'\)/)
  assert.match(source, /createMallContactsStore\(\)/)
  assert.match(source, /registerMallContactsRoutes\(router,\s*\{/)
})

test('admin approval marks only newly approved installment orders for contacts before contract', () => {
  const body = routeBody("router.patch('/orders/:id/status'")
  assert.match(body, /status === 'shipping' && previousStatus !== 'shipping' && target\.payType === 'installment'/)
  assert.match(body, /markMallContactsRequiredForOrder\(target\)/)
  assert.match(body, /writeOrderDb\(db, target\)/)
})

test('card-package contract flow and ack both guard contacts before signing', () => {
  const flow = routeBody("router.get('/card-packages/:orderId/contract-flow'")
  const ack = routeBody("router.post('/card-packages/:orderId/contract-ack'")
  assert.match(flow, /failMallContactsRequired\(ctx, order\)/)
  assert.match(ack, /failMallContactsRequired\(ctx, order\)/)
  assert.match(source, /function shouldRequireMallContactsForClient\(ctx\)/)
  assert.match(source, /clientPlatform[^]*android/)
})

test('admin user contacts route is read-only and permission-gated', () => {
  const body = routeBody("router.get('/users/:id/mall-contacts'")
  assert.match(body, /requireAdminUsersActionOnAny\(ctx, 'view', '[^']*'\)/)
  assert.match(body, /mallContactsStore\.listCompletedContactUploads\(/)
  assert.doesNotMatch(body, /writeDb|writeDbPartial|flushMongoPersist/)
})
