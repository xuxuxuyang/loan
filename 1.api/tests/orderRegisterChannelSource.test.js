const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const source = fs.readFileSync(path.resolve(__dirname, '../src/index.js'), 'utf8')

test('admin order responses expose buyer register channel fields read-only', () => {
  const helperStart = source.indexOf('function resolveOrderRegisterChannelView')
  assert.notEqual(helperStart, -1, 'resolveOrderRegisterChannelView must exist')
  const helperEnd = source.indexOf('\n/**', helperStart + 1)
  const helperBody = source.slice(helperStart, helperEnd)
  assert.match(helperBody, /registerChannelCode:/)
  assert.match(helperBody, /registerChannelName:/)
  assert.match(helperBody, /registerChannelLabel:/)

  const enrichStart = source.indexOf('function enrichMallOrderWithBuyerFields')
  assert.notEqual(enrichStart, -1, 'enrichMallOrderWithBuyerFields must exist')
  const enrichEnd = source.indexOf('\nfunction ', enrichStart + 1)
  const enrichBody = source.slice(enrichStart, enrichEnd)

  assert.match(enrichBody, /resolveOrderRegisterChannelView\(db,\s*buyer\)/)
  assert.match(enrichBody, /\.\.\.registerChannelView/)

  const receivableStart = source.indexOf('function mapPendingReceivableRow')
  assert.notEqual(receivableStart, -1, 'mapPendingReceivableRow must exist')
  const receivableEnd = source.indexOf('\nfunction ', receivableStart + 1)
  const receivableBody = source.slice(receivableStart, receivableEnd)
  assert.match(receivableBody, /resolveOrderRegisterChannelView\(db,\s*buyer\)/)
  assert.match(receivableBody, /\.\.\.registerChannelView/)
})

test('GET /orders accepts registerChannel filter without writing order data', () => {
  const routeStart = source.indexOf("router.get('/orders', async (ctx) => {")
  assert.notEqual(routeStart, -1, 'GET /orders route must exist')
  const routeEnd = source.indexOf('\n/**', routeStart + 1)
  const routeBody = source.slice(routeStart, routeEnd)

  assert.match(routeBody, /registerChannel\s*=\s*''/)
  assert.match(routeBody, /registerChannel/)
  assert.match(routeBody, /adminOrderMatchesRegisterChannel\(db,\s*item,\s*registerChannelFilter\)/)
  assert.doesNotMatch(routeBody, /writeOrdersDb|writeOrderDb|writeDbPartial|flushMongoPersist/)
})
