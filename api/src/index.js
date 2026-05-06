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

function buildInstallmentPlan(totalAmount, payType, createdAt, paid) {
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

  const periods = 12
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

function ensureOrderInstallmentPlan(order) {
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
  }
  db.users.unshift(nextUser)
  return nextUser
}

function attachUserOrderStats(db, user) {
  const userOrders = db.orders.filter(item => item.receiverPhone === user.phone)
  return {
    ...user,
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
  ctx.body = success({ status: 'up' })
})

router.post('/admin/reset-data', (ctx) => {
  const db = resetDb()
  ctx.body = success({
    products: db.products.length,
    orders: db.orders.length,
    users: db.users.length,
  })
})

router.get('/products', (ctx) => {
  const db = readDb()
  const { category = '' } = ctx.query
  const list = db.products.filter((item) => {
    if (!category || category === 'all') {
      return true
    }
    return item.category === category
  })
  ctx.body = success(list)
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
  })
})

router.get('/users', (ctx) => {
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
  const orders = db.orders
    .filter(item => item.receiverPhone === phone)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  orders.forEach((order) => {
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
  const availableQuota = Number(
    (20000 - totalPending).toFixed(2),
  )
  ctx.body = success({
    summary: {
      shouldRepay,
      availableQuota,
      billDate: '每月 08 日',
      minRepayment: Number((shouldRepay * 0.1).toFixed(2)),
    },
    list,
  })
})

router.patch('/users/:id', (ctx) => {
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

  writeDb(db)
  ctx.body = success(attachUserOrderStats(db, target))
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

router.post('/orders', (ctx) => {
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
    payChannel: payload.payChannel || 'wechat',
    receiverName: payload.receiverName || '匿名用户',
    receiverPhone: payload.receiverPhone || '',
    receiverAddress: payload.receiverAddress || '',
  }
  nextOrder.installmentPlan = buildInstallmentPlan(
    nextOrder.totalAmount,
    nextOrder.payType,
    nextOrder.createdAt,
    nextOrder.paid,
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
    target.status = status
  }
  writeDb(db)
  ctx.body = success(target)
})

app.use(cors())
app.use(bodyParser())
app.use(router.routes())
app.use(router.allowedMethods())

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Mall API listening on http://localhost:${PORT}/api`)
})
