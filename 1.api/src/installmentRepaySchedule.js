const INSTALLMENT_REPAY_DAYS_AFTER_CARD_ISSUE = 9

function formatDate(iso) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return String(iso || '')
  }
  const yyyy = date.getFullYear()
  const mm = `${date.getMonth() + 1}`.padStart(2, '0')
  const dd = `${date.getDate()}`.padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function addDays(iso, days) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  date.setDate(date.getDate() + Number(days || 0))
  return formatDate(date.toISOString())
}

function addMonths(iso, months) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  date.setMonth(date.getMonth() + months)
  return formatDate(date.toISOString())
}

function calculateInstallmentDueDateAfterCardIssue(repayAnchorAt) {
  const anchor = String(repayAnchorAt || '').trim()
  if (!anchor) {
    return ''
  }
  return addDays(anchor, INSTALLMENT_REPAY_DAYS_AFTER_CARD_ISSUE)
}

function installmentItemIsPaid(item) {
  return item && (item.paid === true || item.paid === 'true' || item.paid === 1 || item.paid === '1')
}

function installmentPlanItemHasNegotiationState(planItem) {
  if (!planItem) {
    return false
  }
  if (planItem.negotiationPayPending && Number(planItem.negotiationPayPending.negotiatedAmount || 0) > 0) {
    return true
  }
  return Array.isArray(planItem.negotiationHistory) && planItem.negotiationHistory.length > 0
}

function applyInstallmentDueDatesOnCardPackageIssue(order, issuedAt, options = {}) {
  if (!order || order.payType !== 'installment') {
    return false
  }
  const due = calculateInstallmentDueDateAfterCardIssue(issuedAt)
  if (!due) {
    return false
  }
  const plan = Array.isArray(order.installmentPlan) ? order.installmentPlan : []
  let changed = false
  for (const item of plan) {
    if (!item || installmentItemIsPaid(item) || installmentPlanItemHasNegotiationState(item)) {
      continue
    }
    if (options.onlyBlankDueDate && String(item.dueDate || '').trim()) {
      continue
    }
    if (item.dueDate !== due) {
      item.dueDate = due
      changed = true
    }
  }
  return changed
}

function buildInstallmentPlan(totalAmount, payType, repayAnchorAt, paid) {
  const parsedAmount = Number(totalAmount || 0)
  if (payType !== 'installment') {
    return [{
      period: 1,
      dueDate: addMonths(repayAnchorAt, 1),
      principal: parsedAmount,
      fee: 0,
      amount: parsedAmount,
      paid: Boolean(paid),
    }]
  }

  const principal = Number(parsedAmount.toFixed(2))
  return [{
    period: 1,
    dueDate: calculateInstallmentDueDateAfterCardIssue(repayAnchorAt),
    principal,
    fee: 0,
    amount: principal,
    paid: Boolean(paid),
  }]
}

module.exports = {
  INSTALLMENT_REPAY_DAYS_AFTER_CARD_ISSUE,
  calculateInstallmentDueDateAfterCardIssue,
  applyInstallmentDueDatesOnCardPackageIssue,
  buildInstallmentPlan,
}
