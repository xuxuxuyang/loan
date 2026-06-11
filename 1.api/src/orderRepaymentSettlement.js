function installmentItemIsPaid(planItem) {
  if (!planItem || planItem.paid == null) {
    return false
  }
  const paid = planItem.paid
  return paid === true || paid === 1 || paid === '1' || paid === 'true'
}

function isInstallmentOrderFullyRepaid(order) {
  const plan = Array.isArray(order?.installmentPlan) ? order.installmentPlan : []
  if (plan.length === 0) {
    return true
  }
  return plan.every(item => item && installmentItemIsPaid(item))
}

function isMallOrderRepaymentSettled(order) {
  if (!order) {
    return true
  }
  if (order.payType === 'installment') {
    return isInstallmentOrderFullyRepaid(order)
  }
  return order.status === 'enjoying' || order.paid === true || order.paid === 1 || order.paid === '1' || order.paid === 'true'
}

function mallOrderRepaymentAwareStatus(order) {
  if (!order || order.payType !== 'installment') {
    return order?.status
  }
  if (order.status !== 'enjoying' || isMallOrderRepaymentSettled(order)) {
    return order.status
  }
  return String(order.trackingNumber || '').trim() ? 'receiving' : 'shipping'
}

function mallUserHasUnsettledOrder(db, user) {
  const userId = String(user?.id || '').trim()
  if (!userId) {
    return false
  }
  const orders = Array.isArray(db?.orders) ? db.orders : []
  return orders.some(order => String(order?.mallUserId || '').trim() === userId && !isMallOrderRepaymentSettled(order))
}

module.exports = {
  installmentItemIsPaid,
  isInstallmentOrderFullyRepaid,
  isMallOrderRepaymentSettled,
  mallOrderRepaymentAwareStatus,
  mallUserHasUnsettledOrder,
}
