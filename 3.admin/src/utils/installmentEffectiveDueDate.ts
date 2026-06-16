type DueDateCarrier = {
  dueDate?: string
  negotiationPayPending?: {
    negotiatedAmount?: number
    remainderDueDate?: string
  } | null
}

function normalizeYmd(raw: string | undefined | null): string {
  const s = String(raw || '').trim()
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : ''
}

/** 展示/筛选用有效还款日：协商待支付时以协商还款日为准，否则以 dueDate（含延期后）为准 */
export function resolveInstallmentEffectiveDueDate(plan: DueDateCarrier | undefined | null): string {
  if (!plan) {
    return ''
  }
  const pend = plan.negotiationPayPending
  if (pend && Number(pend.negotiatedAmount || 0) > 0) {
    const negotiated = normalizeYmd(pend.remainderDueDate)
    if (negotiated) {
      return negotiated
    }
  }
  return normalizeYmd(plan.dueDate) || String(plan.dueDate || '').trim()
}

/** 协商记录展示：剩余未还以本期应还为准（延期费模型，不展示扣减后金额） */
export function resolveNegotiateRemainderAmountForDisplay(
  plan: { amount?: number },
  storedRemainder?: number,
): number {
  const cur = Number(Number(plan.amount || 0).toFixed(2))
  if (cur > 0) {
    return cur
  }
  return Number(Number(storedRemainder || 0).toFixed(2))
}
