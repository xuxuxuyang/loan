const { resolveInstallmentEffectiveDueDateKey, installmentItemIsPaid } = require('./pendingReceivableStats')

function normalizeTodayKey(todayKey) {
  const s = String(todayKey || '').trim()
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : ''
}

/** 与管理端 orderRepayBucket / orderRepayBucketForAdmin 一致 */
function computeOrderRepayBucket(order, todayKey) {
  const plan = Array.isArray(order && order.installmentPlan) ? order.installmentPlan : []
  if (plan.length === 0) {
    return '已还款'
  }
  if (plan.every(p => p && installmentItemIsPaid(p))) {
    return '已还款'
  }
  const today = normalizeTodayKey(todayKey)
  for (const p of plan) {
    if (!p || installmentItemIsPaid(p)) {
      continue
    }
    const key = resolveInstallmentEffectiveDueDateKey(p, order)
    if (key && today && key < today) {
      return '已逾期'
    }
  }
  return '待还款'
}

function collectMallUserIdsForOverdueBlacklistScan(db) {
  const ids = new Set()
  for (const order of Array.isArray(db && db.orders) ? db.orders : []) {
    if (!order || !order.cardPackageIssued || order.payType !== 'installment') {
      continue
    }
    if (order.status === 'reviewing') {
      continue
    }
    const mid = String(order.mallUserId || '').trim()
    if (mid) {
      ids.add(mid)
    }
  }
  for (const user of Array.isArray(db && db.users) ? db.users : []) {
    if (!user) {
      continue
    }
    if (user.overdueAutoBlacklistSuppressed) {
      ids.add(String(user.id || '').trim())
    }
  }
  return ids
}

function mallUserHasOverdueRepayment(db, user, todayKey) {
  if (!user || !user.id) {
    return false
  }
  const uid = String(user.id).trim()
  if (!uid) {
    return false
  }
  for (const order of Array.isArray(db && db.orders) ? db.orders : []) {
    if (!order || String(order.mallUserId || '').trim() !== uid) {
      continue
    }
    if (!order.cardPackageIssued || order.payType !== 'installment') {
      continue
    }
    if (order.status === 'reviewing') {
      continue
    }
    if (computeOrderRepayBucket(order, todayKey) === '已逾期') {
      return true
    }
  }
  return false
}

/**
 * 逾期单向自动拉黑：仅从未拉黑且未人工解黑时写入；永不自动解黑。
 * @returns {boolean} 是否修改了 user 拉黑字段
 */
function syncMallUserOverdueBlacklist(db, user, todayKey) {
  if (!user) {
    return false
  }
  const overdue = mallUserHasOverdueRepayment(db, user, todayKey)
  let changed = false
  if (overdue) {
    if (!user.orderBlacklisted && !user.overdueAutoBlacklistSuppressed) {
      user.orderBlacklisted = true
      user.orderBlacklistedByOverdue = true
      changed = true
    }
  }
  else if (user.overdueAutoBlacklistSuppressed) {
    user.overdueAutoBlacklistSuppressed = false
    changed = true
  }
  return changed
}

/** @returns {boolean} 是否修改了任意用户 */
function reconcileOverdueUserBlacklistAcrossDb(db, todayKey) {
  const ids = collectMallUserIdsForOverdueBlacklistScan(db)
  let changed = false
  for (const id of ids) {
    if (!id) {
      continue
    }
    const user = (Array.isArray(db.users) ? db.users : []).find(u => u && String(u.id) === id)
    if (user && syncMallUserOverdueBlacklist(db, user, todayKey)) {
      changed = true
    }
  }
  return changed
}

module.exports = {
  computeOrderRepayBucket,
  mallUserHasOverdueRepayment,
  syncMallUserOverdueBlacklist,
  reconcileOverdueUserBlacklistAcrossDb,
}
