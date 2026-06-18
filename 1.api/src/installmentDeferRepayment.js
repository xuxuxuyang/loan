function normalizeYmd(raw) {
  const s = String(raw || '').trim()
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : ''
}

/** 延期基准日：协商待支付时用协商还款日，否则用当前 dueDate（与待收/逾期有效还款日一致） */
function resolveDeferRepaymentBaseDueDateKey(planItem) {
  if (!planItem) {
    return ''
  }
  const pend = planItem.negotiationPayPending
  if (pend && Number(pend.negotiatedAmount || 0) > 0) {
    const fromPending = normalizeYmd(pend.remainderDueDate)
    if (fromPending) {
      return fromPending
    }
  }
  return normalizeYmd(planItem.dueDate)
}

/** 写入延期后的还款日：有待协商支付时同步 pending 与末条协商记录，否则只改 dueDate */
function applyDeferRepaymentDueDate(planItem, nextYmd) {
  const pend = planItem.negotiationPayPending
  if (pend && Number(pend.negotiatedAmount || 0) > 0) {
    pend.remainderDueDate = nextYmd
    const hist = planItem.negotiationHistory
    if (Array.isArray(hist) && hist.length > 0) {
      const last = hist[hist.length - 1]
      if (last) {
        last.remainderDueDate = nextYmd
      }
    }
    return
  }
  planItem.dueDate = nextYmd
}

module.exports = {
  resolveDeferRepaymentBaseDueDateKey,
  applyDeferRepaymentDueDate,
}
