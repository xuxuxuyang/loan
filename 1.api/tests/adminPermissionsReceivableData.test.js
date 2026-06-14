const assert = require('node:assert/strict')
const test = require('node:test')

const {
  adminReceivablePermissionKeyForDueDate,
} = require('../src/adminPermissions')

test('maps arbitrary receivable dates to the receivable data permission', () => {
  assert.equal(
    adminReceivablePermissionKeyForDueDate('2026-06-14', '2026-06-14'),
    'orders.receivable.today',
  )
  assert.equal(
    adminReceivablePermissionKeyForDueDate('2026-06-15', '2026-06-14'),
    'orders.receivable.tomorrow',
  )
  assert.equal(
    adminReceivablePermissionKeyForDueDate('2026-06-20', '2026-06-14'),
    'orders.receivable.data',
  )
})
