const {
  calculateInstallmentDueDateAfterCardIssue,
} = require('./installmentRepaySchedule')

function normalizeInstallmentDueDateKey(dueDate) {
  if (dueDate == null || dueDate === '') {
    return ''
  }
  const s = String(dueDate).trim()
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/)
  if (m) {
    return m[1]
  }
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) {
    return ''
  }
  const y = d.getFullYear()
  const mo = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${y}-${mo}-${day}`
}

function installmentItemIsPaid(item) {
  if (!item || item.paid == null) {
    return false
  }
  const paid = item.paid
  return paid === true || paid === 1 || paid === '1' || paid === 'true'
}

function resolveCardPackageIssueDueDateKey(order) {
  if (!order || !order.cardPackageIssued) {
    return ''
  }
  return normalizeInstallmentDueDateKey(calculateInstallmentDueDateAfterCardIssue(order.cardPackageIssuedAt || order.createdAt))
}

/** 待收/逾期统计用有效还款日：协商待支付优先；否则历史旧 dueDate 不得早于卡包发放后的真实还款日。 */
function resolveInstallmentEffectiveDueDateKey(item, order) {
  if (!item) {
    return ''
  }
  const pend = item.negotiationPayPending
  if (pend && Number(pend.negotiatedAmount || 0) > 0) {
    const negotiatedDue = normalizeInstallmentDueDateKey(pend.remainderDueDate)
    if (negotiatedDue) {
      return negotiatedDue
    }
  }
  const itemDue = normalizeInstallmentDueDateKey(item.dueDate)
  const issueDue = resolveCardPackageIssueDueDateKey(order)
  if (itemDue && issueDue) {
    return itemDue > issueDue ? itemDue : issueDue
  }
  return itemDue || issueDue
}

function roundMoney(value) {
  return Number(Number(value || 0).toFixed(2))
}

function resolveInstallmentPrincipalAmount(item, order) {
  if (!item) {
    return 0
  }
  const orderPrincipal = Number(order && order.cardPackageAmount)
  const plan = Array.isArray(order && order.installmentPlan) ? order.installmentPlan : []
  const periods = Math.max(1, Number(order && order.periods) || Number(order && order.installmentPeriods) || plan.length || 1)
  if (Number.isFinite(orderPrincipal) && orderPrincipal > 0) {
    return roundMoney(orderPrincipal / periods)
  }
  const principal = Number(item.principal)
  if (Number.isFinite(principal) && principal > 0) {
    return roundMoney(principal)
  }
  return roundMoney(item.amount)
}

const DEFER_AS_COLLECTED_EVENT_TYPE = 'defer_as_collected'

function collectDeferAsCollectedEventsForDate(events, order, item, dueDate) {
  const orderId = String(order && order.id ? order.id : '').trim()
  const period = Number(item && item.period)
  let latestEvent = null
  let latestCreatedAt = Number.NEGATIVE_INFINITY
  for (const event of events) {
    if (!event
      || event.type !== DEFER_AS_COLLECTED_EVENT_TYPE
      || normalizeInstallmentDueDateKey(event.statsDate) !== dueDate
      || String(event.orderId || '').trim() !== orderId
      || Number(event.period) !== period) {
      continue
    }
    const createdAt = Date.parse(String(event.createdAt || ''))
    const comparableCreatedAt = Number.isFinite(createdAt) ? createdAt : Number.NEGATIVE_INFINITY
    if (!latestEvent || comparableCreatedAt >= latestCreatedAt) {
      latestEvent = event
      latestCreatedAt = comparableCreatedAt
    }
  }
  return latestEvent ? [latestEvent] : []
}

function collectRepaymentDisplayEvents(orders, extraEvents = []) {
  const events = Array.isArray(extraEvents) ? [...extraEvents] : []
  for (const order of Array.isArray(orders) ? orders : []) {
    const plan = Array.isArray(order && order.installmentPlan) ? order.installmentPlan : []
    for (const item of plan) {
      const displayEvents = Array.isArray(item && item.repaymentDisplayEvents) ? item.repaymentDisplayEvents : []
      for (const event of displayEvents) {
        events.push(event)
      }
    }
  }
  return events
}

function filterDueOnDateRowRefs(allDueOnDateRowRefs, repaymentStatus = 'unpaid') {
  const refs = Array.isArray(allDueOnDateRowRefs) ? allDueOnDateRowRefs : []
  const status = String(repaymentStatus || 'unpaid').trim().toLowerCase()
  if (status === 'paid') {
    return refs.filter(ref => ref && ref.paid)
  }
  if (status === 'all') {
    return refs
  }
  return refs.filter(ref => ref && !ref.paid)
}

function computePendingReceivableStats(orders, dueDate, options = {}) {
  const deferredAsCollectedEvents = collectRepaymentDisplayEvents(orders, options.deferredAsCollectedEvents)
  const rowRefs = []
  const allDueOnDateRowRefs = []
  let totalDueOnDate = 0
  let paidDueOnDate = 0
  let unpaidDueOnDate = 0
  let totalDueOnDateCount = 0
  let paidDueOnDateCount = 0
  let unpaidDueOnDateCount = 0
  let deferredAsCollectedAmount = 0
  let deferredAsCollectedCount = 0
  let overdueBeforeDateCount = 0
  let unpaidDueOnOrBeforeDateCount = 0

  for (const order of Array.isArray(orders) ? orders : []) {
    const plan = Array.isArray(order && order.installmentPlan) ? order.installmentPlan : []
    for (const item of plan) {
      if (!item) {
        continue
      }
      const key = resolveInstallmentEffectiveDueDateKey(item, order)
      const paid = installmentItemIsPaid(item)
      if (key === dueDate) {
        const amt = roundMoney(item.amount)
        totalDueOnDate += amt
        totalDueOnDateCount += 1
        if (paid) {
          paidDueOnDate += amt
          paidDueOnDateCount += 1
        }
        else {
          unpaidDueOnDate += amt
          unpaidDueOnDateCount += 1
        }
      }
      if (!paid && key && key <= dueDate) {
        unpaidDueOnOrBeforeDateCount += 1
        if (key < dueDate) {
          overdueBeforeDateCount += 1
        }
      }
      if (key === dueDate) {
        const ref = { order, item, key, paid }
        allDueOnDateRowRefs.push(ref)
        if (!paid) {
          rowRefs.push(ref)
        }
      }
      // 当前期次已落在统计日时，以真实还款状态为准，避免历史延期事件重复展示和计数。
      if (key === dueDate) {
        continue
      }
      const deferEvents = collectDeferAsCollectedEventsForDate(deferredAsCollectedEvents, order, item, dueDate)
      for (const event of deferEvents) {
        const amt = roundMoney(event.amountAtAction || item.amount)
        totalDueOnDate += amt
        paidDueOnDate += amt
        totalDueOnDateCount += 1
        paidDueOnDateCount += 1
        deferredAsCollectedAmount += amt
        deferredAsCollectedCount += 1
        allDueOnDateRowRefs.push({
          order,
          item,
          key: dueDate,
          paid: true,
          repaymentDisplayStatus: 'deferred_as_collected',
          deferredAsCollected: true,
          deferEvent: event,
        })
      }
    }
  }

  const overdueRateAsOfDate = unpaidDueOnOrBeforeDateCount > 0
    ? Number(((overdueBeforeDateCount / unpaidDueOnOrBeforeDateCount) * 100).toFixed(2))
    : 0
  const collectionRateOnDate = totalDueOnDateCount > 0
    ? Number(((paidDueOnDateCount / totalDueOnDateCount) * 100).toFixed(2))
    : 0
  const unpaidRateOnDate = totalDueOnDateCount > 0
    ? Number(((unpaidDueOnDateCount / totalDueOnDateCount) * 100).toFixed(2))
    : 0

  return {
    rowRefs,
    allDueOnDateRowRefs,
    totalAmount: roundMoney(unpaidDueOnDate),
    totalDueOnDate: roundMoney(totalDueOnDate),
    paidDueOnDate: roundMoney(paidDueOnDate),
    unpaidDueOnDate: roundMoney(unpaidDueOnDate),
    totalDueOnDateCount,
    paidDueOnDateCount,
    unpaidDueOnDateCount,
    deferredAsCollectedAmount: roundMoney(deferredAsCollectedAmount),
    deferredAsCollectedCount,
    collectionRateOnDate,
    unpaidRateOnDate,
    overdueRateAsOfDate,
    overdueBeforeDateCount,
    unpaidDueOnOrBeforeDateCount,
  }
}

/** 收集截至 endDate（含）所有分期有效应还日（去重、升序） */
function collectReceivableDueDatesUpTo(orders, endDate, options = {}) {
  const deferredAsCollectedEvents = collectRepaymentDisplayEvents(orders, options.deferredAsCollectedEvents)
  const dates = new Set()
  for (const order of Array.isArray(orders) ? orders : []) {
    const plan = Array.isArray(order && order.installmentPlan) ? order.installmentPlan : []
    for (const item of plan) {
      if (!item) {
        continue
      }
      const key = resolveInstallmentEffectiveDueDateKey(item, order)
      if (key && key <= endDate) {
        dates.add(key)
      }
    }
  }
  for (const event of deferredAsCollectedEvents) {
    if (!event || event.type !== DEFER_AS_COLLECTED_EVENT_TYPE) {
      continue
    }
    const statsDate = normalizeInstallmentDueDateKey(event.statsDate)
    if (statsDate && statsDate <= endDate) {
      dates.add(statsDate)
    }
  }
  return Array.from(dates).sort()
}

/**
 * 全部逾期金额：有效应还日早于 todayKey、仍未还的分期金额合计（不含当日应还，与订单「已逾期」口径一致）。
 */
function computeTotalOverdueAmount(orders, todayKey, options = {}) {
  const amountOf = options.principalOnly
    ? (item, order) => resolveInstallmentPrincipalAmount(item, order)
    : item => roundMoney(item.amount)
  let total = 0
  for (const order of Array.isArray(orders) ? orders : []) {
    const plan = Array.isArray(order && order.installmentPlan) ? order.installmentPlan : []
    for (const item of plan) {
      if (!item || installmentItemIsPaid(item)) {
        continue
      }
      const key = resolveInstallmentEffectiveDueDateKey(item, order)
      if (key && todayKey && key < todayKey) {
        total += amountOf(item, order)
      }
    }
  }
  return roundMoney(total)
}

function computePrincipalSettlementThroughDate(orders, endDate) {
  const endKey = normalizeInstallmentDueDateKey(endDate)
  if (!endKey) {
    return { collectedPrincipal: 0, overduePrincipal: 0, principalProfit: 0 }
  }

  let collectedPrincipal = 0
  let overduePrincipal = 0

  for (const order of Array.isArray(orders) ? orders : []) {
    const plan = Array.isArray(order && order.installmentPlan) ? order.installmentPlan : []
    for (const item of plan) {
      if (!item) {
        continue
      }
      const key = resolveInstallmentEffectiveDueDateKey(item, order)
      const principal = resolveInstallmentPrincipalAmount(item, order)
      if (installmentItemIsPaid(item) && key && key <= endKey) {
        collectedPrincipal += principal
      }
      else if (!installmentItemIsPaid(item) && key && key < endKey) {
        overduePrincipal += principal
      }
    }
  }

  const collected = roundMoney(collectedPrincipal)
  const overdue = roundMoney(overduePrincipal)
  return {
    collectedPrincipal: collected,
    overduePrincipal: overdue,
    principalProfit: roundMoney(collected - overdue),
  }
}

function computeRiskAdjustedRevenueThroughDate(orders, endDate) {
  const endKey = normalizeInstallmentDueDateKey(endDate)
  if (!endKey) {
    return { collectedAmount: 0, duePrincipal: 0, riskAdjustedRevenue: 0 }
  }

  let collectedAmount = 0
  let duePrincipal = 0

  for (const order of Array.isArray(orders) ? orders : []) {
    const plan = Array.isArray(order && order.installmentPlan) ? order.installmentPlan : []
    for (const item of plan) {
      if (!item) {
        continue
      }
      const key = resolveInstallmentEffectiveDueDateKey(item, order)
      if (!key || key > endKey) {
        continue
      }
      duePrincipal += resolveInstallmentPrincipalAmount(item, order)
      if (installmentItemIsPaid(item)) {
        collectedAmount += roundMoney(item.amount)
      }
    }
  }

  const collected = roundMoney(collectedAmount)
  const principal = roundMoney(duePrincipal)
  return {
    collectedAmount: collected,
    duePrincipal: principal,
    riskAdjustedRevenue: roundMoney(collected - principal),
  }
}

function collectOrderEffectiveDueDateBounds(order) {
  const plan = Array.isArray(order && order.installmentPlan) ? order.installmentPlan : []
  let minKey = ''
  let maxKey = ''
  for (const item of plan) {
    if (!item) {
      continue
    }
    const key = resolveInstallmentEffectiveDueDateKey(item, order)
    if (!key) {
      continue
    }
    if (!minKey || key < minKey) {
      minKey = key
    }
    if (!maxKey || key > maxKey) {
      maxKey = key
    }
  }
  return { minKey, maxKey }
}

function isOrderFullySettled(order) {
  const plan = Array.isArray(order && order.installmentPlan) ? order.installmentPlan : []
  return plan.length > 0 && plan.every(item => item && installmentItemIsPaid(item))
}

/** 截至 asOfDate：末次有效应还日不晚于 asOfDate 的订单中，全额结清订单占比。 */
function computeOrderSettlementRateOnDate(orders, asOfDate) {
  let maturedOrderCount = 0
  let settledOrderCount = 0
  for (const order of Array.isArray(orders) ? orders : []) {
    const { maxKey } = collectOrderEffectiveDueDateBounds(order)
    if (!maxKey || maxKey > asOfDate) {
      continue
    }
    maturedOrderCount += 1
    if (isOrderFullySettled(order)) {
      settledOrderCount += 1
    }
  }
  return {
    maturedOrderCount,
    settledOrderCount,
    settlementRateOnDate: maturedOrderCount > 0
      ? Number(((settledOrderCount / maturedOrderCount) * 100).toFixed(2))
      : 0,
  }
}

/**
 * 动态订单结清率：从首个有应还数据的日期到 endDate，对各日「已到期订单全额结清率」取算术平均。
 */
function computeDynamicOrderSettlementRate(orders, endDate) {
  const dueDates = collectReceivableDueDatesUpTo(orders, endDate)
  let rateSum = 0
  let dayCount = 0

  for (const d of dueDates) {
    const stats = computeOrderSettlementRateOnDate(orders, d)
    if (stats.maturedOrderCount <= 0) {
      continue
    }
    rateSum += stats.settlementRateOnDate
    dayCount += 1
  }

  return {
    dynamicSettledRate: dayCount > 0 ? Number((rateSum / dayCount).toFixed(2)) : 0,
    dynamicSettledDayCount: dayCount,
  }
}

/**
 * 动态待收逾期指标：从首个有应还数据的日期到 endDate，对各日「未还率 / 未还占当日应还」取算术平均。
 * 例：14 日未还率 24%、15 日 7.14%，则截至 15 日动态未还率 = (24 + 7.14) / 2。
 */
function computeDynamicPendingReceivableAverages(orders, endDate, options = {}) {
  const dueDates = collectReceivableDueDatesUpTo(orders, endDate, options)
  let rateSum = 0
  let amountSum = 0
  let shareSum = 0
  let dayCount = 0

  for (const d of dueDates) {
    const stats = computePendingReceivableStats(orders, d, options)
    if (stats.totalDueOnDateCount <= 0) {
      continue
    }
    rateSum += stats.unpaidRateOnDate
    amountSum += stats.unpaidDueOnDate
    if (stats.totalDueOnDate > 0) {
      shareSum += (stats.unpaidDueOnDate / stats.totalDueOnDate) * 100
    }
    dayCount += 1
  }

  return {
    dynamicUnpaidRate: dayCount > 0 ? Number((rateSum / dayCount).toFixed(2)) : 0,
    dynamicUnpaidAmount: dayCount > 0 ? roundMoney(amountSum / dayCount) : 0,
    dynamicUnpaidShareOfDue: dayCount > 0 ? Number((shareSum / dayCount).toFixed(2)) : 0,
    dynamicDayCount: dayCount,
  }
}

/** 单次聚合每日未还率，适合按渠道/小集合复用，口径与 dynamicUnpaidRate 一致 */
function computeDynamicUnpaidRateThroughDate(orders, endDate, options = {}) {
  const endKey = normalizeInstallmentDueDateKey(endDate)
  if (!endKey) {
    return { dynamicUnpaidRate: 0, dynamicDayCount: 0 }
  }
  const byDate = new Map()
  const ensureBucket = (key) => {
    if (!byDate.has(key)) {
      byDate.set(key, { total: 0, unpaid: 0 })
    }
    return byDate.get(key)
  }

  for (const order of Array.isArray(orders) ? orders : []) {
    const plan = Array.isArray(order && order.installmentPlan) ? order.installmentPlan : []
    for (const item of plan) {
      if (!item) {
        continue
      }
      const key = resolveInstallmentEffectiveDueDateKey(item, order)
      if (!key || key > endKey) {
        continue
      }
      const bucket = ensureBucket(key)
      bucket.total += 1
      if (!installmentItemIsPaid(item)) {
        bucket.unpaid += 1
      }
    }
  }

  const deferredAsCollectedEvents = collectRepaymentDisplayEvents(orders, options.deferredAsCollectedEvents)
  for (const event of deferredAsCollectedEvents) {
    if (!event || event.type !== DEFER_AS_COLLECTED_EVENT_TYPE) {
      continue
    }
    const statsDate = normalizeInstallmentDueDateKey(event.statsDate)
    if (!statsDate || statsDate > endKey) {
      continue
    }
    ensureBucket(statsDate).total += 1
  }

  let rateSum = 0
  let dayCount = 0
  for (const bucket of byDate.values()) {
    if (!bucket || bucket.total <= 0) {
      continue
    }
    rateSum += (bucket.unpaid / bucket.total) * 100
    dayCount += 1
  }

  return {
    dynamicUnpaidRate: dayCount > 0 ? Number((rateSum / dayCount).toFixed(2)) : 0,
    dynamicDayCount: dayCount,
  }
}

module.exports = {
  filterDueOnDateRowRefs,
  DEFER_AS_COLLECTED_EVENT_TYPE,
  computePendingReceivableStats,
  computeTotalOverdueAmount,
  computePrincipalSettlementThroughDate,
  computeRiskAdjustedRevenueThroughDate,
  computeOrderSettlementRateOnDate,
  computeDynamicOrderSettlementRate,
  computeDynamicPendingReceivableAverages,
  computeDynamicUnpaidRateThroughDate,
  collectReceivableDueDatesUpTo,
  installmentItemIsPaid,
  normalizeInstallmentDueDateKey,
  resolveInstallmentEffectiveDueDateKey,
  resolveInstallmentPrincipalAmount,
}
