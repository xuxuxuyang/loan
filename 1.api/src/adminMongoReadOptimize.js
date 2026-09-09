class MongoDirectReadError extends Error {
  constructor(cause) {
    super('Mongo direct read failed', { cause })
    this.name = 'MongoDirectReadError'
    this.code = 'MONGO_DIRECT_READ_FAILED'
    this.statusCode = 503
  }
}

function normalizePage(page) {
  return Math.max(1, parseInt(String(page || '1'), 10) || 1)
}

function normalizePageSize(pageSize) {
  return Math.min(100, Math.max(1, parseInt(String(pageSize || '20'), 10) || 20))
}

function normalizeDateFilter(date) {
  const raw = String(date || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return null
  }
  return { $gte: `${raw}T00:00:00.000Z`, $lt: `${raw}T23:59:59.999Z` }
}

function normalizeRegisterChannelFilter(value) {
  const raw = String(value || '').trim()
  return raw && raw !== '__all__' ? raw : ''
}

function mongoDocId(doc) {
  return String((doc && (doc.id || doc._id)) || '').trim()
}

function buildRegisterChannelUserFilter(registerChannel) {
  if (registerChannel === '__none__') {
    return {
      $or: [
        { registerChannelCode: { $exists: false } },
        { registerChannelCode: '' },
        { registerChannelCode: null },
      ],
    }
  }
  return { registerChannelCode: registerChannel }
}

async function resolveUserIdsByRegisterChannel(getCollection, registerChannel) {
  const users = getCollection('users')
  if (!users) return null
  const rows = await users.find(buildRegisterChannelUserFilter(registerChannel)).toArray()
  return [...new Set(rows.map(mongoDocId).filter(Boolean))]
}

function buildAdminOrderMongoFilter(filters = {}) {
  const keyword = String(filters.keyword || '').trim()
  const repay = String(filters.repay || '').trim()
  const adminStatus = String(filters.adminStatus || '').trim()
  if (keyword || (repay && repay !== '??') || adminStatus) {
    return null
  }

  const out = {}
  const scope = String(filters.scope || '').trim()
  const risk = String(filters.risk || '').trim()
  const status = String(filters.status || '').trim()
  const payType = String(filters.payType || '').trim()
  const dateFilter = normalizeDateFilter(filters.date)

  if (status) out.status = status
  if (payType) out.payType = payType
  if (dateFilter) out.createdAt = dateFilter

  if (scope === 'pending') {
    out.status = 'reviewing'
    out.payType = 'installment'
    out.riskStatus = risk === 'failed' ? 'failed' : { $ne: 'failed' }
    return out
  }

  if (scope === 'reviewed') {
    out.cardPackageIssued = { $ne: true }
    out.$or = [
      { status: { $ne: 'reviewing' } },
      { payType: { $ne: 'installment' } },
    ]
    return out
  }

  if (scope === 'card-data') {
    out.cardPackageIssued = true
    return out
  }

  if (risk === 'passed') out.riskStatus = { $ne: 'failed' }
  else if (risk === 'failed') out.riskStatus = 'failed'
  return out
}

async function readAdminOrdersPageFromMongoScoped(getCollection, filters, pageRaw, pageSizeRaw) {
  try {
    const filter = buildAdminOrderMongoFilter(filters)
    if (!filter) return null
    const page = normalizePage(pageRaw)
    const pageSize = normalizePageSize(pageSizeRaw)
    const registerChannel = normalizeRegisterChannelFilter(filters.registerChannel)
    if (registerChannel) {
      const userIds = await resolveUserIdsByRegisterChannel(getCollection, registerChannel)
      if (!Array.isArray(userIds)) return null
      if (!userIds.length) return { orders: [], total: 0, page, pageSize }
      filter.mallUserId = { $in: userIds }
    }
    const orders = getCollection('orders')
    if (!orders) return null
    const [total, list] = await Promise.all([
      orders.countDocuments(filter),
      orders.find(filter).sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).toArray(),
    ])
    return { orders: list, total, page, pageSize }
  }
  catch (error) {
    throw new MongoDirectReadError(error)
  }
}

async function countAdminOrderSidebarCountsFromMongoScoped(getCollection) {
  try {
    const orders = getCollection('orders')
    if (!orders) return null
    const [pendingReview, reviewedOrdersList] = await Promise.all([
      orders.countDocuments({ status: 'reviewing', payType: 'installment', riskStatus: { $ne: 'failed' } }),
      orders.countDocuments({
        cardPackageIssued: { $ne: true },
        $or: [
          { status: { $ne: 'reviewing' } },
          { payType: { $ne: 'installment' } },
        ],
      }),
    ])
    return { pendingReview, reviewedOrdersList }
  }
  catch (error) {
    throw new MongoDirectReadError(error)
  }
}

function buildAdminUserMongoFilter(query = {}) {
  const view = String(query.view || 'registered').trim() || 'registered'
  const key = String(query.key || '').trim()
  const registerChannel = String(query.registerChannel || '').trim()
  const orderDate = String(query.orderDate || '').trim()
  if (view !== 'registered' || key || orderDate) {
    return null
  }
  const out = {}
  if (registerChannel && registerChannel !== '__all__') {
    return null
  }
  return out
}

async function readAdminUsersPageFromMongoScoped(getCollection, query = {}) {
  try {
    const filter = buildAdminUserMongoFilter(query)
    if (!filter) return null
    const page = normalizePage(query.page)
    const pageSize = normalizePageSize(query.pageSize)
    const users = getCollection('users')
    if (!users) return null
    const [total, list] = await Promise.all([
      users.countDocuments(filter),
      users.find(filter).sort({ registerAt: -1, phone: 1 }).skip((page - 1) * pageSize).limit(pageSize).toArray(),
    ])
    return { users: list, total, page, pageSize }
  }
  catch (error) {
    throw new MongoDirectReadError(error)
  }
}

module.exports = {
  MongoDirectReadError,
  buildAdminOrderMongoFilter,
  buildAdminUserMongoFilter,
  readAdminOrdersPageFromMongoScoped,
  countAdminOrderSidebarCountsFromMongoScoped,
  readAdminUsersPageFromMongoScoped,
}
