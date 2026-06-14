const assert = require('node:assert/strict')
const test = require('node:test')

const {
  buildTrafficPartnerApprovedRowsForChannel,
  maskPhone,
} = require('../src/trafficPartnerApprovedRows')

test('masks traffic partner approved customer phones', () => {
  assert.equal(maskPhone('15112345617'), '151****5617')
  assert.equal(maskPhone('+86 151 1234 5617'), '151****5617')
  assert.equal(maskPhone('bad'), '')
})

test('lists only first-order issued card-package data for the requested channel', () => {
  const db = {
    users: [
      { id: 'u1', name: '张三', phone: '15112345617', registerChannelCode: 'ch-a' },
      { id: 'u2', name: '李四', phone: '13800008888', registerChannelCode: 'ch-a' },
      { id: 'u3', name: '王五', phone: '13900009999', registerChannelCode: 'ch-b' },
    ],
    orders: [
      {
        id: 'o-later',
        mallUserId: 'u1',
        createdAt: '2026-06-15T10:00:00',
        cardPackageIssued: true,
        cardPackageIssuedAt: '2026-06-15T11:00:00',
      },
      {
        id: 'o-first-issued',
        mallUserId: 'u1',
        createdAt: '2026-06-14T10:00:00',
        cardPackageIssued: true,
        cardPackageIssuedAt: '2026-06-14T12:30:00',
      },
      {
        id: 'o-pending',
        mallUserId: 'u2',
        createdAt: '2026-06-14T11:00:00',
        cardPackageIssued: false,
      },
      {
        id: 'o-other-channel',
        mallUserId: 'u3',
        createdAt: '2026-06-14T12:00:00',
        cardPackageIssued: true,
        cardPackageIssuedAt: '2026-06-14T13:00:00',
      },
    ],
  }

  assert.deepEqual(buildTrafficPartnerApprovedRowsForChannel(db, 'ch-a'), [
    {
      id: 'o-first-issued',
      issuedAt: '2026-06-14 12:30',
      name: '张三',
      phone: '151****5617',
      status: '已通过',
    },
  ])
})
