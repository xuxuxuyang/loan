const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { createMallContactsStore } = require('../src/mallContacts/store')

test('stores contact uploads as independent batch records in JSON fallback', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mall-contacts-'))
  const jsonFile = path.join(dir, 'mallContacts.json')
  const store = createMallContactsStore({
    jsonFile,
    mongo: { getMongoDb: () => null },
    idGenerator: () => 'MCU_FIXED',
  })

  const upload = await store.startUpload({
    phone: '13800138000',
    userId: 'U1',
    orderId: 'O1',
    totalContacts: 3,
    nowIso: '2026-06-26T10:00:00.000Z',
  })
  assert.equal(upload.uploadId, 'MCU_FIXED')
  assert.equal(upload.status, 'uploading')

  await store.saveBatch({
    uploadId: upload.uploadId,
    batchIndex: 0,
    contacts: [
      { displayName: '张三', phones: ['13800138001'] },
      { displayName: '李四', phones: ['13800138002'] },
    ],
    nowIso: '2026-06-26T10:01:00.000Z',
  })
  await store.saveBatch({
    uploadId: upload.uploadId,
    batchIndex: 1,
    contacts: [{ displayName: '王五', phones: ['13800138003'] }],
    nowIso: '2026-06-26T10:02:00.000Z',
  })

  const completed = await store.completeUpload({
    uploadId: upload.uploadId,
    expectedBatchCount: 2,
    nowIso: '2026-06-26T10:03:00.000Z',
  })

  assert.equal(completed.status, 'completed')
  assert.equal(completed.contactsCount, 3)
  assert.equal(completed.completedAt, '2026-06-26T10:03:00.000Z')

  const latest = await store.getLatestCompletedSummary({
    phone: '13800138000',
    orderId: 'O1',
  })
  assert.equal(latest.uploadId, 'MCU_FIXED')
  assert.equal(latest.contactsCount, 3)

  const raw = JSON.parse(fs.readFileSync(jsonFile, 'utf8'))
  assert.equal(raw.uploads.length, 1)
  assert.equal(raw.batches.length, 2)
  assert.equal(raw.batches[0].contacts.length, 2)
})

test('overwrites repeated batch indexes instead of duplicating contacts', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mall-contacts-'))
  const store = createMallContactsStore({
    jsonFile: path.join(dir, 'mallContacts.json'),
    mongo: { getMongoDb: () => null },
    idGenerator: () => 'MCU_RETRY',
  })

  const upload = await store.startUpload({
    phone: '13800138000',
    userId: 'U1',
    orderId: 'O1',
    nowIso: '2026-06-26T10:00:00.000Z',
  })
  await store.saveBatch({
    uploadId: upload.uploadId,
    batchIndex: 0,
    contacts: [{ displayName: '旧记录', phones: ['13800138001'] }],
    nowIso: '2026-06-26T10:01:00.000Z',
  })
  await store.saveBatch({
    uploadId: upload.uploadId,
    batchIndex: 0,
    contacts: [{ displayName: '新记录', phones: ['13800138009'] }],
    nowIso: '2026-06-26T10:02:00.000Z',
  })

  const completed = await store.completeUpload({
    uploadId: upload.uploadId,
    expectedBatchCount: 1,
    nowIso: '2026-06-26T10:03:00.000Z',
  })

  assert.equal(completed.contactsCount, 1)
  const raw = JSON.parse(fs.readFileSync(path.join(dir, 'mallContacts.json'), 'utf8'))
  assert.equal(raw.batches.length, 1)
  assert.equal(raw.batches[0].contacts[0].displayName, '新记录')
})

test('rejects completing uploads when no valid contacts were saved', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mall-contacts-'))
  const store = createMallContactsStore({
    jsonFile: path.join(dir, 'mallContacts.json'),
    mongo: { getMongoDb: () => null },
    idGenerator: () => 'MCU_EMPTY',
  })

  const upload = await store.startUpload({
    phone: '13800138000',
    userId: 'U1',
    orderId: 'O1',
    totalContacts: 0,
    nowIso: '2026-06-26T10:00:00.000Z',
  })

  await assert.rejects(
    () => store.completeUpload({
      uploadId: upload.uploadId,
      expectedBatchCount: 0,
      nowIso: '2026-06-26T10:03:00.000Z',
    }),
    /contact_upload_empty/,
  )

  const latest = await store.getLatestCompletedSummary({
    phone: '13800138000',
    orderId: 'O1',
  })
  assert.notEqual(latest && latest.status, 'completed')
  assert.equal(String(latest && latest.uploadId || ''), '')
})

test('lists latest completed contacts with pagination from JSON fallback', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mall-contacts-'))
  let nextId = 0
  const store = createMallContactsStore({
    jsonFile: path.join(dir, 'mallContacts.json'),
    mongo: { getMongoDb: () => null },
    idGenerator: () => `MCU_LIST_${nextId += 1}`,
  })

  const oldUpload = await store.startUpload({
    phone: '13800138000',
    userId: 'U1',
    orderId: 'OLD',
    totalContacts: 1,
    nowIso: '2026-06-26T09:00:00.000Z',
  })
  await store.saveBatch({
    uploadId: oldUpload.uploadId,
    batchIndex: 0,
    contacts: [{ contactId: 'old-1', displayName: 'Old Contact', phones: ['13800138001'] }],
    nowIso: '2026-06-26T09:01:00.000Z',
  })
  await store.completeUpload({
    uploadId: oldUpload.uploadId,
    expectedBatchCount: 1,
    nowIso: '2026-06-26T09:02:00.000Z',
  })

  const latestUpload = await store.startUpload({
    phone: '13800138000',
    userId: 'U1',
    orderId: 'NEW',
    totalContacts: 3,
    nowIso: '2026-06-26T10:00:00.000Z',
  })
  await store.saveBatch({
    uploadId: latestUpload.uploadId,
    batchIndex: 0,
    contacts: [
      { contactId: 'new-1', displayName: 'New One', phones: ['13800138011'] },
      { contactId: 'new-2', displayName: 'New Two', phones: ['13800138012'] },
    ],
    nowIso: '2026-06-26T10:01:00.000Z',
  })
  await store.saveBatch({
    uploadId: latestUpload.uploadId,
    batchIndex: 1,
    contacts: [{ contactId: 'new-3', displayName: 'New Three', phones: ['13800138013'] }],
    nowIso: '2026-06-26T10:02:00.000Z',
  })
  await store.completeUpload({
    uploadId: latestUpload.uploadId,
    expectedBatchCount: 2,
    nowIso: '2026-06-26T10:03:00.000Z',
  })

  const page = await store.listLatestCompletedContacts({
    phone: '13800138000',
    page: 2,
    pageSize: 2,
  })

  assert.equal(page.upload.uploadId, latestUpload.uploadId)
  assert.equal(page.upload.orderId, 'NEW')
  assert.equal(page.total, 3)
  assert.equal(page.page, 2)
  assert.equal(page.pageSize, 2)
  assert.deepEqual(page.list.map(item => item.contactId), ['new-3'])
})

test('lists completed contact uploads as separate order history records', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mall-contacts-'))
  let nextId = 0
  const store = createMallContactsStore({
    jsonFile: path.join(dir, 'mallContacts.json'),
    mongo: { getMongoDb: () => null },
    idGenerator: () => `MCU_HISTORY_${nextId += 1}`,
  })

  const first = await store.startUpload({
    phone: '13800138000',
    userId: 'U1',
    orderId: 'ORDER_A',
    nowIso: '2026-06-26T10:00:00.000Z',
  })
  await store.saveBatch({
    uploadId: first.uploadId,
    batchIndex: 0,
    contacts: [{ contactId: 'a-1', displayName: 'Order A Contact', phones: ['13800138001'] }],
    nowIso: '2026-06-26T10:01:00.000Z',
  })
  await store.completeUpload({
    uploadId: first.uploadId,
    expectedBatchCount: 1,
    nowIso: '2026-06-26T10:02:00.000Z',
  })

  const second = await store.startUpload({
    phone: '13800138000',
    userId: 'U1',
    orderId: 'ORDER_B',
    nowIso: '2026-06-26T11:00:00.000Z',
  })
  await store.saveBatch({
    uploadId: second.uploadId,
    batchIndex: 0,
    contacts: [{ contactId: 'b-1', displayName: 'Order B Contact', phones: ['13800138002'] }],
    nowIso: '2026-06-26T11:01:00.000Z',
  })
  await store.completeUpload({
    uploadId: second.uploadId,
    expectedBatchCount: 1,
    nowIso: '2026-06-26T11:02:00.000Z',
  })

  const history = await store.listCompletedContactUploads({
    phone: '13800138000',
    page: 1,
    pageSize: 10,
    contactsPreviewSize: 5,
  })

  assert.equal(history.total, 2)
  assert.deepEqual(history.records.map(item => item.upload.orderId), ['ORDER_B', 'ORDER_A'])
  assert.deepEqual(history.records.map(item => item.list[0].contactId), ['b-1', 'a-1'])
})

test('lists a completed upload contacts by upload id with pagination', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mall-contacts-'))
  let nextId = 0
  const store = createMallContactsStore({
    jsonFile: path.join(dir, 'mallContacts.json'),
    mongo: { getMongoDb: () => null },
    idGenerator: () => `MCU_PAGE_${nextId += 1}`,
  })

  const upload = await store.startUpload({
    phone: '13800138000',
    userId: 'U1',
    orderId: 'ORDER_PAGE',
    nowIso: '2026-06-26T10:00:00.000Z',
  })
  await store.saveBatch({
    uploadId: upload.uploadId,
    batchIndex: 0,
    contacts: [
      { contactId: 'page-1', displayName: 'Page One', phones: ['13800138001'] },
      { contactId: 'page-2', displayName: 'Page Two', phones: ['13800138002'] },
    ],
    nowIso: '2026-06-26T10:01:00.000Z',
  })
  await store.saveBatch({
    uploadId: upload.uploadId,
    batchIndex: 1,
    contacts: [{ contactId: 'page-3', displayName: 'Page Three', phones: ['13800138003'] }],
    nowIso: '2026-06-26T10:02:00.000Z',
  })
  await store.completeUpload({
    uploadId: upload.uploadId,
    expectedBatchCount: 2,
    nowIso: '2026-06-26T10:03:00.000Z',
  })

  const page = await store.listCompletedUploadContacts({
    phone: '13800138000',
    uploadId: upload.uploadId,
    page: 2,
    pageSize: 2,
  })

  assert.equal(page.upload.uploadId, upload.uploadId)
  assert.equal(page.total, 3)
  assert.equal(page.page, 2)
  assert.equal(page.pageSize, 2)
  assert.deepEqual(page.list.map(item => item.contactId), ['page-3'])

  const otherPhone = await store.listCompletedUploadContacts({
    phone: '13900139000',
    uploadId: upload.uploadId,
    page: 1,
    pageSize: 2,
  })
  assert.equal(otherPhone.upload, null)
  assert.equal(otherPhone.total, 0)
})

test('hides legacy completed uploads that have zero contacts', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mall-contacts-'))
  const jsonFile = path.join(dir, 'mallContacts.json')
  const store = createMallContactsStore({
    jsonFile,
    mongo: { getMongoDb: () => null },
  })

  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(jsonFile, JSON.stringify({
    uploads: [
      {
        uploadId: 'MCU_EMPTY_LEGACY',
        phone: '13800138000',
        userId: 'U1',
        orderId: 'ORDER_EMPTY',
        status: 'completed',
        contactsCount: 0,
        batchCount: 0,
        completedAt: '2026-06-26T12:00:00.000Z',
      },
      {
        uploadId: 'MCU_VALID',
        phone: '13800138000',
        userId: 'U1',
        orderId: 'ORDER_VALID',
        status: 'completed',
        contactsCount: 1,
        batchCount: 1,
        completedAt: '2026-06-26T11:00:00.000Z',
      },
    ],
    batches: [
      {
        id: 'MCU_VALID:0',
        uploadId: 'MCU_VALID',
        batchIndex: 0,
        contacts: [{ contactId: 'valid-1', displayName: 'Valid Contact', phones: ['13800138001'] }],
      },
    ],
  }, null, 2), 'utf8')

  const history = await store.listCompletedContactUploads({
    phone: '13800138000',
    page: 1,
    pageSize: 10,
    contactsPreviewSize: 5,
  })

  assert.equal(history.total, 1)
  assert.deepEqual(history.records.map(item => item.upload.orderId), ['ORDER_VALID'])
})
