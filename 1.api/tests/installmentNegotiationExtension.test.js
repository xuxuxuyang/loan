const assert = require('node:assert/strict')
const test = require('node:test')

function negotiateExtensionFeeRemainderAmount(planItem) {
  return Number(Number(planItem && planItem.amount != null ? planItem.amount : 0).toFixed(2))
}

function applyInstallmentNegotiationPayCompleted(planItem) {
  const pend = planItem.negotiationPayPending
  if (!pend || !Number.isFinite(Number(pend.negotiatedAmount)) || Number(pend.negotiatedAmount) <= 0) {
    return { ok: false, msg: '暂无待支付的协商款项' }
  }
  const remainderDue = String(pend.remainderDueDate || '').trim().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(remainderDue)) {
    return { ok: false, msg: '协商待支付数据异常，请联系客服' }
  }
  const hist = planItem.negotiationHistory
  const last = Array.isArray(hist) && hist.length > 0 ? hist[hist.length - 1] : null
  planItem.dueDate = remainderDue
  planItem.negotiationPayPending = null
  if (last) {
    last.userPaidAt = new Date().toISOString()
  }
  return { ok: true }
}

test('negotiate registration keeps remainder equal to installment amount', () => {
  const curAmount = 2750
  const nAmt = 500
  const remainder = negotiateExtensionFeeRemainderAmount({ amount: curAmount })
  assert.equal(remainder, curAmount)
  assert.notEqual(remainder, curAmount - nAmt)
})

test('paying extension fee updates due date without reducing installment amount', () => {
  const planItem = {
    amount: 2750,
    principal: 2750,
    dueDate: '2026-06-15',
    negotiationPayPending: {
      negotiatedAmount: 500,
      remainderAmount: 2750,
      remainderDueDate: '2026-06-25',
    },
    negotiationHistory: [{
      negotiatedAmount: 500,
      remainderAmount: 2750,
      remainderDueDate: '2026-06-25',
      createdAt: '2026-06-15T09:04:00.000Z',
    }],
  }
  const applied = applyInstallmentNegotiationPayCompleted(planItem)
  assert.equal(applied.ok, true)
  assert.equal(planItem.amount, 2750)
  assert.equal(planItem.principal, 2750)
  assert.equal(planItem.dueDate, '2026-06-25')
  assert.equal(planItem.negotiationPayPending, null)
  assert.ok(planItem.negotiationHistory[0].userPaidAt)
})
