const assert = require('node:assert/strict')
const test = require('node:test')

const {
  computeOrderRepayBucket,
  mallUserHasOverdueRepayment,
  syncMallUserOverdueBlacklist,
  reconcileOverdueUserBlacklistAcrossDb,
} = require('../src/overdueUserBlacklist')

test('computeOrderRepayBucket marks overdue when effective due date is before today', () => {
  const order = {
    payType: 'installment',
    cardPackageIssued: true,
    installmentPlan: [
      { period: 1, dueDate: '2026-06-15', amount: 2750, paid: false },
    ],
  }
  assert.equal(computeOrderRepayBucket(order, '2026-06-16'), '已逾期')
  assert.equal(computeOrderRepayBucket(order, '2026-06-15'), '待还款')
})

test('syncMallUserOverdueBlacklist auto blacklists but never auto unblacklists', () => {
  const db = {
    users: [{
      id: 'U1',
      orderBlacklisted: false,
      orderBlacklistedByOverdue: false,
    }],
    orders: [{
      mallUserId: 'U1',
      payType: 'installment',
      cardPackageIssued: true,
      status: 'enjoying',
      installmentPlan: [
        { period: 1, dueDate: '2026-06-15', amount: 2750, paid: false },
      ],
    }],
  }
  assert.equal(mallUserHasOverdueRepayment(db, db.users[0], '2026-06-16'), true)
  assert.equal(syncMallUserOverdueBlacklist(db, db.users[0], '2026-06-16'), true)
  assert.equal(db.users[0].orderBlacklisted, true)
  assert.equal(db.users[0].orderBlacklistedByOverdue, true)

  db.orders[0].installmentPlan[0].paid = true
  assert.equal(syncMallUserOverdueBlacklist(db, db.users[0], '2026-06-16'), false)
  assert.equal(db.users[0].orderBlacklisted, true)
  assert.equal(db.users[0].orderBlacklistedByOverdue, true)
})

test('manual unblacklist while overdue is not overwritten by auto sync', () => {
  const user = {
    id: 'U3',
    orderBlacklisted: false,
    orderBlacklistedByOverdue: false,
    overdueAutoBlacklistSuppressed: true,
  }
  const db = {
    users: [user],
    orders: [{
      mallUserId: 'U3',
      payType: 'installment',
      cardPackageIssued: true,
      status: 'enjoying',
      installmentPlan: [{ period: 1, dueDate: '2026-06-10', amount: 100, paid: false }],
    }],
  }
  assert.equal(syncMallUserOverdueBlacklist(db, user, '2026-06-16'), false)
  assert.equal(user.orderBlacklisted, false)
})

test('reconcileOverdueUserBlacklistAcrossDb scans card-package installment buyers', () => {
  const db = {
    users: [{ id: 'U2', orderBlacklisted: false, orderBlacklistedByOverdue: false }],
    orders: [{
      mallUserId: 'U2',
      payType: 'installment',
      cardPackageIssued: true,
      status: 'enjoying',
      installmentPlan: [{ period: 1, dueDate: '2026-06-10', amount: 100, paid: false }],
    }],
  }
  assert.equal(reconcileOverdueUserBlacklistAcrossDb(db, '2026-06-16'), true)
  assert.equal(db.users[0].orderBlacklisted, true)
})
