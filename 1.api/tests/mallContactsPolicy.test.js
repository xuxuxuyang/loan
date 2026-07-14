const assert = require('node:assert/strict')
const test = require('node:test')

const {
  MALL_CONTACTS_ERROR_CODE,
  applyMallContactsUploadSummary,
  buildMallContactsStatus,
  markMallContactsRequiredForOrder,
  normalizeMallContactBatch,
  shouldBlockContractForMallContacts,
} = require('../src/mallContacts/policy')

test('marks only newly approved installment orders as requiring contacts before contract', () => {
  const now = '2026-06-26T10:00:00.000Z'
  const order = {
    id: 'O1001',
    payType: 'installment',
    status: 'shipping',
    cardPackageIssued: false,
    cardPackageContractSignedAt: '',
  }

  assert.equal(markMallContactsRequiredForOrder(order, now), true)
  assert.equal(order.mallContacts.requiredBeforeContract, true)
  assert.equal(order.mallContacts.requiredAt, now)
  assert.equal(order.mallContacts.uploadedAt, '')
  assert.equal(order.mallContacts.contactsCount, 0)

  assert.equal(markMallContactsRequiredForOrder({
    payType: 'full',
    status: 'shipping',
  }, now), false)
  assert.equal(markMallContactsRequiredForOrder({
    payType: 'installment',
    status: 'shipping',
    cardPackageIssued: true,
  }, now), false)
  assert.equal(markMallContactsRequiredForOrder({
    payType: 'installment',
    status: 'shipping',
    cardPackageContractSignedAt: now,
  }, now), false)
})

test('blocks contract flow only until a required order has completed contacts', () => {
  const order = {
    id: 'O1002',
    payType: 'installment',
    status: 'shipping',
    cardPackageIssued: false,
    cardPackageContractSignedAt: '',
  }
  markMallContactsRequiredForOrder(order, '2026-06-26T10:00:00.000Z')

  const blocked = shouldBlockContractForMallContacts(order)
  assert.equal(blocked.block, true)
  assert.equal(blocked.code, MALL_CONTACTS_ERROR_CODE)
  assert.match(blocked.msg, /App/)
  assert.doesNotMatch(blocked.msg, /安卓/)

  const user = { id: 'U1', phone: '13800138000' }
  applyMallContactsUploadSummary(order, user, {
    uploadId: 'MCU1',
    completedAt: '2026-06-26T10:05:00.000Z',
    contactsCount: 3,
  })

  const allowed = shouldBlockContractForMallContacts(order)
  assert.equal(allowed.block, false)
  assert.equal(order.mallContacts.uploadStatus, 'completed')
  assert.equal(order.mallContacts.snapshotId, 'MCU1')
  assert.equal(user.mallContacts.latestSnapshotId, 'MCU1')
})

test('does not block historical orders without the required marker', () => {
  const oldApprovedOrder = {
    id: 'O-HISTORY',
    payType: 'installment',
    status: 'shipping',
    cardPackageIssued: false,
    cardPackageContractSignedAt: '',
  }

  assert.equal(shouldBlockContractForMallContacts(oldApprovedOrder).block, false)
  assert.deepEqual(buildMallContactsStatus(oldApprovedOrder, null, null), {
    required: false,
    completed: false,
    uploadStatus: 'not_required',
    uploadedAt: '',
    contactsCount: 0,
    snapshotId: '',
  })
})

test('normalizes contacts for batch upload without storing unsupported heavy fields', () => {
  const batch = normalizeMallContactBatch([
    {
      contactId: 123,
      displayName: ' 张三 ',
      phones: [' 138 0013 8001 ', '13800138001', 'not-a-phone'],
      emails: ['ignored@example.com'],
      photo: 'large-base64-ignored',
      updatedAt: '2026-06-25T08:00:00.000Z',
    },
    {
      name: 'No phone',
      phones: [],
    },
    null,
  ])

  assert.deepEqual(batch, [{
    contactId: '123',
    displayName: '张三',
    phones: ['13800138001'],
    updatedAt: '2026-06-25T08:00:00.000Z',
  }])
})
