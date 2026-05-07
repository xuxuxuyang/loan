const cloudConfig = require('./cloudConfig')
require('dotenv').config({ path: cloudConfig.resolveEnvPath() })

const mongo = require('./mongo')

const Koa = require('koa')
const Router = require('@koa/router')
const bodyParser = require('koa-bodyparser')
const cors = require('@koa/cors')
const { readDb, writeDb, resetDb } = require('./store')

const app = new Koa()
const router = new Router({ prefix: '/api' })
const PORT = Number(process.env.PORT || 3110)
const ADMIN_TEST_PHONE = '19900000000'
const ADMIN_TEST_VERIFY_CODE = '1234'
const PRODUCT_CATEGORIES = new Set(['travel', 'calligraphy', 'mobile', 'jewelry'])
const ADMIN_ROLES = {
  SUPER: 'super_admin',
  REVIEWER: 'reviewer',
  SERVICE: 'customer_service',
}
const ADMIN_ROLE_SET = new Set(Object.values(ADMIN_ROLES))
const DEFAULT_USER_QUOTA = 3000

function normalizeUserQuota(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) {
    return DEFAULT_USER_QUOTA
  }
  return Math.round(n)
}
const ENFORCE_ADMIN_RBAC = normalizeBoolean(process.env.ENFORCE_ADMIN_RBAC, false)
const ADMIN_ACCOUNT_STATUS_SET = new Set(['active', 'disabled'])

function success(data) {
  return { success: true, code: 0, msg: 'ok', data }
}

function formatDateTime(iso) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return iso
  }
  const yyyy = date.getFullYear()
  const mm = `${date.getMonth() + 1}`.padStart(2, '0')
  const dd = `${date.getDate()}`.padStart(2, '0')
  const hh = `${date.getHours()}`.padStart(2, '0')
  const min = `${date.getMinutes()}`.padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`
}

function formatDate(iso) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return String(iso || '')
  }
  const yyyy = date.getFullYear()
  const mm = `${date.getMonth() + 1}`.padStart(2, '0')
  const dd = `${date.getDate()}`.padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function addMonths(iso, months) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  date.setMonth(date.getMonth() + months)
  return formatDate(date.toISOString())
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase()
    if (lower === 'true' || lower === '1') return true
    if (lower === 'false' || lower === '0') return false
  }
  return fallback
}

function normalizeAdminRole(role) {
  const value = String(role || '').trim().toLowerCase()
  if (!value) return ''
  if (value === 'super_admin' || value === 'super-admin' || value === 'superadmin' || value === '超级管理员') {
    return ADMIN_ROLES.SUPER
  }
  if (value === 'reviewer' || value === 'auditor' || value === '审核员') {
    return ADMIN_ROLES.REVIEWER
  }
  if (value === 'customer_service' || value === 'customer-service' || value === 'customerservice' || value === '客服') {
    return ADMIN_ROLES.SERVICE
  }
  return ''
}

function getRoleLabel(role) {
  if (role === ADMIN_ROLES.SUPER) return '超级管理员'
  if (role === ADMIN_ROLES.REVIEWER) return '审核员'
  if (role === ADMIN_ROLES.SERVICE) return '客服'
  return '未知角色'
}

function parsePhoneFromToken(authorization) {
  const token = String(authorization || '').trim().replace(/^bearer\s+/i, '')
  if (!token.startsWith('mock-token-')) {
    return ''
  }
  return token.slice('mock-token-'.length)
}

function normalizeAdminAccount(account) {
  const now = new Date().toISOString()
  const role = normalizeAdminRole(account.role) || ADMIN_ROLES.SERVICE
  const status = ADMIN_ACCOUNT_STATUS_SET.has(String(account.status || '').trim()) ? String(account.status).trim() : 'active'
  return {
    id: String(account.id || `A${Date.now()}`),
    username: String(account.username || '').trim(),
    password: String(account.password || '1234'),
    role,
    name: String(account.name || '').trim() || getRoleLabel(role),
    phone: normalizePhone(account.phone || ''),
    status,
    createdAt: account.createdAt || now,
    updatedAt: account.updatedAt || account.createdAt || now,
  }
}

function ensureAdminAccounts(db) {
  if (!Array.isArray(db.adminAccounts)) {
    db.adminAccounts = []
  }
  db.adminAccounts = db.adminAccounts
    .map(normalizeAdminAccount)
    .filter(item => item.username)
}

function getAdminRoleByPhone(db, phone) {
  const target = db.adminAccounts.find(item => item.phone === phone && item.status === 'active')
  return target ? target.role : ''
}

function getAdminAccountByUsername(db, username) {
  const key = String(username || '').trim()
  return db.adminAccounts.find(item => item.username === key) || null
}

function resolveAdminRole(ctx) {
  if (ctx.state && ctx.state._resolvedAdminRole) {
    return ctx.state.adminRole || ''
  }
  const headerRole = normalizeAdminRole(ctx.headers['x-admin-role'] || ctx.headers['x-user-role'])
  if (headerRole) {
    ctx.state.adminRole = headerRole
    ctx.state._resolvedAdminRole = true
    return headerRole
  }

  const queryRole = normalizeAdminRole(ctx.query?.adminRole)
  if (queryRole) {
    ctx.state.adminRole = queryRole
    ctx.state._resolvedAdminRole = true
    return queryRole
  }

  const db = readDb()
  ensureAdminAccounts(db)

  const headerPhone = normalizePhone(ctx.headers['x-admin-phone'] || ctx.headers['x-user-phone'])
  const headerPhoneRole = headerPhone ? getAdminRoleByPhone(db, headerPhone) : ''
  if (headerPhoneRole) {
    ctx.state.adminRole = headerPhoneRole
    ctx.state._resolvedAdminRole = true
    return ctx.state.adminRole
  }

  const tokenPhone = normalizePhone(parsePhoneFromToken(ctx.headers.authorization))
  const tokenPhoneRole = tokenPhone ? getAdminRoleByPhone(db, tokenPhone) : ''
  if (tokenPhoneRole) {
    ctx.state.adminRole = tokenPhoneRole
    ctx.state._resolvedAdminRole = true
    return ctx.state.adminRole
  }

  // 兼容旧前端：未携带角色信息时默认超管；开启 ENFORCE_ADMIN_RBAC 后必须显式传入角色。
  ctx.state.adminRole = ENFORCE_ADMIN_RBAC ? '' : ADMIN_ROLES.SUPER
  ctx.state._resolvedAdminRole = true
  return ctx.state.adminRole
}

function requireAdminPermission(ctx, allowedRoles, actionLabel) {
  const role = resolveAdminRole(ctx)
  if (!role) {
    fail(
      ctx,
      `未提供后台角色信息，无法执行${actionLabel}。请在请求头传 x-admin-role: super_admin / reviewer / customer_service`,
      401,
    )
    return ''
  }
  if (!ADMIN_ROLE_SET.has(role) || !allowedRoles.includes(role)) {
    fail(ctx, `当前角色【${getRoleLabel(role)}】无权限执行${actionLabel}`, 403)
    return ''
  }
  return role
}

function normalizeProductRecord(product) {
  const now = new Date().toISOString()
  return {
    id: Number(product.id),
    name: String(product.name || '').trim(),
    subtitle: String(product.subtitle || '').trim(),
    description: String(product.description || '').trim(),
    origin: String(product.origin || '').trim(),
    price: Number(product.price || 0),
    image: String(product.image || '').trim(),
    category: PRODUCT_CATEGORIES.has(String(product.category || '').trim())
      ? String(product.category).trim()
      : 'travel',
    onSale: typeof product.onSale === 'boolean' ? product.onSale : true,
    createdAt: product.createdAt || now,
    updatedAt: product.updatedAt || product.createdAt || now,
  }
}

function parseProductPayload(payload, { partial = false } = {}) {
  const next = {}
  const textFields = ['name', 'subtitle', 'description', 'origin', 'image']
  textFields.forEach((field) => {
    if (payload[field] === undefined) return
    next[field] = String(payload[field] || '').trim()
  })
  const emptyField = textFields.find(field => payload[field] !== undefined && !next[field])
  if (emptyField) {
    return { error: '商品文本字段不能为空' }
  }

  if (payload.category !== undefined) {
    const category = String(payload.category || '').trim()
    if (!PRODUCT_CATEGORIES.has(category)) {
      return { error: '商品分类不正确' }
    }
    next.category = category
  }

  if (payload.price !== undefined) {
    const price = Number(payload.price)
    if (!Number.isFinite(price) || price <= 0) {
      return { error: '价格必须大于 0' }
    }
    next.price = Number(price.toFixed(2))
  }

  if (payload.onSale !== undefined) {
    next.onSale = normalizeBoolean(payload.onSale, true)
  }

  if (!partial) {
    const requiredText = ['name', 'subtitle', 'description', 'origin', 'image']
    const missing = requiredText.find(field => !next[field])
    if (missing) {
      return { error: '商品信息不完整，请补全名称、副标题、描述、产地和图片' }
    }
    if (!next.category) {
      return { error: '商品分类不正确' }
    }
    if (next.price === undefined) {
      return { error: '价格必须大于 0' }
    }
    if (next.onSale === undefined) {
      next.onSale = true
    }
  }

  return { data: next }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function mockRiskCheck({ totalAmount, installmentPeriods, receiverPhone }) {
  // 模拟风控接口调用耗时。
  await sleep(120)
  const base = Number(totalAmount || 0)
  const periods = Number(installmentPeriods || 12)
  const phoneTail = Number(String(receiverPhone || '').slice(-2) || '0')
  const score = Math.round(base / Math.max(1, periods)) + phoneTail
  const passed = score <= 2200
  return {
    status: passed ? 'passed' : 'failed',
    reason: passed ? '' : '风控评分未通过，请调整分期期数或更换商品后重试',
    checkedAt: new Date().toISOString(),
  }
}

function buildOrderRiskDetail(order) {
  ensureOrderRiskState(order)
  const totalAmount = Number(order.totalAmount || 0)
  const periods = Number(order.installmentPeriods || (Array.isArray(order.installmentPlan) ? order.installmentPlan.length : 12) || 12)
  const phoneTail = Number(String(order.receiverPhone || '').slice(-2) || '0')
  const baseScore = Math.round(totalAmount / Math.max(1, periods)) + phoneTail
  const riskScore = order.riskStatus === 'failed'
    ? Math.min(5000, baseScore + 420)
    : Math.max(300, baseScore - 180)
  const threshold = 2200
  const checkedAt = order.riskCheckedAt || order.createdAt || new Date().toISOString()
  const decision = order.riskStatus === 'failed' ? '拒绝' : '通过'
  const reason = order.riskStatus === 'failed'
    ? (order.riskReason || '风险评分超阈值，建议降低订单金额或调整分期期数')
    : '订单风险在可接受范围内'

  const rules = [
    {
      code: 'R001',
      name: '订单金额风险',
      hit: totalAmount >= 5000,
      scoreImpact: totalAmount >= 5000 ? 180 : 0,
      detail: `订单金额 ¥${totalAmount}，高金额订单会增加风险评分`,
    },
    {
      code: 'R002',
      name: '分期期数风险',
      hit: periods >= 12,
      scoreImpact: periods >= 12 ? 120 : 0,
      detail: `分期期数 ${periods} 期，期数越长违约不确定性越高`,
    },
    {
      code: 'R003',
      name: '手机号尾号特征',
      hit: phoneTail >= 70,
      scoreImpact: phoneTail >= 70 ? 60 : 0,
      detail: `手机号尾号 ${String(order.receiverPhone || '').slice(-2) || '--'} 参与辅助评分`,
    },
  ]

  const factors = [
    `订单金额：¥${totalAmount}`,
    `支付方式：${order.payType === 'installment' ? '分期' : '全款'}`,
    `分期期数：${periods} 期`,
    `手机号尾号：${String(order.receiverPhone || '').slice(-2) || '--'}`,
  ]

  return {
    orderId: order.id,
    riskStatus: order.riskStatus,
    decision,
    riskScore,
    threshold,
    checkedAt,
    reason,
    modelVersion: 'mock-risk-v1',
    factors,
    rules,
  }
}

function buildInstallmentPlan(totalAmount, payType, createdAt, paid, installmentPeriods) {
  const parsedAmount = Number(totalAmount || 0)
  if (payType !== 'installment') {
    return [{
      period: 1,
      dueDate: addMonths(createdAt, 1),
      principal: parsedAmount,
      fee: 0,
      amount: parsedAmount,
      paid: Boolean(paid),
    }]
  }

  const periods = [3, 6, 12].includes(Number(installmentPeriods))
    ? Number(installmentPeriods)
    : 12
  const feeRate = 0.02
  const principalPerPeriod = Number((parsedAmount / periods).toFixed(2))
  const feePerPeriod = Number((parsedAmount * feeRate / periods).toFixed(2))
  return Array.from({ length: periods }, (_, index) => {
    const period = index + 1
    return {
      period,
      dueDate: addMonths(createdAt, period),
      principal: principalPerPeriod,
      fee: feePerPeriod,
      amount: Number((principalPerPeriod + feePerPeriod).toFixed(2)),
      paid: Boolean(paid) && period === 1,
    }
  })
}

function ensureOrderRiskState(order) {
  if (order.payType !== 'installment') {
    if (!order.riskStatus) {
      order.riskStatus = 'passed'
      order.riskReason = ''
    }
    return
  }
  if (!order.riskStatus) {
    order.riskStatus = 'passed'
    order.riskReason = ''
  }
}

function ensureOrderInstallmentPlan(order) {
  ensureOrderRiskState(order)
  if (Array.isArray(order.installmentPlan) && order.installmentPlan.length > 0) {
    if (order.payType === 'installment' && order.paid) {
      const hasPaidPeriod = order.installmentPlan.some(item => item.paid)
      if (!hasPaidPeriod && order.installmentPlan[0]) {
        order.installmentPlan[0].paid = true
      }
    }
    return
  }
  order.installmentPlan = buildInstallmentPlan(
    order.totalAmount,
    order.payType,
    order.createdAt,
    order.paid,
    order.installmentPeriods,
  )
}

function fail(ctx, msg, code = 400) {
  ctx.status = code
  ctx.body = { success: false, code, msg, data: null }
}

function normalizePhone(phone) {
  const value = String(phone || '').trim()
  return value === 'admin' ? ADMIN_TEST_PHONE : value
}

function createAdminProfile() {
  return {
    id: `U${ADMIN_TEST_PHONE}`,
    name: '商城管理员',
    phone: ADMIN_TEST_PHONE,
    idCardFront: 'mock://admin/id-card-front',
    idCardBack: 'mock://admin/id-card-back',
    idCardHandheld: 'mock://admin/id-card-handheld',
    locationText: '广东省广州市天河区珠江新城（测试定位）',
    latitude: 23.119751,
    longitude: 113.327676,
    creditStatus: '良好',
    registerAt: new Date().toISOString(),
    quota: DEFAULT_USER_QUOTA,
  }
}

function upsertUserByPhone(db, payload) {
  const phone = normalizePhone(payload.phone)
  const existing = db.users.find(item => item.phone === phone)
  if (existing) {
    Object.assign(existing, {
      name: payload.name || existing.name,
      phone,
      idCardFront: payload.idCardFront || existing.idCardFront,
      idCardBack: payload.idCardBack || existing.idCardBack,
      idCardHandheld: payload.idCardHandheld || existing.idCardHandheld,
      locationText: payload.locationText || existing.locationText,
      latitude: typeof payload.latitude === 'number' ? payload.latitude : existing.latitude,
      longitude: typeof payload.longitude === 'number' ? payload.longitude : existing.longitude,
      creditStatus: payload.creditStatus || existing.creditStatus || '良好',
      quota: normalizeUserQuota(typeof payload.quota === 'undefined' ? existing.quota : payload.quota),
    })
    return existing
  }

  const nextUser = {
    id: `U${Date.now()}`,
    name: payload.name || '商城用户',
    phone,
    idCardFront: payload.idCardFront || '',
    idCardBack: payload.idCardBack || '',
    idCardHandheld: payload.idCardHandheld || '',
    locationText: payload.locationText || '',
    latitude: typeof payload.latitude === 'number' ? payload.latitude : 0,
    longitude: typeof payload.longitude === 'number' ? payload.longitude : 0,
    creditStatus: payload.creditStatus || '良好',
    registerAt: new Date().toISOString(),
    quota: normalizeUserQuota(payload.quota),
  }
  db.users.unshift(nextUser)
  return nextUser
}

function attachUserOrderStats(db, user) {
  const userOrders = db.orders.filter(item => item.receiverPhone === user.phone)
  return {
    ...user,
    quota: normalizeUserQuota(user.quota),
    orderCount: userOrders.length,
    totalAmount: Number(userOrders.reduce((sum, item) => sum + Number(item.totalAmount || 0), 0).toFixed(2)),
  }
}

function getUserPhone(ctx) {
  const phone = normalizePhone(ctx.query.phone)
  if (!/^1\d{10}$/.test(phone)) {
    return ''
  }
  return phone
}

function maskCardNo(cardNo) {
  const digits = String(cardNo || '').replace(/\D/g, '')
  const last4 = digits.slice(-4).padStart(4, '*')
  return `**** **** **** ${last4}`
}

function calcMySummary(db, phone) {
  const userOrders = db.orders.filter(item => item.receiverPhone === phone)
  const userAddresses = db.addresses.filter(item => item.userPhone === phone)
  const userCards = db.bankCards.filter(item => item.userPhone === phone)
  const defaultAddress = userAddresses.find(item => item.isDefault) || userAddresses[0]

  const orderCount = {
    reviewing: userOrders.filter(item => item.status === 'reviewing').length,
    shipping: userOrders.filter(item => item.status === 'shipping').length,
    receiving: userOrders.filter(item => item.status === 'receiving').length,
    enjoying: userOrders.filter(item => item.status === 'enjoying').length,
  }
  const currentMonth = formatDate(new Date().toISOString()).slice(0, 7)
  const billPendingAmount = Number(userOrders.reduce((sum, order) => {
    // 未审核通过（reviewing）订单不进入还款口径。
    if (order.status === 'reviewing') {
      return sum
    }
    ensureOrderInstallmentPlan(order)
    const monthRepay = order.installmentPlan
      .filter(plan => !plan.paid && String(plan.dueDate || '').startsWith(currentMonth))
      .reduce((subSum, plan) => subSum + Math.abs(Number(plan.amount || 0)), 0)
    return sum + monthRepay
  }, 0).toFixed(2))

  return {
    orderCount,
    bankCardCount: userCards.length,
    billPendingAmount,
    points: 1280 + userOrders.length * 10,
    couponCount: Math.max(0, 6 - userOrders.length),
    defaultAddress: defaultAddress
      ? `${defaultAddress.province}${defaultAddress.city}${defaultAddress.district}${defaultAddress.detail}`
      : '',
  }
}

router.get('/health', (ctx) => {
  ctx.body = success({
    status: 'up',
    hdCloud: cloudConfig.getCloudConfigSummary(),
    mongo: mongo.getMongoHealthSummary(),
  })
})

router.post('/admin/reset-data', (ctx) => {
  if (!requireAdminPermission(ctx, [ADMIN_ROLES.SUPER], '重置数据')) {
    return
  }
  const db = resetDb()
  ctx.body = success({
    products: db.products.length,
    orders: db.orders.length,
    users: db.users.length,
    adminAccounts: Array.isArray(db.adminAccounts) ? db.adminAccounts.length : 0,
  })
})

router.get('/products', (ctx) => {
  const db = readDb()
  const {
    category = '',
    keyword = '',
    includeAll = '',
  } = ctx.query
  const categoryKey = String(category || '').trim()
  const searchKey = String(keyword || '').trim()
  const showAll = includeAll === '1'
  const list = db.products
    .map(normalizeProductRecord)
    .filter((item) => {
      if (!showAll && !item.onSale) {
        return false
      }
      if (categoryKey && categoryKey !== 'all' && item.category !== categoryKey) {
        return false
      }
      if (!searchKey) {
        return true
      }
      return item.name.includes(searchKey) || item.subtitle.includes(searchKey) || item.origin.includes(searchKey)
    })
    .sort((a, b) => Number(b.id) - Number(a.id))
  ctx.body = success(list)
})

router.post('/products', (ctx) => {
  if (!requireAdminPermission(ctx, [ADMIN_ROLES.SUPER], '新增商品')) {
    return
  }
  const db = readDb()
  const payload = ctx.request.body || {}
  const parsed = parseProductPayload(payload)
  if (parsed.error) {
    fail(ctx, parsed.error)
    return
  }

  const now = new Date().toISOString()
  const maxId = db.products.reduce((max, item) => {
    const id = Number(item.id || 0)
    return id > max ? id : max
  }, 0)
  const nextProduct = normalizeProductRecord({
    ...parsed.data,
    id: maxId + 1,
    createdAt: now,
    updatedAt: now,
  })

  db.products = [nextProduct, ...db.products.map(normalizeProductRecord)]
  writeDb(db)
  ctx.body = success(nextProduct)
})

router.patch('/products/:id', (ctx) => {
  if (!requireAdminPermission(ctx, [ADMIN_ROLES.SUPER], '修改商品')) {
    return
  }
  const db = readDb()
  const { id } = ctx.params
  const payload = ctx.request.body || {}
  const parsed = parseProductPayload(payload, { partial: true })
  if (parsed.error) {
    fail(ctx, parsed.error)
    return
  }
  const targetIndex = db.products.findIndex(item => String(item.id) === String(id))
  if (targetIndex < 0) {
    fail(ctx, '商品不存在', 404)
    return
  }

  const prev = normalizeProductRecord(db.products[targetIndex])
  const merged = normalizeProductRecord({
    ...prev,
    ...parsed.data,
    updatedAt: new Date().toISOString(),
  })
  db.products[targetIndex] = merged
  db.products = db.products.map(normalizeProductRecord)
  writeDb(db)
  ctx.body = success(merged)
})

router.delete('/products/:id', (ctx) => {
  if (!requireAdminPermission(ctx, [ADMIN_ROLES.SUPER], '删除商品')) {
    return
  }
  const db = readDb()
  const { id } = ctx.params
  const target = db.products.find(item => String(item.id) === String(id))
  if (!target) {
    fail(ctx, '商品不存在', 404)
    return
  }
  db.products = db.products
    .map(normalizeProductRecord)
    .filter(item => String(item.id) !== String(id))
  writeDb(db)
  ctx.body = success({ id: Number(id) })
})

router.get('/products/:id', (ctx) => {
  const db = readDb()
  const { id } = ctx.params
  const target = db.products
    .map(normalizeProductRecord)
    .find(item => String(item.id) === String(id))
  if (!target) {
    fail(ctx, '商品不存在', 404)
    return
  }
  ctx.body = success(target)
})

router.post('/auth/register', (ctx) => {
  const db = readDb()
  const payload = ctx.request.body || {}
  const phone = normalizePhone(payload.phone)

  if (!/^1\d{10}$/.test(phone)) {
    fail(ctx, '手机号格式不正确')
    return
  }
  if (!String(payload.name || '').trim()) {
    fail(ctx, '姓名不能为空')
    return
  }

  const user = upsertUserByPhone(db, payload)
  writeDb(db)
  ctx.body = success(user)
})

router.post('/auth/login', (ctx) => {
  const db = readDb()
  ensureAdminAccounts(db)
  const payload = ctx.request.body || {}
  const phone = normalizePhone(payload.phone)
  const verifyCode = String(payload.verifyCode || '').trim()

  if (!/^1\d{10}$/.test(phone)) {
    fail(ctx, '手机号格式不正确')
    return
  }
  if (!verifyCode) {
    fail(ctx, '验证码不能为空')
    return
  }
  if (phone === ADMIN_TEST_PHONE && verifyCode !== ADMIN_TEST_VERIFY_CODE) {
    fail(ctx, `管理员测试账号验证码错误，请输入 ${ADMIN_TEST_VERIFY_CODE}`)
    return
  }

  let user = db.users.find(item => item.phone === phone)
  if (!user && phone === ADMIN_TEST_PHONE) {
    user = upsertUserByPhone(db, createAdminProfile())
    writeDb(db)
  }
  if (!user) {
    fail(ctx, '该手机号未注册，请先完成注册', 404)
    return
  }

  ctx.body = success({
    token: `mock-token-${phone}`,
    user,
    adminRole: getAdminRoleByPhone(db, phone) || '',
  })
})

function handleAdminLogin(ctx) {
  const db = readDb()
  ensureAdminAccounts(db)
  const payload = ctx.request.body || {}
  const username = String(payload.username || '').trim()
  const password = String(payload.password || '').trim()
  const account = getAdminAccountByUsername(db, username)
  if (!account || account.password !== password) {
    fail(ctx, '账号或密码错误', 401)
    return
  }
  if (account.status !== 'active') {
    fail(ctx, '账号已被禁用，请联系超级管理员', 403)
    return
  }

  const existed = db.users.find(item => item.phone === account.phone)
  if (!existed) {
    db.users.unshift({
      id: `U${account.phone}`,
      name: account.name,
      phone: account.phone,
      idCardFront: `mock://${username}/id-card-front`,
      idCardBack: `mock://${username}/id-card-back`,
      idCardHandheld: `mock://${username}/id-card-handheld`,
      locationText: '系统管理员账号',
      latitude: 0,
      longitude: 0,
      creditStatus: '良好',
      registerAt: new Date().toISOString(),
      quota: DEFAULT_USER_QUOTA,
    })
    writeDb(db)
  }

  ctx.body = success({
    username,
    token: `mock-token-${account.phone}`,
    adminRole: account.role,
    roleLabel: getRoleLabel(account.role),
  })
}

router.post('/admin/login', (ctx) => {
  handleAdminLogin(ctx)
})

// 兼容部分前端将后台登录请求到 /api/login 的场景。
router.post('/login', (ctx) => {
  handleAdminLogin(ctx)
})

function toAdminAccountView(account) {
  return {
    id: account.id,
    username: account.username,
    role: account.role,
    roleLabel: getRoleLabel(account.role),
    name: account.name,
    phone: account.phone,
    status: account.status,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  }
}

router.get('/admin/accounts', (ctx) => {
  if (!requireAdminPermission(ctx, [ADMIN_ROLES.SUPER], '查看后台账号')) {
    return
  }
  const db = readDb()
  ensureAdminAccounts(db)
  const list = db.adminAccounts
    .map(toAdminAccountView)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
  ctx.body = success(list)
})

router.post('/admin/accounts', (ctx) => {
  if (!requireAdminPermission(ctx, [ADMIN_ROLES.SUPER], '新增后台账号')) {
    return
  }
  const db = readDb()
  ensureAdminAccounts(db)
  const payload = ctx.request.body || {}
  const username = String(payload.username || '').trim()
  const password = String(payload.password || '').trim()
  const role = normalizeAdminRole(payload.role)
  const phone = normalizePhone(payload.phone)
  const name = String(payload.name || '').trim() || getRoleLabel(role)
  if (!/^[a-zA-Z][a-zA-Z0-9_]{3,20}$/.test(username)) {
    fail(ctx, '账号格式不正确，需4-21位字母数字下划线且以字母开头')
    return
  }
  if (password.length < 4) {
    fail(ctx, '密码长度至少为4位')
    return
  }
  if (![ADMIN_ROLES.REVIEWER, ADMIN_ROLES.SERVICE].includes(role)) {
    fail(ctx, '仅允许新增审核员或客服账号')
    return
  }
  if (!/^1\d{10}$/.test(phone)) {
    fail(ctx, '手机号格式不正确')
    return
  }
  if (db.adminAccounts.some(item => item.username === username)) {
    fail(ctx, '账号已存在', 409)
    return
  }
  if (db.adminAccounts.some(item => item.phone === phone)) {
    fail(ctx, '手机号已被后台账号占用', 409)
    return
  }
  const now = new Date().toISOString()
  const next = normalizeAdminAccount({
    id: `A${Date.now()}`,
    username,
    password,
    role,
    phone,
    name,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  })
  db.adminAccounts.unshift(next)
  writeDb(db)
  ctx.body = success(toAdminAccountView(next))
})

router.patch('/admin/accounts/:id', (ctx) => {
  if (!requireAdminPermission(ctx, [ADMIN_ROLES.SUPER], '修改后台账号')) {
    return
  }
  const db = readDb()
  ensureAdminAccounts(db)
  const { id } = ctx.params
  const payload = ctx.request.body || {}
  const target = db.adminAccounts.find(item => item.id === id)
  if (!target) {
    fail(ctx, '后台账号不存在', 404)
    return
  }
  if (target.username === 'admin' && payload.role && normalizeAdminRole(payload.role) !== ADMIN_ROLES.SUPER) {
    fail(ctx, '默认超级管理员账号角色不可修改')
    return
  }
  if (payload.role !== undefined) {
    const nextRole = normalizeAdminRole(payload.role)
    if (!nextRole) {
      fail(ctx, '角色不正确')
      return
    }
    target.role = nextRole
  }
  if (payload.status !== undefined) {
    const nextStatus = String(payload.status || '').trim()
    if (!ADMIN_ACCOUNT_STATUS_SET.has(nextStatus)) {
      fail(ctx, '账号状态不正确')
      return
    }
    if (target.username === 'admin' && nextStatus !== 'active') {
      fail(ctx, '默认超级管理员账号不可禁用')
      return
    }
    target.status = nextStatus
  }
  if (payload.password !== undefined) {
    const nextPassword = String(payload.password || '').trim()
    if (nextPassword.length < 4) {
      fail(ctx, '密码长度至少为4位')
      return
    }
    target.password = nextPassword
  }
  if (payload.name !== undefined) {
    target.name = String(payload.name || '').trim() || target.name
  }
  target.updatedAt = new Date().toISOString()
  writeDb(db)
  ctx.body = success(toAdminAccountView(target))
})

router.delete('/admin/accounts/:id', (ctx) => {
  if (!requireAdminPermission(ctx, [ADMIN_ROLES.SUPER], '删除后台账号')) {
    return
  }
  const db = readDb()
  ensureAdminAccounts(db)
  const { id } = ctx.params
  const target = db.adminAccounts.find(item => item.id === id)
  if (!target) {
    fail(ctx, '后台账号不存在', 404)
    return
  }
  if (target.username === 'admin') {
    fail(ctx, '默认超级管理员账号不可删除')
    return
  }
  db.adminAccounts = db.adminAccounts.filter(item => item.id !== id)
  writeDb(db)
  ctx.body = success({ id })
})

router.get('/users', (ctx) => {
  if (!requireAdminPermission(ctx, [ADMIN_ROLES.SUPER, ADMIN_ROLES.REVIEWER, ADMIN_ROLES.SERVICE], '查看用户列表')) {
    return
  }
  const db = readDb()
  const { keyword = '' } = ctx.query
  const key = String(keyword || '').trim()
  const users = db.users
    .filter((item) => {
      if (!key) return true
      return item.id.includes(key) || item.name.includes(key) || item.phone.includes(key)
    })
    .map(item => attachUserOrderStats(db, item))
  ctx.body = success(users)
})

router.get('/users/by-phone', (ctx) => {
  const db = readDb()
  const phone = normalizePhone(ctx.query.phone)
  const user = db.users.find(item => item.phone === phone) || null
  ctx.body = success(user ? attachUserOrderStats(db, user) : null)
})

router.post('/users', (ctx) => {
  if (!requireAdminPermission(ctx, [ADMIN_ROLES.SUPER], '新增用户')) {
    return
  }
  const db = readDb()
  const payload = ctx.request.body || {}
  const phone = normalizePhone(payload.phone)
  const name = String(payload.name || '').trim()
  const locationText = String(payload.locationText || '').trim()
  const creditStatus = String(payload.creditStatus || '良好').trim()
  const allowedCreditStatus = new Set(['优秀', '良好', '一般', '风险'])

  if (!/^1\d{10}$/.test(phone)) {
    fail(ctx, '手机号格式不正确')
    return
  }
  if (!name) {
    fail(ctx, '姓名不能为空')
    return
  }
  if (!allowedCreditStatus.has(creditStatus)) {
    fail(ctx, '信誉状态不正确')
    return
  }

  const duplicated = db.users.find(item => item.phone === phone)
  if (duplicated) {
    fail(ctx, '该手机号已存在', 409)
    return
  }

  const now = new Date().toISOString()
  const nextUser = {
    id: `U${phone}`,
    name,
    phone,
    idCardFront: String(payload.idCardFront || `mock://user/${phone}/id-card-front`),
    idCardBack: String(payload.idCardBack || `mock://user/${phone}/id-card-back`),
    idCardHandheld: String(payload.idCardHandheld || `mock://user/${phone}/id-card-handheld`),
    locationText,
    latitude: typeof payload.latitude === 'number' ? payload.latitude : 0,
    longitude: typeof payload.longitude === 'number' ? payload.longitude : 0,
    creditStatus,
    registerAt: now,
    quota: normalizeUserQuota(payload.quota),
  }
  db.users.unshift(nextUser)
  writeDb(db)
  ctx.body = success(attachUserOrderStats(db, nextUser))
})

router.get('/my/summary', (ctx) => {
  const db = readDb()
  const phone = getUserPhone(ctx)
  if (!phone) {
    fail(ctx, '手机号格式不正确')
    return
  }
  ctx.body = success(calcMySummary(db, phone))
})

router.get('/addresses', (ctx) => {
  const db = readDb()
  const phone = getUserPhone(ctx)
  if (!phone) {
    fail(ctx, '手机号格式不正确')
    return
  }
  const list = db.addresses
    .filter(item => item.userPhone === phone)
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || b.id - a.id)
  ctx.body = success(list)
})

router.post('/addresses', (ctx) => {
  const db = readDb()
  const payload = ctx.request.body || {}
  const phone = normalizePhone(payload.userPhone || payload.phone)
  if (!/^1\d{10}$/.test(phone)) {
    fail(ctx, '手机号格式不正确')
    return
  }
  if (!String(payload.receiver || '').trim()) {
    fail(ctx, '收货人不能为空')
    return
  }
  if (!/^1\d{10}$/.test(String(payload.phone || '').trim())) {
    fail(ctx, '收货手机号格式不正确')
    return
  }
  if (!String(payload.province || '').trim() || !String(payload.city || '').trim() || !String(payload.district || '').trim()) {
    fail(ctx, '省市区不能为空')
    return
  }
  if (!String(payload.detail || '').trim()) {
    fail(ctx, '详细地址不能为空')
    return
  }

  const nextAddress = {
    id: Date.now(),
    userPhone: phone,
    receiver: String(payload.receiver || '').trim(),
    phone: String(payload.phone || '').trim(),
    province: String(payload.province || '').trim(),
    city: String(payload.city || '').trim(),
    district: String(payload.district || '').trim(),
    detail: String(payload.detail || '').trim(),
    isDefault: Boolean(payload.isDefault),
    createdAt: new Date().toISOString(),
  }

  if (nextAddress.isDefault || !db.addresses.some(item => item.userPhone === phone)) {
    db.addresses = db.addresses.map(item => (item.userPhone === phone ? { ...item, isDefault: false } : item))
    nextAddress.isDefault = true
  }
  db.addresses.unshift(nextAddress)
  writeDb(db)
  ctx.body = success(nextAddress)
})

router.patch('/addresses/:id', (ctx) => {
  const db = readDb()
  const { id } = ctx.params
  const payload = ctx.request.body || {}
  const target = db.addresses.find(item => String(item.id) === String(id))
  if (!target) {
    fail(ctx, '地址不存在', 404)
    return
  }

  if (typeof payload.receiver === 'string' && payload.receiver.trim()) {
    target.receiver = payload.receiver.trim()
  }
  if (typeof payload.phone === 'string' && /^1\d{10}$/.test(payload.phone.trim())) {
    target.phone = payload.phone.trim()
  }
  if (typeof payload.province === 'string' && payload.province.trim()) {
    target.province = payload.province.trim()
  }
  if (typeof payload.city === 'string' && payload.city.trim()) {
    target.city = payload.city.trim()
  }
  if (typeof payload.district === 'string' && payload.district.trim()) {
    target.district = payload.district.trim()
  }
  if (typeof payload.detail === 'string' && payload.detail.trim()) {
    target.detail = payload.detail.trim()
  }
  if (typeof payload.isDefault === 'boolean') {
    if (payload.isDefault) {
      db.addresses = db.addresses.map(item => (
        item.userPhone === target.userPhone
          ? { ...item, isDefault: String(item.id) === String(id) }
          : item
      ))
    }
    else {
      target.isDefault = false
    }
  }

  writeDb(db)
  const latest = db.addresses.find(item => String(item.id) === String(id)) || target
  ctx.body = success(latest)
})

router.patch('/addresses/:id/default', (ctx) => {
  const db = readDb()
  const { id } = ctx.params
  const target = db.addresses.find(item => String(item.id) === String(id))
  if (!target) {
    fail(ctx, '地址不存在', 404)
    return
  }
  db.addresses = db.addresses.map(item => (
    item.userPhone === target.userPhone
      ? { ...item, isDefault: String(item.id) === String(id) }
      : item
  ))
  writeDb(db)
  const latest = db.addresses.find(item => String(item.id) === String(id))
  ctx.body = success(latest)
})

router.get('/bank-cards', (ctx) => {
  const db = readDb()
  const phone = getUserPhone(ctx)
  if (!phone) {
    fail(ctx, '手机号格式不正确')
    return
  }
  const list = db.bankCards
    .filter(item => item.userPhone === phone)
    .map(item => ({
      ...item,
      cardNoMasked: maskCardNo(item.cardNo),
    }))
  ctx.body = success(list)
})

router.post('/bank-cards', (ctx) => {
  const db = readDb()
  const payload = ctx.request.body || {}
  const phone = normalizePhone(payload.userPhone || payload.phone)
  const digits = String(payload.cardNo || '').replace(/\D/g, '')
  if (!/^1\d{10}$/.test(phone)) {
    fail(ctx, '手机号格式不正确')
    return
  }
  if (!String(payload.bankName || '').trim()) {
    fail(ctx, '银行名称不能为空')
    return
  }
  if (digits.length < 12 || digits.length > 19) {
    fail(ctx, '银行卡号格式不正确')
    return
  }
  if (!String(payload.owner || '').trim()) {
    fail(ctx, '持卡人不能为空')
    return
  }

  const nextCard = {
    id: Date.now(),
    userPhone: phone,
    bankName: String(payload.bankName || '').trim(),
    cardType: String(payload.cardType || '储蓄卡').trim() || '储蓄卡',
    cardNo: digits,
    owner: String(payload.owner || '').trim(),
    createdAt: new Date().toISOString(),
  }
  db.bankCards.unshift(nextCard)
  writeDb(db)
  ctx.body = success({
    ...nextCard,
    cardNoMasked: maskCardNo(nextCard.cardNo),
  })
})

router.get('/bills', (ctx) => {
  const db = readDb()
  const phone = getUserPhone(ctx)
  if (!phone) {
    fail(ctx, '手机号格式不正确')
    return
  }
  const list = []
  const loanOrders = db.orders
    .filter(item => item.receiverPhone === phone)
    .filter(item => item.payType === 'installment')
    // 仅展示已审核通过后的订单还款信息。
    .filter(item => item.status !== 'reviewing')
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  loanOrders.forEach((order) => {
    ensureOrderInstallmentPlan(order)
    order.installmentPlan.forEach((planItem) => {
      list.push({
        id: list.length + 1,
        userPhone: phone,
        title: order.payType === 'installment'
          ? `${order.name} 第${planItem.period}期 #${order.id}`
          : `${order.name} #${order.id}`,
        amount: -Math.abs(Number(planItem.amount || 0)),
        time: `${planItem.dueDate} 00:00`,
        status: planItem.paid ? '已还款' : '待还款',
      })
    })
  })
  list.sort((a, b) => String(b.time).localeCompare(String(a.time)))

  const currentMonth = formatDate(new Date().toISOString()).slice(0, 7)
  const shouldRepay = Number(
    list
      .filter(item => item.status === '待还款' && String(item.time).startsWith(currentMonth))
      .reduce((sum, item) => sum + Math.abs(Number(item.amount || 0)), 0)
      .toFixed(2),
  )
  const totalPending = Number(
    list
      .filter(item => item.status === '待还款')
      .reduce((sum, item) => sum + Math.abs(Number(item.amount || 0)), 0)
      .toFixed(2),
  )

  const baseQuota = 10000
  const availableQuota = Number(
    Math.max(0, baseQuota - totalPending).toFixed(2),
  )

  const latestLoanOrder = loanOrders[0]
  const latestLoanDate = latestLoanOrder ? new Date(latestLoanOrder.createdAt) : null
  const billDateDay = latestLoanDate && !Number.isNaN(latestLoanDate.getTime())
    ? `${latestLoanDate.getDate()}`.padStart(2, '0')
    : '08'
  ctx.body = success({
    summary: {
      shouldRepay,
      availableQuota,
      billDate: `每月 ${billDateDay} 日`,
      minRepayment: Number((shouldRepay * 0.1).toFixed(2)),
    },
    list,
  })
})

router.patch('/users/:id', (ctx) => {
  if (!requireAdminPermission(ctx, [ADMIN_ROLES.SUPER], '修改用户')) {
    return
  }
  const db = readDb()
  const { id } = ctx.params
  const payload = ctx.request.body || {}
  const target = db.users.find(item => item.id === id)

  if (!target) {
    fail(ctx, '用户不存在', 404)
    return
  }

  if (typeof payload.phone === 'string') {
    const phone = normalizePhone(payload.phone)
    if (!/^1\d{10}$/.test(phone)) {
      fail(ctx, '手机号格式不正确')
      return
    }
    const duplicated = db.users.find(item => item.phone === phone && item.id !== id)
    if (duplicated) {
      fail(ctx, '手机号已存在')
      return
    }
    target.phone = phone
  }
  if (typeof payload.name === 'string' && payload.name.trim()) {
    target.name = payload.name.trim()
  }
  if (typeof payload.locationText === 'string') {
    target.locationText = payload.locationText.trim()
  }
  if (typeof payload.creditStatus === 'string') {
    target.creditStatus = payload.creditStatus
  }
  if (typeof payload.idCardFront === 'string' && payload.idCardFront) {
    target.idCardFront = payload.idCardFront
  }
  if (typeof payload.idCardBack === 'string' && payload.idCardBack) {
    target.idCardBack = payload.idCardBack
  }
  if (typeof payload.idCardHandheld === 'string' && payload.idCardHandheld) {
    target.idCardHandheld = payload.idCardHandheld
  }
  if (typeof payload.latitude === 'number') {
    target.latitude = payload.latitude
  }
  if (typeof payload.longitude === 'number') {
    target.longitude = payload.longitude
  }
  if (typeof payload.quota !== 'undefined' && payload.quota !== null && payload.quota !== '') {
    const q = Number(payload.quota)
    if (!Number.isFinite(q) || q < 0) {
      fail(ctx, '额度必须为非负数')
      return
    }
    target.quota = Math.round(q)
  }

  writeDb(db)
  ctx.body = success(attachUserOrderStats(db, target))
})

router.delete('/users/:id', (ctx) => {
  if (!requireAdminPermission(ctx, [ADMIN_ROLES.SUPER], '删除用户')) {
    return
  }
  const db = readDb()
  const { id } = ctx.params
  const target = db.users.find(item => item.id === id)
  if (!target) {
    fail(ctx, '用户不存在', 404)
    return
  }

  db.users = db.users.filter(item => item.id !== id)
  // 用户删除后，同步清理地址和银行卡等账号附属数据。
  db.addresses = db.addresses.filter(item => item.userPhone !== target.phone)
  db.bankCards = db.bankCards.filter(item => item.userPhone !== target.phone)
  writeDb(db)
  ctx.body = success({ id, phone: target.phone })
})

router.get('/orders', (ctx) => {
  const db = readDb()
  const {
    keyword = '',
    status = '',
    adminStatus = '',
    payType = '',
    date = '',
  } = ctx.query

  const getAdminStatus = (item) => {
    ensureOrderRiskState(item)
    if (item.status === 'reviewing' && item.payType === 'installment') {
      return item.riskStatus === 'failed' ? '风控未通过' : '待审核'
    }
    if (item.status === 'reviewing' && !item.paid) {
      return '待付款'
    }
    if (item.status === 'reviewing' || item.status === 'shipping') {
      return '待发货'
    }
    if (item.status === 'receiving') {
      return '待收货'
    }
    return '已完成'
  }

  const list = db.orders.filter((item) => {
    ensureOrderInstallmentPlan(item)
    if (item.status !== 'reviewing' && !item.paid) {
      item.paid = true
    }
    const byKeyword = !keyword
      || item.id.includes(keyword)
      || item.name.includes(keyword)
      || item.receiverName.includes(keyword)
    const byStatus = !status || item.status === status
    const byAdminStatus = !adminStatus || getAdminStatus(item) === adminStatus
    const byPayType = !payType || item.payType === payType
    const byDate = !date || formatDateTime(item.createdAt).startsWith(String(date))
    return byKeyword && byStatus && byAdminStatus && byPayType && byDate
  })

  ctx.body = success(list)
})

router.get('/orders/:id/risk-detail', async (ctx) => {
  const db = readDb()
  const { id } = ctx.params
  const target = db.orders.find(item => item.id === id)
  if (!target) {
    fail(ctx, '订单不存在', 404)
    return
  }
  // 模拟本地风控服务调用耗时。
  await sleep(120)
  ctx.body = success(buildOrderRiskDetail(target))
})

router.post('/orders', async (ctx) => {
  const db = readDb()
  const payload = ctx.request.body || {}
  const nextOrder = {
    id: `OD${Date.now()}`,
    productId: payload.productId,
    name: payload.name,
    spec: payload.spec,
    totalAmount: payload.totalAmount,
    createdAt: new Date().toISOString(),
    status: payload.status || 'reviewing',
    paid: Boolean(payload.paid),
    payType: payload.payType || 'full',
    installmentPeriods: Number(payload.installmentPeriods) || 12,
    payChannel: payload.payChannel || 'wechat',
    receiverName: payload.receiverName || '匿名用户',
    receiverPhone: payload.receiverPhone || '',
    receiverAddress: payload.receiverAddress || '',
    riskStatus: 'passed',
    riskReason: '',
    riskCheckedAt: '',
  }
  if (nextOrder.payType === 'installment') {
    const riskResult = await mockRiskCheck(nextOrder)
    nextOrder.riskStatus = riskResult.status
    nextOrder.riskReason = riskResult.reason
    nextOrder.riskCheckedAt = riskResult.checkedAt
  }
  nextOrder.installmentPlan = buildInstallmentPlan(
    nextOrder.totalAmount,
    nextOrder.payType,
    nextOrder.createdAt,
    nextOrder.paid,
    nextOrder.installmentPeriods,
  )
  db.orders.unshift(nextOrder)
  writeDb(db)
  ctx.body = success(nextOrder)
})

router.patch('/orders/:id/pay', (ctx) => {
  const db = readDb()
  const { id } = ctx.params
  const payload = ctx.request.body || {}
  const target = db.orders.find(item => item.id === id)

  if (!target) {
    ctx.status = 404
    ctx.body = { success: false, code: 404, msg: '订单不存在', data: null }
    return
  }

  target.paid = true
  ensureOrderInstallmentPlan(target)
  if (target.payType === 'installment') {
    const firstPending = target.installmentPlan.find(item => !item.paid)
    if (firstPending) {
      firstPending.paid = true
    }
  }
  else {
    target.installmentPlan = target.installmentPlan.map(item => ({ ...item, paid: true }))
  }
  if (payload.payChannel) {
    target.payChannel = payload.payChannel
  }
  if (target.status === 'reviewing' && target.payType === 'full') {
    target.status = 'shipping'
  }
  writeDb(db)
  ctx.body = success(target)
})

router.patch('/orders/:id/installments/:period/pay', (ctx) => {
  const db = readDb()
  const { id, period } = ctx.params
  const payload = ctx.request.body || {}
  const target = db.orders.find(item => item.id === id)
  if (!target) {
    fail(ctx, '订单不存在', 404)
    return
  }

  const periodNumber = Number(period)
  if (!Number.isInteger(periodNumber) || periodNumber <= 0) {
    fail(ctx, '期数参数不正确')
    return
  }

  ensureOrderInstallmentPlan(target)
  const planItem = target.installmentPlan.find(item => item.period === periodNumber)
  if (!planItem) {
    fail(ctx, '分期记录不存在', 404)
    return
  }

  planItem.paid = Boolean(payload.paid)

  writeDb(db)
  ctx.body = success(target)
})

router.patch('/orders/:id/status', (ctx) => {
  const role = requireAdminPermission(ctx, [ADMIN_ROLES.SUPER, ADMIN_ROLES.REVIEWER], '审核订单')
  if (!role) {
    return
  }
  const db = readDb()
  const { id } = ctx.params
  const { status } = ctx.request.body || {}
  const target = db.orders.find(item => item.id === id)

  if (!target) {
    ctx.status = 404
    ctx.body = { success: false, code: 404, msg: '订单不存在', data: null }
    return
  }

  if (status) {
    if (role === ADMIN_ROLES.REVIEWER && status !== 'shipping') {
      fail(ctx, '审核员仅允许执行“审核通过（状态改为 shipping）”操作', 403)
      return
    }
    ensureOrderRiskState(target)
    if (status === 'shipping' && target.payType === 'installment' && target.riskStatus !== 'passed') {
      fail(ctx, '该订单风控未通过，不能审核通过')
      return
    }
    target.status = status
  }
  writeDb(db)
  ctx.body = success(target)
})

app.use(cors())
app.use(bodyParser())
app.use(router.routes())
app.use(router.allowedMethods())

;(async () => {
  try {
    await mongo.connectMongo()
  }
  catch (err) {
    console.warn('[mongo] 连接失败（当前仍使用本地 JSON 存储）:', err?.message || err)
  }

  app.listen(PORT, () => {
    console.log(`Mall API listening on http://localhost:${PORT}/api`)
  })
})()
