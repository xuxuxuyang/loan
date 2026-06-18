const assert = require('node:assert/strict')
const test = require('node:test')

const {
  resolveDeferRepaymentBaseDueDateKey,
  applyDeferRepaymentDueDate,
} = require('../src/installmentDeferRepayment')

test('uses negotiation pending remainder due date as defer base', () => {
  const planItem = {
    dueDate: '2026-06-15',
    negotiationPayPending: {
      negotiatedAmount: 200,
      remainderDueDate: '2026-06-20',
    },
    negotiationHistory: [{
      negotiatedAmount: 200,
      remainderDueDate: '2026-06-20',
    }],
  }
  assert.equal(resolveDeferRepaymentBaseDueDateKey(planItem), '2026-06-20')
})

test('defers from pending date without changing installment dueDate', () => {
  const planItem = {
    dueDate: '2026-06-15',
    negotiationPayPending: {
      negotiatedAmount: 200,
      remainderDueDate: '2026-06-20',
    },
    negotiationHistory: [{
      negotiatedAmount: 200,
      remainderDueDate: '2026-06-20',
    }],
  }
  applyDeferRepaymentDueDate(planItem, '2026-06-27')
  assert.equal(planItem.dueDate, '2026-06-15')
  assert.equal(planItem.negotiationPayPending.remainderDueDate, '2026-06-27')
  assert.equal(planItem.negotiationHistory[0].remainderDueDate, '2026-06-27')
})

test('defers plain installment by updating dueDate only', () => {
  const planItem = {
    dueDate: '2026-06-15',
  }
  assert.equal(resolveDeferRepaymentBaseDueDateKey(planItem), '2026-06-15')
  applyDeferRepaymentDueDate(planItem, '2026-06-29')
  assert.equal(planItem.dueDate, '2026-06-29')
})
