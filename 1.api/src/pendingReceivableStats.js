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

function roundMoney(value) {
  return Number(Number(value || 0).toFixed(2))
}

function computePendingReceivableStats(orders, dueDate) {
  const rowRefs = []
  let totalDueOnDate = 0
  let paidDueOnDate = 0
  let unpaidDueOnDate = 0
  let totalDueOnDateCount = 0
  let paidDueOnDateCount = 0
  let unpaidDueOnDateCount = 0
  let overdueBeforeDateCount = 0
  let unpaidDueOnOrBeforeDateCount = 0

  for (const order of Array.isArray(orders) ? orders : []) {
    const plan = Array.isArray(order && order.installmentPlan) ? order.installmentPlan : []
    for (const item of plan) {
      if (!item) {
        continue
      }
      const key = normalizeInstallmentDueDateKey(item.dueDate)
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
      if (!paid && key === dueDate) {
        rowRefs.push({ order, item, key })
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
    totalAmount: roundMoney(unpaidDueOnDate),
    totalDueOnDate: roundMoney(totalDueOnDate),
    paidDueOnDate: roundMoney(paidDueOnDate),
    unpaidDueOnDate: roundMoney(unpaidDueOnDate),
    totalDueOnDateCount,
    paidDueOnDateCount,
    unpaidDueOnDateCount,
    collectionRateOnDate,
    unpaidRateOnDate,
    overdueRateAsOfDate,
    overdueBeforeDateCount,
    unpaidDueOnOrBeforeDateCount,
  }
}

module.exports = {
  computePendingReceivableStats,
  installmentItemIsPaid,
  normalizeInstallmentDueDateKey,
}
