function normalizeYmd(raw) {
  const s = String(raw || '').trim()
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : ''
}

const DEFER_AS_COLLECTED_EVENT_TYPE = 'defer_as_collected'

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

function buildDeferRepaymentDisplayEvent(planItem, { orderId, period, fromDueDate, toDueDate, nowIso } = {}) {
  if (!planItem) {
    return null
  }
  const statsDate = normalizeYmd(fromDueDate)
  const nextDueDate = normalizeYmd(toDueDate)
  if (!statsDate || !nextDueDate || statsDate === nextDueDate) {
    return null
  }
  return {
    type: DEFER_AS_COLLECTED_EVENT_TYPE,
    orderId: String(orderId || '').trim(),
    period: Number(period),
    statsDate,
    fromDueDate: statsDate,
    toDueDate: nextDueDate,
    amountAtAction: Number(Number(planItem.amount || 0).toFixed(2)),
    createdAt: String(nowIso || new Date().toISOString()),
  }
}

function recordDeferRepaymentDisplayEvent(planItem, options = {}) {
  const event = buildDeferRepaymentDisplayEvent(planItem, options)
  if (!event) {
    return false
  }
  if (!Array.isArray(planItem.repaymentDisplayEvents)) {
    planItem.repaymentDisplayEvents = []
  }
  const exists = planItem.repaymentDisplayEvents.some(row => row
    && row.type === DEFER_AS_COLLECTED_EVENT_TYPE
    && normalizeYmd(row.statsDate) === event.statsDate
    && normalizeYmd(row.fromDueDate) === event.fromDueDate
    && normalizeYmd(row.toDueDate) === event.toDueDate
    && String(row.orderId || '').trim() === event.orderId
    && Number(row.period) === event.period)
  if (exists) {
    return false
  }
  planItem.repaymentDisplayEvents.push(event)
  return true
}

module.exports = {
  DEFER_AS_COLLECTED_EVENT_TYPE,
  resolveDeferRepaymentBaseDueDateKey,
  applyDeferRepaymentDueDate,
  buildDeferRepaymentDisplayEvent,
  recordDeferRepaymentDisplayEvent,
}
