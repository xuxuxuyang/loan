const { setError } = require('./auth')

const CONTACT_ELIGIBLE_STATUSES = new Set(['shipping', 'receiving', 'enjoying'])
const DEFAULT_BATCH_LIMIT = 200

function requireContactOrder(ctx, deps) {
  const db = deps.readDb()
  const user = deps.resolveUser(ctx, db)
  if (!user) {
    setError(ctx, 'UNAUTHORIZED', '请先登录后再操作', 401)
    return null
  }
  const orderId = String(ctx.params.orderId || '').trim()
  const order = (Array.isArray(db.orders) ? db.orders : []).find(item => String(item && item.id) === orderId)
  if (!order) {
    setError(ctx, 'ORDER_NOT_FOUND', '订单不存在', 404)
    return null
  }
  if (String(order.mallUserId || '') !== String(user.id || '')) {
    setError(ctx, 'FORBIDDEN', '订单不属于当前账号', 403)
    return null
  }
  if (order.payType !== 'installment') {
    setError(ctx, 'IOS_CONTACTS_NOT_APPLICABLE', '全款订单不需要上传通讯录')
    return null
  }
  if (!CONTACT_ELIGIBLE_STATUSES.has(String(order.status || ''))) {
    setError(ctx, 'ORDER_NOT_APPROVED', '订单审核通过后才能在合同签署前授权联系人')
    return null
  }
  if (String(order.cardPackageContractSignedAt || order.contractSignedAt || '').trim()) {
    setError(ctx, 'CONTRACT_ALREADY_SIGNED', '合同已签署，不能再次上传联系人')
    return null
  }
  return { db, user, order, orderId }
}

async function requireOwnedUpload(ctx, deps, resolved, uploadId) {
  const upload = await deps.contactsStore.getUpload(uploadId)
  if (!upload) {
    setError(ctx, 'CONTACT_UPLOAD_NOT_FOUND', '联系人上传会话不存在', 404)
    return null
  }
  if (String(upload.userId || '') !== String(resolved.user.id || '') || String(upload.orderId || '') !== resolved.orderId) {
    setError(ctx, 'FORBIDDEN', '联系人上传会话不属于当前账号或订单', 403)
    return null
  }
  return upload
}

function registerContactRoutes(router, deps) {
  router.post('/ios/orders/:orderId/contacts/upload/start', async (ctx) => {
    const resolved = requireContactOrder(ctx, deps)
    if (!resolved) return
    const body = ctx.request.body || {}
    const upload = await deps.contactsStore.startUpload({
      phone: deps.normalizePhone(resolved.user.phone),
      userId: resolved.user.id,
      orderId: resolved.orderId,
      totalContacts: Math.max(0, Number(body.totalContacts) || 0),
    })
    ctx.body = deps.success({ uploadId: upload.uploadId, status: upload.status, batchSizeLimit: DEFAULT_BATCH_LIMIT })
  })

  router.post('/ios/orders/:orderId/contacts/upload/batch', async (ctx) => {
    const resolved = requireContactOrder(ctx, deps)
    if (!resolved) return
    const body = ctx.request.body || {}
    const uploadId = String(body.uploadId || '').trim()
    if (!uploadId) {
      setError(ctx, 'CONTACT_UPLOAD_ID_REQUIRED', '缺少联系人上传会话编号')
      return
    }
    const contacts = Array.isArray(body.contacts) ? body.contacts : []
    if (contacts.length > DEFAULT_BATCH_LIMIT) {
      setError(ctx, 'CONTACT_BATCH_TOO_LARGE', `单批最多 ${DEFAULT_BATCH_LIMIT} 条联系人`, 413)
      return
    }
    if (!await requireOwnedUpload(ctx, deps, resolved, uploadId)) return
    const saved = await deps.contactsStore.saveBatch({ uploadId, batchIndex: body.batchIndex, contacts })
    ctx.body = deps.success({ uploadId, batchIndex: saved.batchIndex, savedCount: Array.isArray(saved.contacts) ? saved.contacts.length : 0 })
  })

  router.post('/ios/orders/:orderId/contacts/upload/complete', async (ctx) => {
    const resolved = requireContactOrder(ctx, deps)
    if (!resolved) return
    const body = ctx.request.body || {}
    const uploadId = String(body.uploadId || '').trim()
    if (!uploadId) {
      setError(ctx, 'CONTACT_UPLOAD_ID_REQUIRED', '缺少联系人上传会话编号')
      return
    }
    if (!await requireOwnedUpload(ctx, deps, resolved, uploadId)) return
    let completed
    try {
      completed = await deps.contactsStore.completeUpload({
        uploadId,
        expectedBatchCount: body.expectedBatchCount,
        dedupeByPhone: true,
      })
    }
    catch (error) {
      if (String(error && error.message || '') === 'contact_upload_empty') {
        setError(ctx, 'IOS_CONTACTS_REQUIRED', '至少选择一位包含有效手机号的联系人')
        return
      }
      throw error
    }
    deps.applyContactsSummary(resolved.order, resolved.user, completed)
    await deps.writeUsersAndOrders(resolved.db)
    await deps.flushPersist()
    ctx.body = deps.success({
      completed: true,
      contactsCount: Math.max(0, Number(completed.contactsCount) || 0),
      uploadedAt: String(completed.completedAt || ''),
    })
  })
}

module.exports = {
  CONTACT_ELIGIBLE_STATUSES,
  registerContactRoutes,
  requireContactOrder,
}
