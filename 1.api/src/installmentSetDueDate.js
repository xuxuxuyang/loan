function normalizeYmd(raw) {
  const s = String(raw || '').trim()
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : ''
}

function hasNegotiatedRepaymentDueDateTarget(planItem) {
  if (!planItem) {
    return false
  }
  const hist = planItem.negotiationHistory
  if (Array.isArray(hist) && hist.length > 0) {
    return true
  }
  const pend = planItem.negotiationPayPending
  return !!(pend && Number(pend.negotiatedAmount || 0) > 0)
}

/**
 * 修改协商还款日（remainderDueDate）：同步 pending 与末条协商记录；
 * 若协商支付已完成（userPaidAt），同步 dueDate 为新的实际还款截止日；不改动 originalDueDate。
 */
function applyNegotiatedRepaymentDueDate(planItem, dueDate) {
  if (!planItem) {
    return { ok: false, error: '分期记录不存在' }
  }
  const nextYmd = normalizeYmd(dueDate)
  if (!nextYmd || !/^\d{4}-\d{2}-\d{2}$/.test(nextYmd)) {
    return { ok: false, error: '还款日格式无效' }
  }
  if (!hasNegotiatedRepaymentDueDateTarget(planItem)) {
    return { ok: false, error: '当前期无协商记录，无法修改协商还款日' }
  }

  const pend = planItem.negotiationPayPending
  if (pend && Number(pend.negotiatedAmount || 0) > 0) {
    pend.remainderDueDate = nextYmd
  }

  const hist = planItem.negotiationHistory
  let last = null
  if (Array.isArray(hist) && hist.length > 0) {
    last = hist[hist.length - 1]
    if (last) {
      last.remainderDueDate = nextYmd
    }
  }

  if (last && last.userPaidAt) {
    planItem.dueDate = nextYmd
  }

  return { ok: true, dueDate: nextYmd }
}

function isDueDateOnOrAfterToday(dueDate, todayKey) {
  const ymd = normalizeYmd(dueDate)
  const today = normalizeYmd(todayKey)
  if (!ymd || !today) {
    return false
  }
  return ymd >= today
}

module.exports = {
  normalizeYmd,
  hasNegotiatedRepaymentDueDateTarget,
  applyNegotiatedRepaymentDueDate,
  isDueDateOnOrAfterToday,
}
