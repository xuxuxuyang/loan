const assert = require('assert')

function formatDate(iso) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return ''
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

const INSTALLMENT_REPAY_DAYS_AFTER_CARD_ISSUE = 14

function installmentDueDateFromRepayAnchor(repayAnchorAt) {
  const anchor = String(repayAnchorAt || '').trim()
  if (!anchor) {
    return ''
  }
  return addDays(anchor, INSTALLMENT_REPAY_DAYS_AFTER_CARD_ISSUE)
}

assert.equal(installmentDueDateFromRepayAnchor(''), '')
assert.equal(installmentDueDateFromRepayAnchor('2026-06-06T19:15:00.000Z'), addDays('2026-06-06T19:15:00.000Z', 14))
assert.equal(installmentDueDateFromRepayAnchor('2026-06-07T10:00:00.000Z'), '2026-06-21')

console.log('installment due date tests passed')
