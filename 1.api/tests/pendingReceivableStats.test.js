const assert = require('node:assert/strict')
const test = require('node:test')

const { computePendingReceivableStats, resolveInstallmentEffectiveDueDateKey } = require('../src/pendingReceivableStats')

test('counts due-on-date amounts and installment counts by paid state', () => {
  const orders = [
    {
      id: 'OD-today',
      installmentPlan: [
        { period: 1, dueDate: '2026-06-15', amount: 100, paid: true },
        { period: 2, dueDate: '2026-06-15', amount: 200.555, paid: false },
        { period: 3, dueDate: '2026-06-16', amount: 300, paid: false },
      ],
    },
  ]

  const stats = computePendingReceivableStats(orders, '2026-06-15')

  assert.equal(stats.totalDueOnDate, 300.56)
  assert.equal(stats.paidDueOnDate, 100)
  assert.equal(stats.unpaidDueOnDate, 200.56)
  assert.equal(stats.totalDueOnDateCount, 2)
  assert.equal(stats.paidDueOnDateCount, 1)
  assert.equal(stats.unpaidDueOnDateCount, 1)
})

test('calculates collection and unpaid rates from due-on-date installment counts', () => {
  const orders = [
    {
      id: 'OD-rate',
      installmentPlan: [
        { period: 1, dueDate: '2026-06-15', amount: 100, paid: true },
        { period: 2, dueDate: '2026-06-15', amount: 100, paid: false },
        { period: 3, dueDate: '2026-06-15', amount: 100, paid: false },
        { period: 4, dueDate: '2026-06-15', amount: 100, paid: false },
        { period: 5, dueDate: '2026-06-16', amount: 100, paid: false },
      ],
    },
  ]

  const stats = computePendingReceivableStats(orders, '2026-06-15')

  assert.equal(stats.collectionRateOnDate, 25)
  assert.equal(stats.unpaidRateOnDate, 75)
})

test('recomputes unpaid counts and overdue rate after a due installment is paid', () => {
  const orders = [
    {
      id: 'OD-late',
      installmentPlan: [
        { period: 1, dueDate: '2026-06-14', amount: 100, paid: false },
        { period: 2, dueDate: '2026-06-15', amount: 200, paid: false },
      ],
    },
  ]

  assert.equal(computePendingReceivableStats(orders, '2026-06-15').overdueRateAsOfDate, 50)

  orders[0].installmentPlan[0].paid = true
  const stats = computePendingReceivableStats(orders, '2026-06-15')

  assert.equal(stats.unpaidDueOnOrBeforeDateCount, 1)
  assert.equal(stats.overdueBeforeDateCount, 0)
  assert.equal(stats.overdueRateAsOfDate, 0)
})

test('uses statistic-day scope for tomorrow overdue rate', () => {
  const orders = [
    {
      id: 'OD-tomorrow',
      installmentPlan: [
        { period: 1, dueDate: '2026-06-14', amount: 100, paid: false },
        { period: 2, dueDate: '2026-06-15', amount: 100, paid: false },
        { period: 3, dueDate: '2026-06-16', amount: 100, paid: false },
      ],
    },
  ]

  const stats = computePendingReceivableStats(orders, '2026-06-16')

  assert.equal(stats.overdueBeforeDateCount, 2)
  assert.equal(stats.unpaidDueOnOrBeforeDateCount, 3)
  assert.equal(stats.overdueRateAsOfDate, 66.67)
})

test('uses negotiated remainder due date instead of original due date when negotiation is pending', () => {
  const orders = [
    {
      id: 'OD-negotiate',
      installmentPlan: [
        {
          period: 1,
          dueDate: '2026-06-15',
          amount: 2750,
          paid: false,
          negotiationPayPending: {
            negotiatedAmount: 500,
            remainderAmount: 2250,
            remainderDueDate: '2026-06-25',
          },
        },
      ],
    },
  ]

  const todayStats = computePendingReceivableStats(orders, '2026-06-15')
  assert.equal(todayStats.rowRefs.length, 0)
  assert.equal(todayStats.unpaidDueOnDateCount, 0)

  const negotiatedDayStats = computePendingReceivableStats(orders, '2026-06-25')
  assert.equal(negotiatedDayStats.rowRefs.length, 1)
  assert.equal(negotiatedDayStats.rowRefs[0].key, '2026-06-25')
  assert.equal(negotiatedDayStats.unpaidDueOnDate, 2750)
})

test('uses deferred due date after admin postpones repayment', () => {
  const orders = [
    {
      id: 'OD-defer',
      installmentPlan: [
        { period: 1, dueDate: '2026-06-17', amount: 1000, paid: false },
      ],
    },
  ]

  const originalDayStats = computePendingReceivableStats(orders, '2026-06-15')
  assert.equal(originalDayStats.rowRefs.length, 0)

  const deferredDayStats = computePendingReceivableStats(orders, '2026-06-17')
  assert.equal(deferredDayStats.rowRefs.length, 1)
  assert.equal(deferredDayStats.rowRefs[0].key, '2026-06-17')
})

test('resolveInstallmentEffectiveDueDateKey prefers negotiated remainder due date', () => {
  const key = resolveInstallmentEffectiveDueDateKey({
    dueDate: '2026-06-15',
    negotiationPayPending: {
      negotiatedAmount: 500,
      remainderDueDate: '2026-06-25',
    },
  })
  assert.equal(key, '2026-06-25')
})

test('returns zero overdue rate when there are no unpaid due installments', () => {
  const orders = [
    {
      id: 'OD-paid',
      installmentPlan: [
        { period: 1, dueDate: '2026-06-15', amount: 100, paid: true },
      ],
    },
  ]

  const stats = computePendingReceivableStats(orders, '2026-06-15')

  assert.equal(stats.unpaidDueOnOrBeforeDateCount, 0)
  assert.equal(stats.overdueRateAsOfDate, 0)
})
