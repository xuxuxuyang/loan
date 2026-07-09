const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')

const Koa = require('koa')
const Router = require('@koa/router')
const bodyParser = require('koa-bodyparser')

const { createMallContactsStore } = require('../src/mallContacts/store')
const { markMallContactsRequiredForOrder } = require('../src/mallContacts/policy')
const { registerMallContactsRoutes } = require('../src/mallContacts/router')

function success(data) {
  return { success: true, code: 0, msg: 'ok', data }
}

function fail(ctx, msg, code = 400) {
  ctx.status = code
  ctx.body = { success: false, code, msg, data: null }
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '')
}

function listen(app) {
  const server = http.createServer(app.callback())
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${address.port}`,
      })
    })
  })
}

test('contacts routes upload batches and unblock the pending contract order', async () => {
  const order = {
    id: 'O1',
    mallUserId: 'U1',
    payType: 'installment',
    status: 'shipping',
    cardPackageIssued: false,
    cardPackageContractSignedAt: '',
    createdAt: '2026-06-26T09:00:00.000Z',
  }
  markMallContactsRequiredForOrder(order, '2026-06-26T10:00:00.000Z')
  const db = {
    users: [{ id: 'U1', phone: '13800138000' }],
    orders: [order],
  }
  const persistedKeys = []

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mall-contacts-routes-'))
  const store = createMallContactsStore({
    jsonFile: path.join(dir, 'mallContacts.json'),
    mongo: { getMongoDb: () => null },
    idGenerator: () => 'MCU_ROUTE',
  })

  const app = new Koa()
  const router = new Router({ prefix: '/api' })
  app.use(bodyParser({ jsonLimit: '1mb' }))
  registerMallContactsRoutes(router, {
    contactsStore: store,
    fail,
    flushMongoPersist: async () => {},
    normalizePhone,
    readDb: () => db,
    success,
    writeDbPartial: (_db, keys) => persistedKeys.push(keys),
  })
  app.use(router.routes())
  app.use(router.allowedMethods())

  const { server, baseUrl } = await listen(app)
  try {
    const statusBefore = await fetch(`${baseUrl}/api/mall/contacts/status?phone=13800138000&orderId=O1`).then(r => r.json())
    assert.equal(statusBefore.success, true)
    assert.equal(statusBefore.data.required, true)
    assert.equal(statusBefore.data.completed, false)

    const started = await fetch(`${baseUrl}/api/mall/contacts/upload/start?phone=13800138000`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderId: 'O1', totalContacts: 2 }),
    }).then(r => r.json())
    assert.equal(started.success, true)
    assert.equal(started.data.uploadId, 'MCU_ROUTE')
    assert.equal(started.data.batchSizeLimit, 200)

    const batch = await fetch(`${baseUrl}/api/mall/contacts/upload/batch?phone=13800138000`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        uploadId: 'MCU_ROUTE',
        batchIndex: 0,
        contacts: [
          { displayName: '张三', phones: ['13800138001'] },
          { displayName: '李四', phones: ['13800138002'] },
        ],
      }),
    }).then(r => r.json())
    assert.equal(batch.success, true)
    assert.equal(batch.data.savedCount, 2)

    const completed = await fetch(`${baseUrl}/api/mall/contacts/upload/complete?phone=13800138000`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ uploadId: 'MCU_ROUTE', orderId: 'O1', expectedBatchCount: 1 }),
    }).then(r => r.json())
    assert.equal(completed.success, true)
    assert.equal(completed.data.completed, true)
    assert.equal(completed.data.contactsCount, 2)
    assert.equal(order.mallContacts.uploadStatus, 'completed')
    assert.equal(db.users[0].mallContacts.latestSnapshotId, 'MCU_ROUTE')
    assert.deepEqual(persistedKeys.at(-1), ['orders', 'users'])

    const pending = await fetch(`${baseUrl}/api/mall/contract-pending?phone=13800138000`).then(r => r.json())
    assert.equal(pending.success, true)
    assert.equal(pending.data.orderId, 'O1')
    assert.equal(pending.data.contacts.completed, true)
  }
  finally {
    server.close()
  }
})

test('contacts batch upload rejects upload ids that belong to another phone', async () => {
  const order = {
    id: 'O1',
    mallUserId: 'U1',
    payType: 'installment',
    status: 'shipping',
    cardPackageIssued: false,
    cardPackageContractSignedAt: '',
  }
  markMallContactsRequiredForOrder(order, '2026-06-26T10:00:00.000Z')
  const db = {
    users: [
      { id: 'U1', phone: '13800138000' },
      { id: 'U2', phone: '13900139000' },
    ],
    orders: [order],
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mall-contacts-routes-'))
  const store = createMallContactsStore({
    jsonFile: path.join(dir, 'mallContacts.json'),
    mongo: { getMongoDb: () => null },
    idGenerator: () => 'MCU_OWNER',
  })

  const app = new Koa()
  const router = new Router({ prefix: '/api' })
  app.use(bodyParser({ jsonLimit: '1mb' }))
  registerMallContactsRoutes(router, {
    contactsStore: store,
    fail,
    flushMongoPersist: async () => {},
    normalizePhone,
    readDb: () => db,
    success,
    writeDbPartial: () => {},
  })
  app.use(router.routes())
  app.use(router.allowedMethods())

  const { server, baseUrl } = await listen(app)
  try {
    await fetch(`${baseUrl}/api/mall/contacts/upload/start?phone=13800138000`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderId: 'O1', totalContacts: 1 }),
    }).then(r => r.json())

    const forbidden = await fetch(`${baseUrl}/api/mall/contacts/upload/batch?phone=13900139000`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        uploadId: 'MCU_OWNER',
        batchIndex: 0,
        contacts: [{ displayName: '张三', phones: ['13800138001'] }],
      }),
    })
    const body = await forbidden.json()
    assert.equal(forbidden.status, 403)
    assert.equal(body.success, false)
  }
  finally {
    server.close()
  }
})

test('admin contacts route pages a single upload contacts by upload id', async () => {
  const db = {
    users: [{ id: 'U1', phone: '13800138000' }],
    orders: [],
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mall-contacts-routes-'))
  const store = createMallContactsStore({
    jsonFile: path.join(dir, 'mallContacts.json'),
    mongo: { getMongoDb: () => null },
    idGenerator: () => 'MCU_ADMIN_PAGE',
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
    contacts: [
      { contactId: 'admin-1', displayName: 'Admin One', phones: ['13800138001'] },
      { contactId: 'admin-2', displayName: 'Admin Two', phones: ['13800138002'] },
    ],
    nowIso: '2026-06-26T10:01:00.000Z',
  })
  await store.saveBatch({
    uploadId: upload.uploadId,
    batchIndex: 1,
    contacts: [{ contactId: 'admin-3', displayName: 'Admin Three', phones: ['13800138003'] }],
    nowIso: '2026-06-26T10:02:00.000Z',
  })
  await store.completeUpload({
    uploadId: upload.uploadId,
    expectedBatchCount: 2,
    nowIso: '2026-06-26T10:03:00.000Z',
  })

  const app = new Koa()
  const router = new Router({ prefix: '/api' })
  app.use(bodyParser({ jsonLimit: '1mb' }))
  registerMallContactsRoutes(router, {
    contactsStore: store,
    fail,
    flushMongoPersist: async () => {},
    normalizePhone,
    readDb: () => db,
    success,
    writeDbPartial: () => {},
  })
  router.get('/users/:id/mall-contacts/:uploadId/contacts', async (ctx) => {
    const target = db.users.find(item => item.id === ctx.params.id)
    if (!target) {
      fail(ctx, 'user_not_found', 404)
      return
    }
    const result = await store.listCompletedUploadContacts({
      phone: normalizePhone(target.phone),
      uploadId: ctx.params.uploadId,
      page: Number(ctx.query.page || 1),
      pageSize: Number(ctx.query.pageSize || 20),
    })
    if (!result.upload) {
      fail(ctx, 'contacts_upload_not_found', 404)
      return
    }
    ctx.body = success(result)
  })
  app.use(router.routes())
  app.use(router.allowedMethods())

  const { server, baseUrl } = await listen(app)
  try {
    const page = await fetch(`${baseUrl}/api/users/U1/mall-contacts/MCU_ADMIN_PAGE/contacts?page=2&pageSize=2`).then(r => r.json())
    assert.equal(page.success, true)
    assert.equal(page.data.total, 3)
    assert.deepEqual(page.data.list.map(item => item.contactId), ['admin-3'])
  }
  finally {
    server.close()
  }
})

test('contacts complete rejects empty uploads without unblocking contract', async () => {
  const order = {
    id: 'O1',
    mallUserId: 'U1',
    payType: 'installment',
    status: 'shipping',
    cardPackageIssued: false,
    cardPackageContractSignedAt: '',
  }
  markMallContactsRequiredForOrder(order, '2026-06-26T10:00:00.000Z')
  const db = {
    users: [{ id: 'U1', phone: '13800138000' }],
    orders: [order],
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mall-contacts-routes-'))
  const store = createMallContactsStore({
    jsonFile: path.join(dir, 'mallContacts.json'),
    mongo: { getMongoDb: () => null },
    idGenerator: () => 'MCU_EMPTY_ROUTE',
  })

  const app = new Koa()
  const router = new Router({ prefix: '/api' })
  app.use(bodyParser({ jsonLimit: '1mb' }))
  registerMallContactsRoutes(router, {
    contactsStore: store,
    fail,
    flushMongoPersist: async () => {},
    normalizePhone,
    readDb: () => db,
    success,
    writeDbPartial: () => {
      throw new Error('empty contacts must not persist order state')
    },
  })
  app.use(router.routes())
  app.use(router.allowedMethods())

  const { server, baseUrl } = await listen(app)
  try {
    const started = await fetch(`${baseUrl}/api/mall/contacts/upload/start?phone=13800138000`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderId: 'O1', totalContacts: 0 }),
    }).then(r => r.json())

    const completed = await fetch(`${baseUrl}/api/mall/contacts/upload/complete?phone=13800138000`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ uploadId: started.data.uploadId, orderId: 'O1', expectedBatchCount: 0 }),
    })
    const body = await completed.json()

    assert.equal(completed.status, 400)
    assert.equal(body.success, false)
    assert.equal(order.mallContacts.uploadStatus, 'pending')
  }
  finally {
    server.close()
  }
})
