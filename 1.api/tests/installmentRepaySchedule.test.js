const assert = require('node:assert/strict')
const test = require('node:test')

const {
  calculateInstallmentDueDateAfterCardIssue,
  applyInstallmentDueDatesOnCardPackageIssue,
  buildInstallmentPlan,
} = require('../src/installmentRepaySchedule')

test('sets new card-package issue due date to the 10th day including issue date', () => {
  assert.equal(calculateInstallmentDueDateAfterCardIssue('2026-06-01T09:30:00.000Z'), '2026-06-10')
})

test('keeps unissued installment order due date empty', () => {
  const plan = buildInstallmentPlan(1200, 'installment', '', false)
  assert.equal(plan.length, 1)
  assert.equal(plan[0].dueDate, '')
})

test('does not rebuild or recalculate historical issued order that already has a due date', () => {
  const order = {
    payType: 'installment',
    cardPackageIssued: true,
    cardPackageIssuedAt: '2026-06-01T09:30:00.000Z',
    installmentPlan: [{ period: 1, dueDate: '2026-06-15', amount: 1200, paid: false }],
  }

  const changed = applyInstallmentDueDatesOnCardPackageIssue(order, order.cardPackageIssuedAt, { onlyBlankDueDate: true })

  assert.equal(changed, false)
  assert.equal(order.installmentPlan[0].dueDate, '2026-06-15')
})

test('does not overwrite paid or negotiated installments when applying issue due dates', () => {
  const order = {
    payType: 'installment',
    installmentPlan: [
      { period: 1, dueDate: '', amount: 100, paid: true },
      { period: 2, dueDate: '2026-06-20', amount: 100, paid: false, negotiationHistory: [{ negotiatedAmount: 50 }] },
      { period: 3, dueDate: '', amount: 100, paid: false, negotiationPayPending: { negotiatedAmount: 20 } },
      { period: 4, dueDate: '', amount: 100, paid: false },
    ],
  }

  const changed = applyInstallmentDueDatesOnCardPackageIssue(order, '2026-06-01T09:30:00.000Z')

  assert.equal(changed, true)
  assert.equal(order.installmentPlan[0].dueDate, '')
  assert.equal(order.installmentPlan[1].dueDate, '2026-06-20')
  assert.equal(order.installmentPlan[2].dueDate, '')
  assert.equal(order.installmentPlan[3].dueDate, '2026-06-10')
})
