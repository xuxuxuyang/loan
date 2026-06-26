const {
  applyMallContactsUploadSummary,
  buildMallContactsStatus,
} = require('./policy')

const DEFAULT_BATCH_SIZE_LIMIT = 200
const CARD_PACKAGE_ELIGIBLE_STATUSES = new Set(['shipping', 'receiving', 'enjoying'])

function positiveIntegerFromEnv(key, fallback) {
  const n = Number(process.env[key])
  return Number.isInteger(n) && n > 0 ? n : fallback
}

function getBatchSizeLimit() {
  return positiveIntegerFromEnv('MALL_CONTACTS_UPLOAD_BATCH_SIZE', DEFAULT_BATCH_SIZE_LIMIT)
}

function parsePhoneFromBearer(authorization) {
  const token = String(authorization || '').trim().replace(/^bearer\s+/i, '')
  return token.startsWith('mock-token-') ? token.slice('mock-token-'.length) : ''
}

function resolvePhone(ctx, normalizePhone) {
  const fromQuery = normalizePhone(ctx.query && ctx.query.phone)
  if (/^1\d{10}$/.test(fromQuery)) {
    return fromQuery
  }
  const fromToken = normalizePhone(parsePhoneFromBearer(ctx.headers && ctx.headers.authorization))
  return /^1\d{10}$/.test(fromToken) ? fromToken : ''
}

function findMallUserByPhone(db, phone, normalizePhone) {
  const users = Array.isArray(db && db.users) ? db.users : []
  return users.find(item => normalizePhone(item && item.phone) === phone) || null
}

function orderBelongsToUser(order, user) {
  const uid = String(user && user.id || '').trim()
  const mid = String(order && order.mallUserId || '').trim()
  return Boolean(uid && mid && uid === mid)
}

function findOwnedCardPackageOrder(db, user, orderId) {
  const id = String(orderId || '').trim()
  if (!id) {
    return null
  }
  const orders = Array.isArray(db && db.orders) ? db.orders : []
  const order = orders.find(item => String(item && item.id || '') === id) || null
  if (!order || !orderBelongsToUser(order, user)) {
    return null
  }
  if (!CARD_PACKAGE_ELIGIBLE_STATUSES.has(String(order.status || ''))) {
    return null
  }
  return order
}

function findPendingContractOrder(db, user) {
  const orders = Array.isArray(db && db.orders) ? db.orders : []
  return orders
    .filter(order => orderBelongsToUser(order, user))
    .filter(order => order && order.payType === 'installment')
    .filter(order => CARD_PACKAGE_ELIGIBLE_STATUSES.has(String(order.status || '')))
    .filter(order => !order.cardPackageIssued)
    .filter(order => !String(order.cardPackageContractSignedAt || '').trim())
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0] || null
}

async function requireOwnedUpload(ctx, deps, uploadId, phone, orderId = '') {
  if (typeof deps.contactsStore.getUpload !== 'function') {
    return null
  }
  const upload = await deps.contactsStore.getUpload(uploadId)
  if (!upload) {
    deps.fail(ctx, '通讯录上传会话不存在，请重新授权', 404)
    return null
  }
  if (String(upload.phone || '') !== phone) {
    deps.fail(ctx, '通讯录上传会话不属于当前账号', 403)
    return null
  }
  if (orderId && String(upload.orderId || '') !== String(orderId || '')) {
    deps.fail(ctx, '通讯录上传会话与当前订单不一致', 403)
    return null
  }
  return upload
}

function requireUserAndOrder(ctx, deps) {
  const phone = resolvePhone(ctx, deps.normalizePhone)
  if (!phone) {
    deps.fail(ctx, '手机号格式不正确', 400)
    return null
  }
  const db = deps.readDb()
  const user = findMallUserByPhone(db, phone, deps.normalizePhone)
  if (!user) {
    deps.fail(ctx, '请先登录后再操作', 401)
    return null
  }
  const orderId = String(
    (ctx.params && ctx.params.orderId)
      || (ctx.request && ctx.request.body && ctx.request.body.orderId)
      || (ctx.query && ctx.query.orderId)
      || '',
  ).trim()
  const order = findOwnedCardPackageOrder(db, user, orderId)
  if (!order) {
    deps.fail(ctx, '订单不存在或当前不可签署合同', 404)
    return null
  }
  return { db, phone, user, order, orderId }
}

function registerMallContactsRoutes(router, deps) {
  const requiredDeps = ['contactsStore', 'fail', 'normalizePhone', 'readDb', 'success', 'writeDbPartial']
  for (const key of requiredDeps) {
    if (!deps || !deps[key]) {
      throw new Error(`registerMallContactsRoutes missing dependency: ${key}`)
    }
  }
  const flushMongoPersist = typeof deps.flushMongoPersist === 'function' ? deps.flushMongoPersist : async () => {}

  router.get('/mall/contacts/status', async (ctx) => {
    const resolved = requireUserAndOrder(ctx, deps)
    if (!resolved) {
      return
    }
    const latest = await deps.contactsStore.getLatestCompletedSummary({
      phone: resolved.phone,
      orderId: resolved.orderId,
    })
    ctx.body = deps.success(buildMallContactsStatus(resolved.order, resolved.user, latest))
  })

  router.post('/mall/contacts/upload/start', async (ctx) => {
    const resolved = requireUserAndOrder(ctx, deps)
    if (!resolved) {
      return
    }
    const body = ctx.request && ctx.request.body && typeof ctx.request.body === 'object' ? ctx.request.body : {}
    const upload = await deps.contactsStore.startUpload({
      phone: resolved.phone,
      userId: resolved.user.id,
      orderId: resolved.orderId,
      totalContacts: body.totalContacts,
    })
    ctx.body = deps.success({
      uploadId: upload.uploadId,
      status: upload.status,
      batchSizeLimit: getBatchSizeLimit(),
    })
  })

  router.post('/mall/contacts/upload/batch', async (ctx) => {
    const phone = resolvePhone(ctx, deps.normalizePhone)
    if (!phone) {
      deps.fail(ctx, '手机号格式不正确', 400)
      return
    }
    const body = ctx.request && ctx.request.body && typeof ctx.request.body === 'object' ? ctx.request.body : {}
    const uploadId = String(body.uploadId || '').trim()
    const contacts = Array.isArray(body.contacts) ? body.contacts : []
    const limit = getBatchSizeLimit()
    if (!uploadId) {
      deps.fail(ctx, '缺少上传批次编号', 400)
      return
    }
    if (contacts.length > limit) {
      deps.fail(ctx, `单批通讯录最多 ${limit} 条，请分批上传`, 413)
      return
    }
    const upload = await requireOwnedUpload(ctx, deps, uploadId, phone)
    if (!upload) {
      return
    }
    const saved = await deps.contactsStore.saveBatch({
      uploadId,
      batchIndex: body.batchIndex,
      contacts,
    })
    ctx.body = deps.success({
      uploadId,
      batchIndex: saved.batchIndex,
      savedCount: Array.isArray(saved.contacts) ? saved.contacts.length : 0,
    })
  })

  router.post('/mall/contacts/upload/complete', async (ctx) => {
    const resolved = requireUserAndOrder(ctx, deps)
    if (!resolved) {
      return
    }
    const body = ctx.request && ctx.request.body && typeof ctx.request.body === 'object' ? ctx.request.body : {}
    const uploadId = String(body.uploadId || '').trim()
    if (!uploadId) {
      deps.fail(ctx, '缺少上传批次编号', 400)
      return
    }
    const upload = await requireOwnedUpload(ctx, deps, uploadId, resolved.phone, resolved.orderId)
    if (!upload) {
      return
    }
    let completed
    try {
      completed = await deps.contactsStore.completeUpload({
        uploadId,
        expectedBatchCount: body.expectedBatchCount,
      })
    }
    catch (err) {
      if (err && String(err.message || err) === 'contact_upload_empty') {
        deps.fail(ctx, '未获取到授权数据，请在 App 内完成授权后重试', 400)
        return
      }
      throw err
    }
    applyMallContactsUploadSummary(resolved.order, resolved.user, completed)
    deps.writeDbPartial(resolved.db, ['orders', 'users'])
    await flushMongoPersist()
    ctx.state.mongoPersistFlushed = true
    ctx.body = deps.success(buildMallContactsStatus(resolved.order, resolved.user, completed))
  })

  router.get('/mall/contract-pending', async (ctx) => {
    const phone = resolvePhone(ctx, deps.normalizePhone)
    if (!phone) {
      deps.fail(ctx, '手机号格式不正确', 400)
      return
    }
    const db = deps.readDb()
    const user = findMallUserByPhone(db, phone, deps.normalizePhone)
    if (!user) {
      ctx.body = deps.success(null)
      return
    }
    const order = findPendingContractOrder(db, user)
    if (!order) {
      ctx.body = deps.success(null)
      return
    }
    const latest = await deps.contactsStore.getLatestCompletedSummary({ phone, orderId: order.id })
    ctx.body = deps.success({
      orderId: order.id,
      status: order.status,
      contacts: buildMallContactsStatus(order, user, latest),
    })
  })
}

module.exports = {
  DEFAULT_BATCH_SIZE_LIMIT,
  findPendingContractOrder,
  registerMallContactsRoutes,
}
