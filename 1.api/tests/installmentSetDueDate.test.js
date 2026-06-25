const assert = require('node:assert/strict')
const test = require('node:test')

const {
  applyNegotiatedRepaymentDueDate,
  hasNegotiatedRepaymentDueDateTarget,
  isDueDateOnOrAfterToday,
} = require('../src/installmentSetDueDate')

test('rejects when no negotiation target exists', () => {
  const planItem = { dueDate: '2026-06-15' }
  const result = applyNegotiatedRepaymentDueDate(planItem, '2026-06-26')
  assert.equal(result.ok, false)
  assert.equal(planItem.dueDate, '2026-06-15')
})

test('updates pending and last history remainderDueDate without changing dueDate or originalDueDate', () => {
  const planItem = {
    dueDate: '2026-06-15',
    negotiationPayPending: {
      negotiatedAmount: 50,
      remainderDueDate: '2026-06-26',
    },
    negotiationHistory: [{
      negotiatedAmount: 50,
      remainderDueDate: '2026-06-26',
      originalDueDate: '2026-06-15',
    }],
  }
  const result = applyNegotiatedRepaymentDueDate(planItem, '2026-07-01')
  assert.equal(result.ok, true)
  assert.equal(planItem.dueDate, '2026-06-15')
  assert.equal(planItem.negotiationPayPending.remainderDueDate, '2026-07-01')
  assert.equal(planItem.negotiationHistory[0].remainderDueDate, '2026-07-01')
  assert.equal(planItem.negotiationHistory[0].originalDueDate, '2026-06-15')
})

test('syncs dueDate when negotiation payment already completed', () => {
  const planItem = {
    dueDate: '2026-06-26',
    negotiationHistory: [{
      negotiatedAmount: 50,
      remainderDueDate: '2026-06-26',
      originalDueDate: '2026-06-15',
      userPaidAt: '2026-06-25T10:11:00.000Z',
    }],
  }
  const result = applyNegotiatedRepaymentDueDate(planItem, '2026-07-05')
  assert.equal(result.ok, true)
  assert.equal(planItem.dueDate, '2026-07-05')
  assert.equal(planItem.negotiationHistory[0].remainderDueDate, '2026-07-05')
  assert.equal(planItem.negotiationHistory[0].originalDueDate, '2026-06-15')
})

test('hasNegotiatedRepaymentDueDateTarget detects history or pending', () => {
  assert.equal(hasNegotiatedRepaymentDueDateTarget({ dueDate: '2026-06-15' }), false)
  assert.equal(hasNegotiatedRepaymentDueDateTarget({
    negotiationHistory: [{ remainderDueDate: '2026-06-20' }],
  }), true)
  assert.equal(hasNegotiatedRepaymentDueDateTarget({
    negotiationPayPending: { negotiatedAmount: 10, remainderDueDate: '2026-06-20' },
  }), true)
})

test('rejects invalid dueDate format', () => {
  const planItem = {
    negotiationHistory: [{ remainderDueDate: '2026-06-26', originalDueDate: '2026-06-15' }],
  }
  const result = applyNegotiatedRepaymentDueDate(planItem, '06-26-2026')
  assert.equal(result.ok, false)
})

test('isDueDateOnOrAfterToday accepts today and future dates', () => {
  assert.equal(isDueDateOnOrAfterToday('2026-06-25', '2026-06-25'), true)
  assert.equal(isDueDateOnOrAfterToday('2026-06-26', '2026-06-25'), true)
  assert.equal(isDueDateOnOrAfterToday('2026-06-24', '2026-06-25'), false)
})
