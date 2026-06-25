const assert = require('node:assert/strict')
const test = require('node:test')

const {
  resolveDeferRepaymentBaseDueDateKey,
  applyDeferRepaymentDueDate,
  buildDeferRepaymentDisplayEvent,
  recordDeferRepaymentDisplayEvent,
  recordNegotiationDeferAsCollectedEvent,
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

test('builds defer-as-collected display event without mutating installment data', () => {
  const planItem = {
    dueDate: '2026-06-15',
    amount: 2750,
  }

  const event = buildDeferRepaymentDisplayEvent(planItem, {
    orderId: 'OD-preview',
    period: 1,
    fromDueDate: '2026-06-15',
    toDueDate: '2026-06-16',
    nowIso: '2026-06-15T09:30:00.000Z',
  })

  assert.equal(Object.prototype.hasOwnProperty.call(planItem, 'repaymentRateEvents'), false)
  assert.deepEqual(event, {
    type: 'defer_as_collected',
    orderId: 'OD-preview',
    period: 1,
    statsDate: '2026-06-15',
    fromDueDate: '2026-06-15',
    toDueDate: '2026-06-16',
    amountAtAction: 2750,
    createdAt: '2026-06-15T09:30:00.000Z',
  })
})

test('records defer-as-collected display event without changing repayment state', () => {
  const planItem = {
    dueDate: '2026-06-15',
    amount: 2750,
    paid: false,
  }

  const first = recordDeferRepaymentDisplayEvent(planItem, {
    orderId: 'OD-display',
    period: 1,
    fromDueDate: '2026-06-15',
    toDueDate: '2026-06-16',
    nowIso: '2026-06-15T09:30:00.000Z',
  })
  const second = recordDeferRepaymentDisplayEvent(planItem, {
    orderId: 'OD-display',
    period: 1,
    fromDueDate: '2026-06-15',
    toDueDate: '2026-06-16',
    nowIso: '2026-06-15T09:31:00.000Z',
  })

  assert.equal(first, true)
  assert.equal(second, false)
  assert.equal(planItem.paid, false)
  assert.equal(planItem.repaymentDisplayEvents.length, 1)
  assert.deepEqual(planItem.repaymentDisplayEvents[0], {
    type: 'defer_as_collected',
    orderId: 'OD-display',
    period: 1,
    statsDate: '2026-06-15',
    fromDueDate: '2026-06-15',
    toDueDate: '2026-06-16',
    amountAtAction: 2750,
    createdAt: '2026-06-15T09:30:00.000Z',
  })
})

test('records negotiation defer as collected when negotiation due date moves later', () => {
  const planItem = {
    dueDate: '2026-06-25',
    amount: 2750,
    paid: false,
  }

  const recorded = recordNegotiationDeferAsCollectedEvent(planItem, {
    orderId: 'OD-negotiate-defer',
    period: 1,
    fromDueDate: '2026-06-25',
    toDueDate: '2026-06-26',
    nowIso: '2026-06-25T15:28:00.000Z',
  })

  assert.equal(recorded, true)
  assert.equal(planItem.paid, false)
  assert.deepEqual(planItem.repaymentDisplayEvents[0], {
    type: 'defer_as_collected',
    orderId: 'OD-negotiate-defer',
    period: 1,
    statsDate: '2026-06-25',
    fromDueDate: '2026-06-25',
    toDueDate: '2026-06-26',
    amountAtAction: 2750,
    createdAt: '2026-06-25T15:28:00.000Z',
  })
})

test('does not record negotiation defer display event when due date is not later', () => {
  const planItem = {
    dueDate: '2026-06-25',
    amount: 2750,
    paid: false,
  }

  const sameDay = recordNegotiationDeferAsCollectedEvent(planItem, {
    orderId: 'OD-negotiate-same-day',
    period: 1,
    fromDueDate: '2026-06-25',
    toDueDate: '2026-06-25',
  })
  const earlier = recordNegotiationDeferAsCollectedEvent(planItem, {
    orderId: 'OD-negotiate-earlier',
    period: 1,
    fromDueDate: '2026-06-25',
    toDueDate: '2026-06-24',
  })

  assert.equal(sameDay, false)
  assert.equal(earlier, false)
  assert.equal(planItem.repaymentDisplayEvents, undefined)
})
