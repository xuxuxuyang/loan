const assert = require('node:assert/strict')
const test = require('node:test')

const {
  isMallOrderRepaymentSettled,
  mallUserHasUnsettledOrder,
} = require('../src/orderRepaymentSettlement')

test('treats an enjoying installment order with unpaid installments as unsettled', () => {
  const order = {
    id: 'OD-unpaid',
    payType: 'installment',
    status: 'enjoying',
    installmentPlan: [{ period: 1, paid: false }],
  }

  assert.equal(isMallOrderRepaymentSettled(order), false)
})

test('treats an installment order as settled only when every installment is paid', () => {
  assert.equal(isMallOrderRepaymentSettled({
    payType: 'installment',
    status: 'enjoying',
    installmentPlan: [{ period: 1, paid: 'true' }],
  }), true)

  assert.equal(isMallOrderRepaymentSettled({
    payType: 'installment',
    status: 'receiving',
    installmentPlan: [{ period: 1, paid: true }, { period: 2, paid: 0 }],
  }), false)
})

test('blocks a user from ordering again until their prior installment order is repaid', () => {
  const db = {
    orders: [
      {
        id: 'OD-prior',
        mallUserId: 'U1',
        payType: 'installment',
        status: 'enjoying',
        installmentPlan: [{ period: 1, paid: 0 }],
      },
    ],
  }

  assert.equal(mallUserHasUnsettledOrder(db, { id: 'U1' }), true)

  db.orders[0].installmentPlan[0].paid = 1
  assert.equal(mallUserHasUnsettledOrder(db, { id: 'U1' }), false)
})
