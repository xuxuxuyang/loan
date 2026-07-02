const assert = require('node:assert/strict')
const test = require('node:test')

const {
  filterDueOnDateRowRefs,
  computePendingReceivableStats,
  computeTotalOverdueAmount,
  computePrincipalSettlementThroughDate,
  computeRiskAdjustedRevenueThroughDate,
  resolveInstallmentPrincipalAmount,
  computeOrderSettlementRateOnDate,
  computeDynamicOrderSettlementRate,
  computeDynamicPendingReceivableAverages,
  computeDynamicUnpaidRateThroughDate,
  resolveInstallmentEffectiveDueDateKey,
} = require('../src/pendingReceivableStats')

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
  assert.equal(stats.allDueOnDateRowRefs.length, 2)
  assert.equal(stats.rowRefs.length, 1)
})

test('filterDueOnDateRowRefs scopes list rows without changing stats', () => {
  const orders = [
    {
      id: 'OD-filter',
      installmentPlan: [
        { period: 1, dueDate: '2026-06-15', amount: 100, paid: true },
        { period: 2, dueDate: '2026-06-15', amount: 200, paid: false },
      ],
    },
  ]

  const stats = computePendingReceivableStats(orders, '2026-06-15')
  assert.equal(filterDueOnDateRowRefs(stats.allDueOnDateRowRefs, 'all').length, 2)
  assert.equal(filterDueOnDateRowRefs(stats.allDueOnDateRowRefs, 'paid').length, 1)
  assert.equal(filterDueOnDateRowRefs(stats.allDueOnDateRowRefs, 'unpaid').length, 1)
  assert.equal(filterDueOnDateRowRefs(stats.allDueOnDateRowRefs, 'paid')[0].paid, true)
  assert.equal(stats.totalDueOnDateCount, 2)
  assert.equal(stats.paidDueOnDateCount, 1)
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

test('counts deferred due installment as collected on original stats date without changing real future receivable', () => {
  const orders = [
    {
      id: 'OD-defer-rate',
      installmentPlan: [
        {
          period: 1,
          dueDate: '2026-06-16',
          amount: 2750,
          paid: false,
          repaymentDisplayEvents: [{
            type: 'defer_as_collected',
            orderId: 'OD-defer-rate',
            period: 1,
            statsDate: '2026-06-15',
            fromDueDate: '2026-06-15',
            toDueDate: '2026-06-16',
            amountAtAction: 2750,
            createdAt: '2026-06-15T09:30:00.000Z',
          }],
        },
      ],
    },
  ]

  const originalDayStats = computePendingReceivableStats(orders, '2026-06-15')
  assert.equal(originalDayStats.totalDueOnDateCount, 1)
  assert.equal(originalDayStats.paidDueOnDateCount, 1)
  assert.equal(originalDayStats.unpaidDueOnDateCount, 0)
  assert.equal(originalDayStats.collectionRateOnDate, 100)
  assert.equal(originalDayStats.deferredAsCollectedCount, 1)
  assert.equal(originalDayStats.deferredAsCollectedAmount, 2750)
  assert.equal(originalDayStats.allDueOnDateRowRefs.length, 1)
  assert.equal(originalDayStats.allDueOnDateRowRefs[0].paid, true)
  assert.equal(originalDayStats.allDueOnDateRowRefs[0].repaymentDisplayStatus, 'deferred_as_collected')

  const futureStats = computePendingReceivableStats(orders, '2026-06-16')
  assert.equal(futureStats.totalDueOnDateCount, 1)
  assert.equal(futureStats.paidDueOnDateCount, 0)
  assert.equal(futureStats.unpaidDueOnDateCount, 1)
  assert.equal(futureStats.rowRefs.length, 1)
  assert.equal(futureStats.rowRefs[0].paid, false)
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

test('averages daily unpaid rate and amount from first due date through end date', () => {
  const orders = [
    {
      id: 'OD-day14',
      installmentPlan: [
        { period: 1, dueDate: '2026-06-14', amount: 16500, paid: false },
        { period: 2, dueDate: '2026-06-14', amount: 0, paid: true },
      ],
    },
    {
      id: 'OD-day15',
      installmentPlan: [
        { period: 1, dueDate: '2026-06-15', amount: 2750, paid: false },
      ],
    },
  ]

  const day14 = computePendingReceivableStats(orders, '2026-06-14')
  const day15 = computePendingReceivableStats(orders, '2026-06-15')
  assert.equal(day14.unpaidRateOnDate, 50)
  assert.equal(day15.unpaidRateOnDate, 100)

  const dynamic = computeDynamicPendingReceivableAverages(orders, '2026-06-15')
  assert.equal(dynamic.dynamicDayCount, 2)
  assert.equal(dynamic.dynamicUnpaidRate, 75)
  assert.equal(dynamic.dynamicUnpaidAmount, 9625)
  assert.equal(dynamic.dynamicUnpaidShareOfDue, 100)
})

test('computes dynamic unpaid rate through yesterday for a channel order subset', () => {
  const channelOrders = [
    {
      id: 'OD-channel-23',
      installmentPlan: [
        { period: 1, dueDate: '2026-06-23', amount: 100, paid: false },
      ],
    },
    {
      id: 'OD-channel-24',
      installmentPlan: [
        { period: 1, dueDate: '2026-06-24', amount: 100, paid: true },
      ],
    },
    {
      id: 'OD-channel-today',
      installmentPlan: [
        { period: 1, dueDate: '2026-06-25', amount: 100, paid: false },
      ],
    },
  ]

  const throughYesterday = computeDynamicUnpaidRateThroughDate(channelOrders, '2026-06-24')
  assert.equal(throughYesterday.dynamicDayCount, 2)
  assert.equal(throughYesterday.dynamicUnpaidRate, 50)
})

test('dynamic unpaid rate treats deferred display events as paid on original due date', () => {
  const channelOrders = [
    {
      id: 'OD-channel-deferred',
      installmentPlan: [
        {
          period: 1,
          dueDate: '2026-06-25',
          amount: 100,
          paid: false,
          repaymentDisplayEvents: [{
            type: 'defer_as_collected',
            orderId: 'OD-channel-deferred',
            period: 1,
            statsDate: '2026-06-24',
            fromDueDate: '2026-06-24',
            toDueDate: '2026-06-25',
            amountAtAction: 100,
            createdAt: '2026-06-24T15:00:00.000Z',
          }],
        },
      ],
    },
  ]

  const dynamic = computeDynamicUnpaidRateThroughDate(channelOrders, '2026-06-24')
  assert.equal(dynamic.dynamicDayCount, 1)
  assert.equal(dynamic.dynamicUnpaidRate, 0)
})

test('averages daily order settlement rate through end date', () => {
  const orders = [
    {
      id: 'settled-14',
      installmentPlan: [
        { period: 1, dueDate: '2026-06-14', amount: 100, paid: true },
      ],
    },
    {
      id: 'unsettled-14',
      installmentPlan: [
        { period: 1, dueDate: '2026-06-14', amount: 100, paid: false },
      ],
    },
    {
      id: 'unsettled-15',
      installmentPlan: [
        { period: 1, dueDate: '2026-06-15', amount: 100, paid: false },
      ],
    },
  ]

  const day14 = computeOrderSettlementRateOnDate(orders, '2026-06-14')
  assert.equal(day14.maturedOrderCount, 2)
  assert.equal(day14.settledOrderCount, 1)
  assert.equal(day14.settlementRateOnDate, 50)

  const day15 = computeOrderSettlementRateOnDate(orders, '2026-06-15')
  assert.equal(day15.maturedOrderCount, 3)
  assert.equal(day15.settlementRateOnDate, 33.33)

  const dynamic = computeDynamicOrderSettlementRate(orders, '2026-06-15')
  assert.equal(dynamic.dynamicSettledDayCount, 2)
  assert.equal(dynamic.dynamicSettledRate, 41.66)
})

test('excludes end date when computing settlement rate through yesterday only', () => {
  const orders = [
    {
      id: 'today-only',
      installmentPlan: [
        { period: 1, dueDate: '2026-06-16', amount: 100, paid: false },
      ],
    },
  ]

  const throughToday = computeDynamicOrderSettlementRate(orders, '2026-06-16')
  assert.equal(throughToday.dynamicSettledDayCount, 1)

  const throughYesterday = computeDynamicOrderSettlementRate(orders, '2026-06-15')
  assert.equal(throughYesterday.dynamicSettledDayCount, 0)
  assert.equal(throughYesterday.dynamicSettledRate, 0)
})

test('sums all unpaid installments with effective due date before today', () => {
  const orders = [
    {
      id: 'OD-overdue-1',
      installmentPlan: [
        { period: 1, dueDate: '2026-06-14', amount: 16500, paid: false },
        { period: 2, dueDate: '2026-06-14', amount: 0, paid: true },
      ],
    },
    {
      id: 'OD-overdue-2',
      installmentPlan: [
        { period: 1, dueDate: '2026-06-15', amount: 2750, paid: false },
      ],
    },
    {
      id: 'OD-today-unpaid',
      installmentPlan: [
        { period: 1, dueDate: '2026-06-16', amount: 5000, paid: false },
      ],
    },
    {
      id: 'OD-future',
      installmentPlan: [
        { period: 1, dueDate: '2026-06-20', amount: 1000, paid: false },
      ],
    },
  ]

  assert.equal(computeTotalOverdueAmount(orders, '2026-06-16'), 19250)
  assert.equal(computeTotalOverdueAmount(orders, '2026-06-15'), 16500)
})

test('excludes end date when computing averages through yesterday only', () => {
  const orders = [
    {
      id: 'OD-today-only',
      installmentPlan: [
        { period: 1, dueDate: '2026-06-15', amount: 2750, paid: false },
      ],
    },
  ]

  const throughToday = computeDynamicPendingReceivableAverages(orders, '2026-06-15')
  assert.equal(throughToday.dynamicDayCount, 1)
  assert.equal(throughToday.dynamicUnpaidRate, 100)

  const throughYesterday = computeDynamicPendingReceivableAverages(orders, '2026-06-14')
  assert.equal(throughYesterday.dynamicDayCount, 0)
  assert.equal(throughYesterday.dynamicUnpaidRate, 0)
  assert.equal(throughYesterday.dynamicUnpaidAmount, 0)
})

test('dynamic receivable averages ignore legacy repaymentRateEvents on order data', () => {
  const orders = [
    {
      id: 'OD-defer-dynamic',
      installmentPlan: [
        {
          period: 1,
          dueDate: '2026-06-16',
          amount: 100,
          paid: false,
          repaymentRateEvents: [{
            type: 'defer_as_collected',
            orderId: 'OD-defer-dynamic',
            period: 1,
            statsDate: '2026-06-15',
            fromDueDate: '2026-06-15',
            toDueDate: '2026-06-16',
            amountAtAction: 100,
            createdAt: '2026-06-15T09:30:00.000Z',
          }],
        },
      ],
    },
  ]

  const dynamic = computeDynamicPendingReceivableAverages(orders, '2026-06-15')
  assert.equal(dynamic.dynamicDayCount, 0)
  assert.equal(dynamic.dynamicUnpaidRate, 0)
  assert.equal(dynamic.dynamicUnpaidAmount, 0)
  assert.equal(dynamic.dynamicUnpaidShareOfDue, 0)
})

test('dynamic receivable averages read persisted display events for dashboard display calculations', () => {
  const orders = [
    {
      id: 'OD-defer-dynamic-preview',
      installmentPlan: [
        {
          period: 1,
          dueDate: '2026-06-16',
          amount: 100,
          paid: false,
          repaymentDisplayEvents: [{
            type: 'defer_as_collected',
            orderId: 'OD-defer-dynamic-preview',
            period: 1,
            statsDate: '2026-06-15',
            fromDueDate: '2026-06-15',
            toDueDate: '2026-06-16',
            amountAtAction: 100,
            createdAt: '2026-06-15T09:30:00.000Z',
          }],
        },
      ],
    },
  ]

  const dynamic = computeDynamicPendingReceivableAverages(orders, '2026-06-15')
  assert.equal(dynamic.dynamicDayCount, 1)
  assert.equal(dynamic.dynamicUnpaidRate, 0)
  assert.equal(dynamic.dynamicUnpaidAmount, 0)
  assert.equal(dynamic.dynamicUnpaidShareOfDue, 0)
})

test('returns zero dynamic metrics when no due installments exist through end date', () => {
  const dynamic = computeDynamicPendingReceivableAverages([], '2026-06-15')
  assert.equal(dynamic.dynamicDayCount, 0)
  assert.equal(dynamic.dynamicUnpaidRate, 0)
  assert.equal(dynamic.dynamicUnpaidAmount, 0)
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

test('resolves installment principal from order card package before legacy item fields', () => {
  const order = { cardPackageAmount: 2000, periods: 1, installmentPlan: [{ period: 1, amount: 2750 }] }
  assert.equal(resolveInstallmentPrincipalAmount(order.installmentPlan[0], order), 2000)
  assert.equal(resolveInstallmentPrincipalAmount({ principal: 80, amount: 100 }), 80)
  assert.equal(resolveInstallmentPrincipalAmount({ amount: 100 }), 100)
})

test('calculates overdue principal amount from unpaid overdue installments only', () => {
  const orders = [
    {
      id: 'OD-overdue-principal',
      cardPackageIssued: true,
      cardPackageIssuedAt: '2026-06-01T10:00:00.000Z',
      cardPackageAmount: 2000,
      periods: 1,
      installmentPlan: [
        { period: 1, dueDate: '2026-06-10', amount: 2750, paid: false },
        { period: 2, dueDate: '2026-06-10', principal: 40, amount: 50, paid: true },
        { period: 3, dueDate: '2026-06-15', principal: 120, amount: 150, paid: false },
      ],
    },
    {
      id: 'OD-not-due-principal',
      cardPackageIssued: true,
      cardPackageIssuedAt: '2026-06-12T10:00:00.000Z',
      cardPackageAmount: 2000,
      periods: 1,
      installmentPlan: [
        { period: 1, dueDate: '2026-06-01', amount: 2750, paid: false },
      ],
    },
  ]

  assert.equal(computeTotalOverdueAmount(orders, '2026-06-15'), 2750)
  assert.equal(computeTotalOverdueAmount(orders, '2026-06-15', { principalOnly: true }), 2000)
})

test('calculates risk-adjusted revenue from collected amount minus due principal', () => {
  const orders = [
    {
      id: 'OD-revenue-paid',
      cardPackageIssued: true,
      cardPackageIssuedAt: '2026-06-01T10:00:00.000Z',
      cardPackageAmount: 2000,
      periods: 1,
      installmentPlan: [
        { period: 1, dueDate: '2026-06-10', amount: 2750, paid: true },
      ],
    },
    {
      id: 'OD-revenue-overdue',
      cardPackageIssued: true,
      cardPackageIssuedAt: '2026-06-01T10:00:00.000Z',
      cardPackageAmount: 2000,
      periods: 1,
      installmentPlan: [
        { period: 1, dueDate: '2026-06-10', amount: 2750, paid: false },
      ],
    },
    {
      id: 'OD-revenue-not-due-ignored',
      cardPackageIssued: true,
      cardPackageIssuedAt: '2026-06-12T10:00:00.000Z',
      cardPackageAmount: 2000,
      periods: 1,
      installmentPlan: [
        { period: 1, dueDate: '2026-06-20', amount: 2750, paid: false },
      ],
    },
  ]

  const stats = computeRiskAdjustedRevenueThroughDate(orders, '2026-06-14')
  assert.equal(stats.collectedAmount, 2750)
  assert.equal(stats.duePrincipal, 4000)
  assert.equal(stats.riskAdjustedRevenue, -1250)
})

test('calculates actual profit through yesterday from collected principal minus overdue principal', () => {
  const orders = [
    {
      id: 'OD-profit-paid',
      cardPackageIssued: true,
      cardPackageIssuedAt: '2026-06-01T10:00:00.000Z',
      cardPackageAmount: 2000,
      periods: 1,
      installmentPlan: [
        { period: 1, dueDate: '2026-06-10', amount: 2750, paid: true },
      ],
    },
    {
      id: 'OD-profit-overdue',
      cardPackageIssued: true,
      cardPackageIssuedAt: '2026-06-01T10:00:00.000Z',
      cardPackageAmount: 2000,
      periods: 1,
      installmentPlan: [
        { period: 1, dueDate: '2026-06-10', amount: 2750, paid: false },
      ],
    },
    {
      id: 'OD-profit-not-due-ignored',
      cardPackageIssued: true,
      cardPackageIssuedAt: '2026-06-12T10:00:00.000Z',
      cardPackageAmount: 2000,
      periods: 1,
      installmentPlan: [
        { period: 1, dueDate: '2026-06-20', amount: 2750, paid: false },
      ],
    },
  ]

  const stats = computePrincipalSettlementThroughDate(orders, '2026-06-14')
  assert.equal(stats.collectedPrincipal, 2000)
  assert.equal(stats.overduePrincipal, 2000)
  assert.equal(stats.principalProfit, 0)
})
