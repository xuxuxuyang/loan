const { loadDotenvExports } = require('./loadEnv')
loadDotenvExports(__dirname)

const cloudConfig = require('./cloudConfig')
const mongoConfig = require('./mongoConfig')
const mongo = require('./mongo')
const adminMongoReadOptimize = require('./adminMongoReadOptimize')
const { shouldBlockRequestOnMongoRefreshError } = require('./mongoRefreshGuard')
const {
  filterDueOnDateRowRefs,
  computePendingReceivableStats,
  computeTotalOverdueAmount,
  computeDynamicOrderSettlementRate,
  computeDynamicPendingReceivableAverages,
  computeDynamicUnpaidRateThroughDate,
  resolveInstallmentEffectiveDueDateKey,
} = require('./pendingReceivableStats')
const { computeOrderRepayBucket, reconcileOverdueUserBlacklistAcrossDb } = require('./overdueUserBlacklist')
const { buildTrafficPartnerApprovedRowsForChannel } = require('./trafficPartnerApprovedRows')
const {
  applyBillRiskCallback,
  buildBillRiskCustomerView,
  buildBillRiskView,
  generateBillRiskMailForUser,
} = require('./billRiskControl')
const {
  resolveDeferRepaymentBaseDueDateKey,
  applyDeferRepaymentDueDate,
  recordDeferRepaymentDisplayEvent,
  recordNegotiationDeferAsCollectedEvent,
} = require('./installmentDeferRepayment')
const {
  applyNegotiatedRepaymentDueDate,
  hasNegotiatedRepaymentDueDateTarget,
  isDueDateOnOrAfterToday,
} = require('./installmentSetDueDate')
const {
  INSTALLMENT_REPAY_DAYS_AFTER_CARD_ISSUE: INSTALLMENT_REPAY_DAYS_AFTER_CARD_ISSUE_FROM_POLICY,
} = require('./installmentRepaySchedule')

const Koa = require('koa')
const Router = require('@koa/router')
const bodyParser = require('koa-bodyparser')
const cors = require('@koa/cors')
const {
  readDb,
  writeDb,
  writeDbPartial,
  writeDbEntity,
  hydrateFromMongoAfterConnect,
  isMongoPersistenceEnabled,
  flushMongoPersist,
  evictTenantMemoryCache,
  refreshScopeCacheFromMongo,
  refreshScopePartialFromMongo,
  refreshScopeForAdminAuth,
  refreshTenantCacheFromMongo,
  runWithMongoRequestDedup,
} = require('./store')
const {
  runWithTenant,
  runWithWorkspace,
  normalizeTenantId,
  normalizeWorkspaceType,
  DEFAULT_TENANT_ID,
  setCurrentTenant,
  setCurrentWorkspace,
  getCurrentTenantId,
} = require('./tenantContext')
const { resolveTenantIdFromRequest, resolveWorkspaceTypeFromRequest } = require('./tenantResolver')
const { DEFAULT_SUPER_ADMIN_USERNAME, BOOTSTRAP_ADMIN_ACCOUNTS } = require('./defaultBootstrap')
const {
  applyUserRegisterChannel,
  resolveRegisterChannelForRegistration,
} = require('./userRegisterChannel')
const {
  ADMIN_PERMISSION_ACTIONS,
  ADMIN_PERMISSION_ACTION_LABELS,
  ADMIN_PERMISSION_TREE,
  defaultAdminPermissionsForRole,
  normalizeAdminPermissions,
  effectiveAdminPermissions,
  resetAdminPermissionsForRole,
  hasAdminPermission,
  hasAdminPermissionCompat,
  hasAdminPermissionOnAny,
  adminOrderPermissionKeyForListScope,
  adminProductPermissionKeyForSalesMode,
  adminReceivablePermissionKeyForDueDate,
  normalizeAdminUsersListView,
  adminUsersPermissionKeyForView,
  hasAdminUsersListViewPermission,
  hasAdminUsersPermissionOnAny,
  hasAdminMarkPaidPermission,
  hasAdminShipmentTrackingPermission,
  hasAdminOrderDeletePermission,
  canGrantAdminPermissions,
  canManageRolePermissions,
} = require('./adminPermissions')
const crypto = require('node:crypto')
const path = require('node:path')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const multer = require('@koa/multer')
const mount = require('koa-mount')
const serve = require('koa-static')
const { imageSize } = require('image-size')
const { getOssConfig, isOssConfigured, uploadIdCardImage, uploadPublicImage } = require('./oss')

const { router: riskControlRouter, PREFIX: RISK_CONTROL_PREFIX } = require('./riskControl/router')
const {
  runCreditPreliminaryReview,
  normalizeFourteenProductRows,
  runSingleRiskSlot,
  isRiskUpstreamConfigured,
} = require('./riskControl/preliminaryReview')
const {
  isMallOrderRepaymentSettled,
  mallOrderRepaymentAwareStatus,
} = require('./orderRepaymentSettlement')
const {
  runOrderSubmitUpstreamRiskPack,
  runOrderSubmitSingleRiskStep,
  ORDER_INSTALLMENT_RISK_STEP_KEYS,
  ORDER_INSTALLMENT_RISK_STEP_LABELS,
  postCreateContract,
  postAddPersonalUser,
  postAddSigner,
  postGetContract,
} = require('./riskControl/upstreamClient')
const {
  createWave: createInstallmentRiskWave,
  getWave: getInstallmentRiskWave,
  recordStepResult: recordInstallmentRiskWaveStep,
  consumeForOrder: consumeInstallmentRiskWaveForOrder,
} = require('./riskControl/installmentRiskWave')
const {
  sendRegisterVerificationSms,
  verifyAndConsumeRegisterSms,
  sendLoginVerificationSms,
  verifyAndConsumeLoginSms,
} = require('./mallRegisterSms')

const { buildCardPackageContractViewHtml } = require('./cardPackageContractViewHtml')
const { buildCardPackageContractPdfBuffer } = require('./cardPackageContractPdf')
const lakalaPayment = require('./payment/lakalaPaymentService')
const { registerLakalaRoutes } = require('./payment/registerLakalaRoutes')
const {
  ensureDuodiandianChannel,
  ensureDuodiandianPortalPartner,
  isDuodiandianPublicPath,
  resolveDuodiandianMongoRefreshPlan,
  notifyDuodiandianOrderEvent,
  findReusableDuodiandianApplyRiskReview,
  registerDuodiandianGatewayRoutes,
} = require('./duodiandianGateway')
const { createMallContactsStore } = require('./mallContacts/store')
const {
  markMallContactsRequiredForOrder,
  shouldBlockContractForMallContacts,
} = require('./mallContacts/policy')
const { registerMallContactsRoutes } = require('./mallContacts/router')

const app = new Koa()
const router = new Router({ prefix: '/api' })
const duodiandianPublicRouter = new Router()
const mallContactsStore = createMallContactsStore()
const PORT = Number(process.env.PORT || 3110)
function positiveIntegerFromEnv(key, fallback) {
  const raw = String(process.env[key] || '').trim()
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : fallback
}
/** GET /static/* → api/public/*（卡包合同模板 PDF 等，供电子签上游按 URL 拉取；本地 mock 下载 PDF 由程序按订单动态生成，不读该目录） */
const API_PUBLIC_DIR = path.join(__dirname, '..', 'public')

const mallIdCardUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: positiveIntegerFromEnv('MALL_ID_CARD_UPLOAD_MAX_BYTES', 5 * 1024 * 1024) },
  fileFilter(_req, file, cb) {
    if (/^image\/(jpeg|png|webp)$/i.test(file.mimetype || '')) {
      cb(null, true)
    }
    else {
      cb(new Error('仅支持 JPG、PNG、WebP 图片'))
    }
  },
})
const mallPublicImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: positiveIntegerFromEnv('MALL_PUBLIC_IMAGE_UPLOAD_MAX_BYTES', 8 * 1024 * 1024) },
  fileFilter(_req, file, cb) {
    if (/^image\/(jpeg|png|webp|gif)$/i.test(file.mimetype || '')) {
      cb(null, true)
    }
    else {
      cb(new Error('仅支持 JPG、PNG、WebP、GIF 图片'))
    }
  },
})
const ALLOWED_ID_CARD_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp'])
const ALLOWED_ID_CARD_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MALL_PASSWORD_PEPPER = String(process.env.MALL_PASSWORD_PEPPER || 'mall-local-pepper-v1')
const PRODUCT_CATEGORIES = new Set(['phone', 'digital', 'appliance', 'cosmetics'])
/** 历史数据中的旧分类键 → 新分类（仅读库归一化，新建商品请用新分类） */
const PRODUCT_CATEGORY_LEGACY_MAP = {
  travel: 'digital',
  calligraphy: 'cosmetics',
  mobile: 'phone',
  jewelry: 'cosmetics',
  phones: 'phone',
  appliances: 'appliance',
}
/** mall=首页商城分区；installment=先享后付；均可在线下单 */
const PRODUCT_SALES_MODES = new Set(['mall', 'installment'])

function resolveProductCategoryKey(raw) {
  const t = String(raw || '').trim()
  if (PRODUCT_CATEGORIES.has(t)) {
    return t
  }
  const mapped = PRODUCT_CATEGORY_LEGACY_MAP[t]
  if (mapped && PRODUCT_CATEGORIES.has(mapped)) {
    return mapped
  }
  return 'phone'
}
const ADMIN_ROLES = {
  SUPER: 'super_admin',
  BOSS: 'boss',
  REVIEWER: 'reviewer',
  COLLECTOR: 'collector',
}
const ADMIN_ROLE_SET = new Set(Object.values(ADMIN_ROLES))
/** 与超级管理员同权的后台角色（展示名可不同） */
function isSuperEquivalentRole(role) {
  return role === ADMIN_ROLES.SUPER || role === ADMIN_ROLES.BOSS
}
/** 商城用户注册及未填写额度时的默认先享后付可用额度（元），由 api/.env.[NODE_ENV] → MALL_DEFAULT_CREDIT_QUOTA；缺省或非法时回退 2750 */
const DEFAULT_USER_FALLBACK_QUOTA = 2750
function resolveDefaultUserQuotaFromEnv() {
  const raw = process.env.MALL_DEFAULT_CREDIT_QUOTA
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return DEFAULT_USER_FALLBACK_QUOTA
  }
  const n = Number(String(raw).trim())
  if (!Number.isFinite(n) || n < 0) {
    return DEFAULT_USER_FALLBACK_QUOTA
  }
  return Math.round(n)
}
const DEFAULT_USER_QUOTA = resolveDefaultUserQuotaFromEnv()

function hashMallUserPassword(plain) {
  const s = String(plain || '')
  return crypto.createHash('sha256').update(`${MALL_PASSWORD_PEPPER}:${s}`, 'utf8').digest('hex')
}

function verifyMallUserPassword(plain, hash) {
  if (!hash || plain === undefined || plain === null) {
    return false
  }
  return hashMallUserPassword(String(plain)) === String(hash)
}

/** 紧急联系人姓名：仅汉字或英文字母，可含间隔号「·」与空格；禁止数字与其它符号 */
function normalizeEmergencyContactPersonName(raw) {
  return String(raw != null ? raw : '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\u00b7|・|･/g, '·')
}

function isValidEmergencyContactPersonName(raw) {
  const s = normalizeEmergencyContactPersonName(raw)
  if (!s || s.length > 32) {
    return false
  }
  if (/\d/.test(s)) {
    return false
  }
  if (!/^[\u4e00-\u9fff\u3400-\u4DBFa-zA-Z· ]+$/.test(s)) {
    return false
  }
  if (!/[\u4e00-\u9fff\u3400-\u4DBFa-zA-Z]/.test(s)) {
    return false
  }
  return true
}

/** 单条紧急联系人：姓名 + 大陆手机号 */
function normalizeEmergencyContactEntry(raw) {
  if (!raw || typeof raw !== 'object') {
    return null
  }
  if (!isValidEmergencyContactPersonName(raw.name)) {
    return null
  }
  const name = normalizeEmergencyContactPersonName(raw.name)
  const phone = normalizePhone(raw.phone != null ? raw.phone : '')
  if (!/^1\d{10}$/.test(phone)) {
    return null
  }
  return { name, phone }
}

function normalizeEmergencyContactsList(raw) {
  if (!Array.isArray(raw)) {
    return []
  }
  const out = []
  for (const x of raw) {
    const c = normalizeEmergencyContactEntry(x)
    if (c) {
      out.push(c)
    }
    if (out.length >= 2) {
      break
    }
  }
  return out
}

function isEmergencyContactsComplete(list) {
  return Array.isArray(list) && list.length === 2 && list.every(c => c && c.name && /^1\d{10}$/.test(String(c.phone || '')))
}

function validateEmergencyContactsInput(rawList, ownerPhone) {
  const arr = Array.isArray(rawList) ? rawList : []
  const list = []
  for (let i = 0; i < 2; i++) {
    const it = arr[i]
    if (!it || typeof it !== 'object') {
      return { ok: false, msg: `请完整填写第 ${i + 1} 位紧急联系人的姓名与手机号` }
    }
    if (!isValidEmergencyContactPersonName(it.name)) {
      return { ok: false, msg: `第 ${i + 1} 位紧急联系人姓名须为汉字或英文字母，不可含数字、标点及其它符号（姓名中仅允许间隔符「·」与空格）` }
    }
    const ph = normalizePhone(it.phone != null ? it.phone : '')
    if (!/^1\d{10}$/.test(ph)) {
      return { ok: false, msg: `第 ${i + 1} 位紧急联系人手机号须为以 1 开头的 11 位大陆号码` }
    }
    if (ph === ownerPhone) {
      return { ok: false, msg: '请填写真实紧急联系人，否则会影响审核结果' }
    }
    list.push({ name: normalizeEmergencyContactPersonName(it.name), phone: ph })
  }
  if (list[0].phone === list[1].phone) {
    return { ok: false, msg: '两位紧急联系人手机号不能相同' }
  }
  return { ok: true, list }
}

/** 按 users 中已登记的手机号解析商城注册账号 */
function resolveRegisteredMallUserByNormalizedPhone(db, phoneDigits) {
  const p = normalizePhone(phoneDigits || '')
  if (!/^1\d{10}$/.test(p)) {
    return null
  }
  return db.users.find(item => normalizePhone(item.phone || '') === p) || null
}

/** 订单归属：仅当 order.mallUserId 与注册用户 id 一致（禁止用收货手机号归属账号） */
function orderBelongsToRegisteredMallUser(db, order, mallUser) {
  if (!order || !mallUser || !db) {
    return false
  }
  const uid = String(mallUser.id || '').trim()
  const mid = String(order.mallUserId || '').trim()
  return Boolean(uid && mid && mid === uid)
}

function ordersForRegisteredMallUser(db, mallUser) {
  if (!mallUser) {
    return []
  }
  return db.orders.filter(item => orderBelongsToRegisteredMallUser(db, item, mallUser))
}

function orderCreatedAtMs(order) {
  const ms = Date.parse(String(order?.createdAt || ''))
  return Number.isNaN(ms) ? 0 : ms
}

function sortOrdersByCreatedAtAsc(orders) {
  return (Array.isArray(orders) ? orders : [])
    .slice()
    .sort((a, b) => orderCreatedAtMs(a) - orderCreatedAtMs(b))
}

/** 渠道引流统计：每位注册用户仅计最早一笔订单 */
function pickUserFirstOrder(orders) {
  const sorted = sortOrdersByCreatedAtAsc(orders)
  return sorted[0] || null
}

function isInstallmentOrderFullyRepaid(order) {
  ensureOrderInstallmentPlan(order)
  return isMallOrderRepaymentSettled(order)
}

/** 上一笔订单是否满足老客户判定：已下单、卡包已发、已全部还款 */
function doesPriorOrderQualifyForOldCustomer(order) {
  if (!order) {
    return false
  }
  ensureOrderCardPackage(order)
  ensureOrderInstallmentPlan(order)
  if (order.status === 'reviewing') {
    return false
  }
  if (order.riskStatus === 'failed') {
    return false
  }
  if (!order.cardPackageIssued) {
    return false
  }
  return isInstallmentOrderFullyRepaid(order)
}

function findImmediatePriorOrderForCustomer(db, targetOrder, userOrdersCache) {
  const mallUser = resolveMallBuyerFromOrder(db, targetOrder)
  if (!mallUser) {
    return null
  }
  const uid = String(mallUser.id || '').trim()
  let userOrders
  if (userOrdersCache && userOrdersCache.has(uid)) {
    userOrders = userOrdersCache.get(uid)
  }
  else {
    userOrders = ordersForRegisteredMallUser(db, mallUser)
    if (userOrdersCache) {
      userOrdersCache.set(uid, userOrders)
    }
  }
  const targetMs = orderCreatedAtMs(targetOrder)
  let best = null
  let bestMs = -1
  for (const item of userOrders) {
    if (String(item.id) === String(targetOrder.id)) {
      continue
    }
    const ms = orderCreatedAtMs(item)
    if (ms >= targetMs) {
      continue
    }
    if (ms > bestMs) {
      bestMs = ms
      best = item
    }
  }
  return best
}

/** 管理端「新老客户」列：上一笔订单已下单、卡包已发且已全部还款（只查该注册用户订单，不扫全库） */
function isOldCustomerAtOrder(db, targetOrder, userOrdersCache) {
  const prior = findImmediatePriorOrderForCustomer(db, targetOrder, userOrdersCache)
  return doesPriorOrderQualifyForOldCustomer(prior)
}

/** 商城复购免风控：最近一笔订单满足老客户判定 */
function isMallUserReturningCustomer(db, mallUser) {
  const userOrders = ordersForRegisteredMallUser(db, mallUser)
    .slice()
    .sort((a, b) => orderCreatedAtMs(b) - orderCreatedAtMs(a))
  return doesPriorOrderQualifyForOldCustomer(userOrders[0])
}

function countApprovedOrdersForUserPhone(db, phone) {
  const user = resolveRegisteredMallUserByNormalizedPhone(db, phone)
  if (!user) {
    return 0
  }
  return ordersForRegisteredMallUser(db, user).filter(item => item.status !== 'reviewing').length
}

function sanitizeMallUser(user, opts = {}) {
  if (!user) {
    return user
  }
  const { passwordHash, adminPasswordPlain, ...rest } = user
  if (opts.mall) {
    const {
      adminRemark,
      registerChannelCode,
      registerChannelName,
      signAuthSerialNo,
      ...mallRest
    } = rest
    return mallRest
  }
  return rest
}

function normalizeUserQuota(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) {
    return DEFAULT_USER_QUOTA
  }
  return Math.round(n)
}
/** 默认开启：禁止「未解析到角色时默认 super_admin」。本地调试可设 ENFORCE_ADMIN_RBAC=false */
const ENFORCE_ADMIN_RBAC = normalizeBoolean(process.env.ENFORCE_ADMIN_RBAC, true)
const ADMIN_ACCOUNT_STATUS_SET = new Set(['active', 'disabled'])
const ADMIN_SCOPE_TYPES = new Set(['tenant', 'platform'])

function success(data) {
  return { success: true, code: 0, msg: 'ok', data }
}

function parseOptionalListPagination(query, { defaultPageSize = 20, maxPageSize = 100 } = {}) {
  const hasPage = query && Object.prototype.hasOwnProperty.call(query, 'page')
  const hasPageSize = query && Object.prototype.hasOwnProperty.call(query, 'pageSize')
  if (!hasPage && !hasPageSize) {
    return { enabled: false }
  }
  const page = Math.max(1, parseInt(String(query.page || '1'), 10) || 1)
  const pageSize = Math.min(
    maxPageSize,
    Math.max(1, parseInt(String(query.pageSize || defaultPageSize), 10) || defaultPageSize),
  )
  return { enabled: true, page, pageSize }
}

function paginateRows(rows, page, pageSize) {
  const total = Array.isArray(rows) ? rows.length : 0
  const start = (page - 1) * pageSize
  return {
    list: Array.isArray(rows) ? rows.slice(start, start + pageSize) : [],
    total,
    page,
    pageSize,
  }
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

function addDays(iso, days) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  date.setDate(date.getDate() + Number(days || 0))
  return formatDate(date.toISOString())
}

/** 先享后付：含卡包发放当天为第 1 天，第 10 天为还款到期日（非下单日）。 */
const INSTALLMENT_REPAY_DAYS_AFTER_CARD_ISSUE = INSTALLMENT_REPAY_DAYS_AFTER_CARD_ISSUE_FROM_POLICY

function installmentDueDateFromRepayAnchor(repayAnchorAt) {
  const anchor = String(repayAnchorAt || '').trim()
  if (!anchor) {
    return ''
  }
  return addDays(anchor, INSTALLMENT_REPAY_DAYS_AFTER_CARD_ISSUE)
}

function installmentPlanItemHasNegotiationState(planItem) {
  if (!planItem) {
    return false
  }
  if (planItem.negotiationPayPending && Number(planItem.negotiationPayPending.negotiatedAmount || 0) > 0) {
    return true
  }
  return Array.isArray(planItem.negotiationHistory) && planItem.negotiationHistory.length > 0
}

function installmentRepayAnchorForOrder(order) {
  ensureOrderCardPackage(order)
  if (!order.cardPackageIssued) {
    return ''
  }
  return String(order.cardPackageIssuedAt || '').trim()
}

function applyInstallmentDueDatesOnCardPackageIssue(order, issuedAt) {
  if (order.payType !== 'installment') {
    return false
  }
  ensureOrderInstallmentPlan(order)
  const due = installmentDueDateFromRepayAnchor(issuedAt)
  if (!due) {
    return false
  }
  const plan = Array.isArray(order.installmentPlan) ? order.installmentPlan : []
  let changed = false
  for (const item of plan) {
    if (!item || installmentItemIsPaid(item) || installmentPlanItemHasNegotiationState(item)) {
      continue
    }
    if (item.dueDate !== due) {
      item.dueDate = due
      changed = true
    }
  }
  return changed
}

function clearInstallmentDueDatesBeforeCardIssue(order) {
  if (order.payType !== 'installment') {
    return false
  }
  const plan = Array.isArray(order.installmentPlan) ? order.installmentPlan : []
  let changed = false
  for (const item of plan) {
    if (!item || installmentItemIsPaid(item) || installmentPlanItemHasNegotiationState(item)) {
      continue
    }
    if (String(item.dueDate || '').trim()) {
      item.dueDate = ''
      changed = true
    }
  }
  return changed
}

/** 历史数据：卡包未发时不应展示还款日（旧逻辑曾按下单日+14天预填） */
function reconcileInstallmentDueDateBeforeCardIssue(order) {
  ensureOrderCardPackage(order)
  if (order.payType !== 'installment' || order.cardPackageIssued) {
    return false
  }
  return clearInstallmentDueDatesBeforeCardIssue(order)
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
  if (value === 'boss' || value === '老板') {
    return ADMIN_ROLES.BOSS
  }
  if (
    value === 'reviewer'
    || value === 'auditor'
    || value === '审核员'
    || value === 'customer_service'
    || value === 'customer-service'
    || value === 'customerservice'
    || value === '客服'
  ) {
    return ADMIN_ROLES.REVIEWER
  }
  if (value === 'collector' || value === 'debt_collector' || value === 'collection' || value === '催收' || value === '催收员') {
    return ADMIN_ROLES.COLLECTOR
  }
  return ''
}

function getRoleLabel(role) {
  if (role === ADMIN_ROLES.SUPER) return '超级管理员'
  if (role === ADMIN_ROLES.BOSS) return '老板'
  if (role === ADMIN_ROLES.REVIEWER) return '审核员'
  if (role === ADMIN_ROLES.COLLECTOR) return '催收员'
  return '未知角色'
}

function parsePhoneFromToken(authorization) {
  const token = String(authorization || '').trim().replace(/^bearer\s+/i, '')
  if (!token.startsWith('mock-token-')) {
    return ''
  }
  return token.slice('mock-token-'.length)
}

/** Bearer mock-token-{手机} → 下单/归属统计均绑定该注册商城账号（与客服会话一致） */
function resolvePlacingMallUserFromBearer(ctx, db) {
  const tokenPhone = normalizePhone(parsePhoneFromToken(ctx.headers && ctx.headers.authorization))
  if (!/^1\d{10}$/.test(tokenPhone)) {
    return null
  }
  return resolveRegisteredMallUserByNormalizedPhone(db, tokenPhone)
}

function normalizeAdminAccount(account) {
  const now = new Date().toISOString()
  const normalizedRole = normalizeAdminRole(account.role)
  const uname = String(account.username || '').trim()
  /** 避免 super_admin 写成空/脏数据时被降级为审核员，导致 /admin/accounts 403 */
  const fallbackRole = uname === DEFAULT_SUPER_ADMIN_USERNAME
    ? ADMIN_ROLES.SUPER
    : ADMIN_ROLES.REVIEWER
  const role = normalizedRole || fallbackRole
  const status = ADMIN_ACCOUNT_STATUS_SET.has(String(account.status || '').trim()) ? String(account.status).trim() : 'active'
  const tenantId = normalizeTenantId(account.tenantId || 'default')
  const scopeType = ADMIN_SCOPE_TYPES.has(String(account.scopeType || '').trim())
    ? String(account.scopeType).trim()
    : ((tenantId === DEFAULT_TENANT_ID && isSuperEquivalentRole(role)) ? 'platform' : 'tenant')
  const scopeTenantIdsRaw = Array.isArray(account.scopeTenantIds) ? account.scopeTenantIds : []
  const scopeTenantIds = scopeTenantIdsRaw
    .map(item => String(item || '').trim())
    .filter(Boolean)
    .map(item => (item === '*' ? '*' : normalizeTenantId(item)))
  if (scopeType === 'platform' && !scopeTenantIds.includes('*')) {
    scopeTenantIds.unshift('*')
  }
  return {
    id: String(account.id || `A${Date.now()}`),
    username: uname,
    password: String(account.password || '1234'),
    role,
    name: String(account.name || '').trim() || getRoleLabel(role),
    phone: normalizePhone(account.phone || ''),
    status,
    scopeType,
    tenantId,
    scopeTenantIds,
    permissions: account.permissions ? normalizeAdminPermissions(account.permissions) : undefined,
    createdAt: account.createdAt || now,
    updatedAt: account.updatedAt || account.createdAt || now,
  }
}

function ensureAdminAccounts(db) {
  if (!Array.isArray(db.adminAccounts)) {
    db.adminAccounts = []
  }
  let accounts = db.adminAccounts
    .map(normalizeAdminAccount)
    .filter(item => item.username)
  const currentTenantId = normalizeTenantId(getCurrentTenantId() || DEFAULT_TENANT_ID)
  if (currentTenantId !== DEFAULT_TENANT_ID) {
    // 子系统库只保留本子系统账号，不展示主系统账号。
    accounts = accounts.filter((item) => {
      if (item.scopeType === 'platform' || item.role === ADMIN_ROLES.SUPER) {
        return false
      }
      return normalizeTenantId(item.tenantId || currentTenantId) === currentTenantId
    })
    db.adminAccounts = accounts
    return
  }
  // 兼容历史数据：旧版本里主系统账号可能写成 tenant+default，这里统一升级为 platform+default。
  accounts = accounts.map((item) => {
    const tenantId = normalizeTenantId(item.tenantId || DEFAULT_TENANT_ID)
    if (tenantId === DEFAULT_TENANT_ID && String(item.scopeType || 'tenant') !== 'platform') {
      return {
        ...item,
        scopeType: 'platform',
        tenantId: DEFAULT_TENANT_ID,
      }
    }
    return item
  })
  // 主系统仅保留唯一超级管理员账号（DEFAULT_SUPER_ADMIN_USERNAME）
  const superAdmins = accounts.filter(item => item.role === ADMIN_ROLES.SUPER)
  if (superAdmins.length > 1) {
    let keeper = accounts.find(item => item.username === DEFAULT_SUPER_ADMIN_USERNAME)
    if (!keeper) {
      keeper = superAdmins[0]
    }
    accounts = accounts.filter((item) => {
      if (item.role !== ADMIN_ROLES.SUPER) return true
      return item.id === keeper.id
    })
  }
  /** 云上缺字段时仍可补回内置账号（defaultBootstrap），避免列表为空且无权限访问 */
  const have = new Set(accounts.map(a => a.username))
  BOOTSTRAP_ADMIN_ACCOUNTS.forEach((seed) => {
    if (!have.has(seed.username)) {
      accounts.push(normalizeAdminAccount(seed))
      have.add(seed.username)
    }
  })
  db.adminAccounts = accounts
}

function getAdminRoleByPhone(db, phone) {
  const target = db.adminAccounts.find(item => item.phone === phone && item.status === 'active')
  return target ? target.role : ''
}

function getAdminAccountByUsername(db, username) {
  const key = String(username || '').trim()
  return db.adminAccounts.find(item => item.username === key) || null
}

function getAdminAccountByPhone(db, phone) {
  return db.adminAccounts.find(item => item.phone === phone && item.status === 'active') || null
}

async function readRawAdminAccountsByWorkspace(workspaceType, tenantId) {
  if (isMongoPersistenceEnabled()) {
    await refreshScopeCacheFromMongo(workspaceType, tenantId)
  }
  return runWithWorkspace(workspaceType, tenantId, () => {
    const db = readDb()
    const rows = Array.isArray(db.adminAccounts) ? db.adminAccounts : []
    return rows
      .map(normalizeAdminAccount)
      .filter(item => item && item.username)
  })
}

async function migrateLegacyMainAccountsToCore() {
  const legacyTenantDefaultAccounts = await readRawAdminAccountsByWorkspace('tenant', DEFAULT_TENANT_ID)
  const legacySelfAccounts = await readRawAdminAccountsByWorkspace('self', DEFAULT_TENANT_ID)
  if (isMongoPersistenceEnabled()) {
    await refreshScopeCacheFromMongo('core', DEFAULT_TENANT_ID)
  }
  return runWithWorkspace('core', DEFAULT_TENANT_ID, () => {
    const coreDb = readDb()
    ensureAdminAccounts(coreDb)
    const existingByUsername = new Set(coreDb.adminAccounts.map(item => String(item.username || '').trim()))
    const existingByPhone = new Set(coreDb.adminAccounts.map(item => normalizePhone(item.phone)).filter(Boolean))

    const legacyAll = [...legacyTenantDefaultAccounts, ...legacySelfAccounts]

    let appended = 0
    legacyAll.forEach((item) => {
      const username = String(item.username || '').trim()
      if (!username || username === DEFAULT_SUPER_ADMIN_USERNAME) {
        return
      }
      const phone = normalizePhone(item.phone)
      if (existingByUsername.has(username)) {
        return
      }
      if (phone && existingByPhone.has(phone)) {
        return
      }
      const now = new Date().toISOString()
      const next = normalizeAdminAccount({
        ...item,
        id: item.id || `A${Date.now()}${appended}`,
        scopeType: 'platform',
        tenantId: DEFAULT_TENANT_ID,
        scopeTenantIds: ['*'],
        updatedAt: now,
      })
      coreDb.adminAccounts.push(next)
      existingByUsername.add(username)
      if (phone) {
        existingByPhone.add(phone)
      }
      appended += 1
    })

    if (appended > 0) {
      writeAdminAccountsDb(coreDb)
    }
    return appended
  })
}

async function readDbByTenantId(tenantId, { forAdminAuth = false } = {}) {
  const t = normalizeTenantId(tenantId || DEFAULT_TENANT_ID)
  if (isMongoPersistenceEnabled()) {
    if (forAdminAuth) {
      await refreshScopeForAdminAuth('tenant', t)
    }
    else {
      await refreshScopeCacheFromMongo('tenant', t)
    }
  }
  return runWithTenant(t, () => {
    const db = readDb()
    ensureAdminAccounts(db)
    return db
  })
}

async function deleteTenantScopedAdminAccountInTenantDbById(tenantId, accountId) {
  const t = normalizeTenantId(tenantId || DEFAULT_TENANT_ID)
  if (isMongoPersistenceEnabled()) {
    await refreshScopeCacheFromMongo('tenant', t)
  }
  return runWithTenant(t, () => {
    const db = readDb()
    ensureAdminAccounts(db)
    const index = db.adminAccounts.findIndex(item => item.id === accountId)
    if (index < 0) {
      return { found: false }
    }
    const target = db.adminAccounts[index]
    if (!target || String(target.scopeType || 'tenant') === 'platform') {
      return { found: true, blocked: true, reason: 'platform' }
    }
    if (target.username === DEFAULT_SUPER_ADMIN_USERNAME) {
      return { found: true, blocked: true, reason: 'default-super' }
    }
    db.adminAccounts.splice(index, 1)
    writeAdminAccountsDb(db)
    clearAdminAccountCaches()
    return { found: true, deleted: true, target }
  })
}

async function readCoreDb({ forAdminAuth = false } = {}) {
  if (isMongoPersistenceEnabled()) {
    if (forAdminAuth) {
      await refreshScopeForAdminAuth('core', DEFAULT_TENANT_ID)
    }
    else {
      await refreshScopeCacheFromMongo('core', DEFAULT_TENANT_ID)
    }
  }
  return runWithWorkspace('core', DEFAULT_TENANT_ID, () => {
    const db = readDb()
    ensureAdminAccounts(db)
    return db
  })
}

async function writeCoreDb(db) {
  if (isMongoPersistenceEnabled()) {
    await refreshScopeCacheFromMongo('core', DEFAULT_TENANT_ID)
  }
  return runWithWorkspace('core', DEFAULT_TENANT_ID, () => {
    writeDbPartial(db, ['adminAccounts'])
  })
}

const adminAuthAccountCache = new Map()

function adminAuthAccountCacheTtlMs() {
  if (!isAdminReadOptimizeEnabled()) {
    return 0
  }
  const raw = Number(process.env.API_ADMIN_AUTH_CACHE_TTL_MS || 30000)
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0
}

function adminAuthCacheKey(kind, preferredTenantId, identityKey) {
  const preferred = normalizeTenantId(preferredTenantId || DEFAULT_TENANT_ID)
  return `${kind}:${preferred}:${identityKey}`
}

function readAdminAuthAccountCache(kind, preferredTenantId, identityKey) {
  const ttl = adminAuthAccountCacheTtlMs()
  if (ttl <= 0 || !identityKey) {
    return undefined
  }
  const hit = adminAuthAccountCache.get(adminAuthCacheKey(kind, preferredTenantId, identityKey))
  if (!hit || Date.now() - hit.at >= ttl) {
    return undefined
  }
  return hit.account
}

function writeAdminAuthAccountCache(kind, preferredTenantId, identityKey, account) {
  const ttl = adminAuthAccountCacheTtlMs()
  if (ttl <= 0 || !identityKey) {
    return
  }
  adminAuthAccountCache.set(adminAuthCacheKey(kind, preferredTenantId, identityKey), {
    at: Date.now(),
    account: account || null,
  })
}

async function collectKnownTenantIdsFromMongoMetaLight() {
  const client = mongo.getMongoClient && mongo.getMongoClient()
  if (!client) {
    return []
  }
  const set = new Set()
  try {
    const coreDbName = resolveMongoScopedDbName('core', DEFAULT_TENANT_ID)
    const metaDoc = await client.db(coreDbName).collection(mongo.APP_META).findOne({ _id: 'main' })
    parseKnownTenantIdsFromMeta(metaDoc && metaDoc.meta)
      .filter(id => id !== DEFAULT_TENANT_ID)
      .forEach(id => set.add(id))
  }
  catch {
    // ignore
  }
  try {
    const admin = client.db().admin()
    const all = await admin.listDatabases()
    const dbName = String(mongoConfig.getMongoConfig().dbName || 'mall').trim() || 'mall'
    const prefix = `${dbName}__tenant_`
    const list = Array.isArray(all?.databases) ? all.databases : []
    list.forEach((item) => {
      const name = String(item?.name || '')
      if (!name.startsWith(prefix)) {
        return
      }
      const suffix = name.slice(prefix.length)
      const tenantId = normalizeTenantId(suffix || DEFAULT_TENANT_ID)
      if (tenantId && tenantId !== DEFAULT_TENANT_ID) {
        set.add(tenantId)
      }
    })
  }
  catch {
    // ignore
  }
  return [...set]
}

async function findAdminAccountByPhoneInMongoScoped(workspaceType, tenantId, phone) {
  const accounts = await readAdminAccountsFromMongoScoped(workspaceType, tenantId)
  if (!Array.isArray(accounts) || !accounts.length) {
    return null
  }
  const t = normalizeTenantId(tenantId || DEFAULT_TENANT_ID)
  const normalizedPhone = normalizePhone(phone)
  const normalized = normalizeAdminAccountsListInTenantContext(t, accounts)
  return normalized.find(item => item && item.status === 'active' && normalizePhone(item.phone) === normalizedPhone) || null
}

async function findAdminAccountByUsernameInMongoScoped(workspaceType, tenantId, username) {
  const accounts = await readAdminAccountsFromMongoScoped(workspaceType, tenantId)
  if (!Array.isArray(accounts) || !accounts.length) {
    return null
  }
  const t = normalizeTenantId(tenantId || DEFAULT_TENANT_ID)
  const key = String(username || '').trim()
  if (!key) {
    return null
  }
  const normalized = normalizeAdminAccountsListInTenantContext(t, accounts)
  return normalized.find(item => item && item.username === key) || null
}

async function findAdminAccountByPhoneAcrossTenantsFromMongo(normalizedPhone, preferredTenantId) {
  const preferred = normalizeTenantId(preferredTenantId || DEFAULT_TENANT_ID)
  const searched = new Set([preferred])
  let found = await findAdminAccountByPhoneInMongoScoped('tenant', preferred, normalizedPhone)
  if (found) {
    return found
  }
  found = await findAdminAccountByPhoneInMongoScoped('core', DEFAULT_TENANT_ID, normalizedPhone)
  if (found) {
    return found
  }
  const known = await collectKnownTenantIdsFromMongoMetaLight()
  for (const tenantId of known) {
    if (searched.has(tenantId)) {
      continue
    }
    searched.add(tenantId)
    found = await findAdminAccountByPhoneInMongoScoped('tenant', tenantId, normalizedPhone)
    if (found) {
      return found
    }
  }
  return null
}

async function findAdminAccountByUsernameAcrossTenantsFromMongo(username, preferredTenantId) {
  const key = String(username || '').trim()
  if (!key) {
    return null
  }
  const preferred = normalizeTenantId(preferredTenantId || DEFAULT_TENANT_ID)
  const searched = new Set([preferred])
  let found = await findAdminAccountByUsernameInMongoScoped('tenant', preferred, key)
  if (found) {
    return found
  }
  found = await findAdminAccountByUsernameInMongoScoped('core', DEFAULT_TENANT_ID, key)
  if (found && String(found.scopeType || 'tenant') === 'platform') {
    return found
  }
  if (found) {
    return found
  }
  const known = await collectKnownTenantIdsFromMongoMetaLight()
  for (const tenantId of known) {
    if (searched.has(tenantId)) {
      continue
    }
    searched.add(tenantId)
    found = await findAdminAccountByUsernameInMongoScoped('tenant', tenantId, key)
    if (found) {
      return found
    }
  }
  return null
}

async function getAdminAccountByPhoneAcrossTenants(phone, preferredTenantId) {
  const normalizedPhone = normalizePhone(phone)
  if (!normalizedPhone) {
    return null
  }
  const cached = readAdminAuthAccountCache('phone', preferredTenantId, normalizedPhone)
  if (cached !== undefined) {
    return cached
  }
  const preferred = normalizeTenantId(preferredTenantId || DEFAULT_TENANT_ID)
  if (isAdminReadOptimizeEnabled() && isMongoPersistenceEnabled()) {
    const foundMongo = await findAdminAccountByPhoneAcrossTenantsFromMongo(normalizedPhone, preferred)
    writeAdminAuthAccountCache('phone', preferredTenantId, normalizedPhone, foundMongo)
    return foundMongo
  }
  const dbPreferred = await readDbByTenantId(preferred, { forAdminAuth: true })
  const foundPreferred = getAdminAccountByPhone(dbPreferred, normalizedPhone)
  if (foundPreferred) {
    writeAdminAuthAccountCache('phone', preferredTenantId, normalizedPhone, foundPreferred)
    return foundPreferred
  }
  const searched = new Set([preferred])
  const dbCore = await readCoreDb({ forAdminAuth: true })
  const foundCore = getAdminAccountByPhone(dbCore, normalizedPhone)
  if (foundCore) {
    writeAdminAuthAccountCache('phone', preferredTenantId, normalizedPhone, foundCore)
    return foundCore
  }
  const known = await collectKnownTenantIds()
  for (const tenantId of known) {
    if (searched.has(tenantId)) {
      continue
    }
    searched.add(tenantId)
    const db = await readDbByTenantId(tenantId, { forAdminAuth: true })
    const found = getAdminAccountByPhone(db, normalizedPhone)
    if (found) {
      writeAdminAuthAccountCache('phone', preferredTenantId, normalizedPhone, found)
      return found
    }
  }
  writeAdminAuthAccountCache('phone', preferredTenantId, normalizedPhone, null)
  return null
}

async function getAdminAccountByUsernameAcrossTenants(username, preferredTenantId) {
  const key = String(username || '').trim()
  if (!key) {
    return null
  }
  const cached = readAdminAuthAccountCache('username', preferredTenantId, key)
  if (cached !== undefined) {
    return cached
  }
  const preferred = normalizeTenantId(preferredTenantId || DEFAULT_TENANT_ID)
  const searched = new Set([preferred])

  if (isAdminReadOptimizeEnabled() && isMongoPersistenceEnabled()) {
    const foundMongo = await findAdminAccountByUsernameAcrossTenantsFromMongo(key, preferred)
    writeAdminAuthAccountCache('username', preferredTenantId, key, foundMongo)
    return foundMongo
  }

  const dbPreferred = await readDbByTenantId(preferred, { forAdminAuth: true })
  const foundPreferred = getAdminAccountByUsername(dbPreferred, key)
  if (foundPreferred) {
    writeAdminAuthAccountCache('username', preferredTenantId, key, foundPreferred)
    return foundPreferred
  }

  const dbCore = await readCoreDb({ forAdminAuth: true })
  const foundCore = getAdminAccountByUsername(dbCore, key)
  if (foundCore && String(foundCore.scopeType || 'tenant') === 'platform') {
    writeAdminAuthAccountCache('username', preferredTenantId, key, foundCore)
    return foundCore
  }
  if (foundCore) {
    writeAdminAuthAccountCache('username', preferredTenantId, key, foundCore)
    return foundCore
  }

  const known = await collectKnownTenantIds()
  for (const tenantId of known) {
    if (searched.has(tenantId)) {
      continue
    }
    searched.add(tenantId)
    const db = await readDbByTenantId(tenantId, { forAdminAuth: true })
    const found = getAdminAccountByUsername(db, key)
    if (found) {
      writeAdminAuthAccountCache('username', preferredTenantId, key, found)
      return found
    }
  }
  writeAdminAuthAccountCache('username', preferredTenantId, key, null)
  return null
}

/**
 * core/self 映射到独立 MongoDB，仅信任 Authorization 中 Bearer 对应「平台 scope」且状态为 active 的后台账号；
 * 子系统后台、商城会话或伪造 x-workspace-type 时一律回落到 tenant 库，避免未授权读平台库。
 */
async function isPlatformAdminBearerForWorkspace(ctx, preferredTenantId) {
  const phone = normalizePhone(parsePhoneFromToken(ctx.headers && ctx.headers.authorization))
  if (!phone) {
    return false
  }
  const account = await getAdminAccountByPhoneAcrossTenants(
    phone,
    normalizeTenantId(preferredTenantId || DEFAULT_TENANT_ID),
  )
  return Boolean(account && account.scopeType === 'platform' && account.status === 'active')
}

async function clampIncomingWorkspaceType(ctx, tenantId, workspaceType) {
  const ws = normalizeWorkspaceType(workspaceType)
  if (ws !== 'core' && ws !== 'self') {
    return ws
  }
  return (await isPlatformAdminBearerForWorkspace(ctx, tenantId)) ? ws : 'tenant'
}

function effectiveScopeTenantIds(account) {
  if (account && account.scopeType === 'platform') {
    return ['*']
  }
  if (!account || !Array.isArray(account.scopeTenantIds) || account.scopeTenantIds.length === 0) {
    const single = normalizeTenantId(account && account.tenantId ? account.tenantId : 'default')
    return [single]
  }
  return account.scopeTenantIds
}

function accountCanAccessTenant(account, tenantId) {
  if (!account) return false
  if (account.scopeType === 'platform') {
    return true
  }
  const tenant = normalizeTenantId(tenantId || 'default')
  const allows = effectiveScopeTenantIds(account)
  if (allows.includes('*')) return true
  return allows.includes(tenant)
}

function lookupActiveAdminAccountInCurrentScope(username, phone) {
  const key = String(username || '').trim()
  const normalizedPhone = normalizePhone(phone)
  if (!key || !normalizedPhone) {
    return null
  }
  const db = readDb()
  ensureAdminAccounts(db)
  const account = getAdminAccountByUsername(db, key)
  if (
    account
    && account.status === 'active'
    && normalizePhone(account.phone) === normalizedPhone
  ) {
    return account
  }
  return null
}

async function resolveAdminRole(ctx) {
  if (ctx.state && ctx.state._resolvedAdminRole) {
    return ctx.state.adminRole || ''
  }
  const requestTenantId = normalizeTenantId(ctx.state && ctx.state.tenantId ? ctx.state.tenantId : DEFAULT_TENANT_ID)
  const tokenPhone = normalizePhone(parsePhoneFromToken(ctx.headers.authorization))
  const hintUsername = String(ctx.headers['x-admin-username'] || ctx.headers['x-user-username'] || '').trim()
  // 优化模式：直连 Mongo adminAccounts（不经 hydrate），避免与中间件 refresh 串行排队。
  if (isAdminReadOptimizeEnabled() && isMongoPersistenceEnabled() && tokenPhone) {
    const ws = normalizeWorkspaceType(ctx.state && ctx.state.workspaceType ? ctx.state.workspaceType : 'tenant')
    let mongoAccount = null
    if (hintUsername) {
      mongoAccount = await lookupActiveAdminAccountFromMongo('tenant', requestTenantId, hintUsername, tokenPhone)
      if (!mongoAccount && ws !== 'core') {
        mongoAccount = await lookupActiveAdminAccountFromMongo('core', DEFAULT_TENANT_ID, hintUsername, tokenPhone)
      }
    }
    else {
      mongoAccount = await findAdminAccountByPhoneInMongoScoped('tenant', requestTenantId, tokenPhone)
      if (!mongoAccount && ws !== 'core') {
        mongoAccount = await findAdminAccountByPhoneInMongoScoped('core', DEFAULT_TENANT_ID, tokenPhone)
      }
    }
    if (mongoAccount) {
      ctx.state.adminRole = mongoAccount.role
      ctx.state.adminAccount = mongoAccount
      ctx.state._resolvedAdminRole = true
      return ctx.state.adminRole
    }
    if (hintUsername) {
      const localAccount = await runWithTenant(requestTenantId, async () => lookupActiveAdminAccountInCurrentScope(hintUsername, tokenPhone))
      if (localAccount) {
        ctx.state.adminRole = localAccount.role
        ctx.state.adminAccount = localAccount
        ctx.state._resolvedAdminRole = true
        return ctx.state.adminRole
      }
    }
  }
  // 仅用 token（手机）跨库查找时可能与平台或其它子系统的同手机号账号混淆；可与登录会话中的用户名交叉校验。
  if (tokenPhone && hintUsername) {
    const byUsername = await getAdminAccountByUsernameAcrossTenants(hintUsername, requestTenantId)
    if (
      byUsername
      && byUsername.status === 'active'
      && normalizePhone(byUsername.phone) === tokenPhone
    ) {
      ctx.state.adminRole = byUsername.role
      ctx.state.adminAccount = byUsername
      ctx.state._resolvedAdminRole = true
      return ctx.state.adminRole
    }
  }
  const tokenAccount = tokenPhone ? await getAdminAccountByPhoneAcrossTenants(tokenPhone, requestTenantId) : null
  const tokenPhoneRole = tokenAccount ? tokenAccount.role : ''
  if (tokenPhoneRole) {
    ctx.state.adminRole = tokenPhoneRole
    ctx.state.adminAccount = tokenAccount
    ctx.state._resolvedAdminRole = true
    return ctx.state.adminRole
  }

  const headerPhone = normalizePhone(ctx.headers['x-admin-phone'] || ctx.headers['x-user-phone'])
  const headerPhoneAccount = headerPhone ? await getAdminAccountByPhoneAcrossTenants(headerPhone, requestTenantId) : null
  const headerPhoneRole = headerPhoneAccount ? headerPhoneAccount.role : ''
  if (headerPhoneRole) {
    ctx.state.adminRole = headerPhoneRole
    ctx.state.adminAccount = headerPhoneAccount
    ctx.state._resolvedAdminRole = true
    return ctx.state.adminRole
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

  // 兼容旧前端：未携带角色信息时默认超管；开启 ENFORCE_ADMIN_RBAC 后必须显式传入角色。
  ctx.state.adminRole = ENFORCE_ADMIN_RBAC ? '' : ADMIN_ROLES.SUPER
  ctx.state._resolvedAdminRole = true
  return ctx.state.adminRole
}

async function resolveAdminAccount(ctx) {
  if (ctx.state && ctx.state._resolvedAdminAccount) {
    return ctx.state.adminAccount || null
  }
  await resolveAdminRole(ctx)
  ctx.state._resolvedAdminAccount = true
  return ctx.state.adminAccount || null
}

function roleMatchesAllowedRoles(role, allowedRoles, strict = false) {
  if (!role || !Array.isArray(allowedRoles)) return false
  if (allowedRoles.includes(role)) return true
  if (strict) return false
  if (isSuperEquivalentRole(role) && allowedRoles.some(a => isSuperEquivalentRole(a))) return true
  return false
}

async function enforcePlatformReadonlyForTenantWrite(ctx, actionLabel) {
  const account = await resolveAdminAccount(ctx)
  if (!account || account.scopeType !== 'platform') {
    return true
  }
  // 新策略：主系统平台账号拥有子系统完整权限（读/写/删）。
  void actionLabel
  return true
}

async function requireAdminPermission(ctx, allowedRoles, actionLabel, options = {}) {
  const strictRoles = Boolean(options.strictRoles)
  const role = await resolveAdminRole(ctx)
  if (!role) {
    fail(
      ctx,
      `未提供后台角色信息，无法执行${actionLabel}。请在请求头传 x-admin-role: super_admin / boss / reviewer / collector`,
      401,
    )
    return ''
  }
  const permissionKey = String(options.permissionKey || '').trim()
  const permissionAction = String(options.permissionAction || 'view').trim() || 'view'
  const account = await resolveAdminAccount(ctx)
  if (!account) {
    fail(ctx, '未识别到有效后台账号，请重新登录', 401)
    return ''
  }
  if (permissionKey) {
    if (!ADMIN_ROLE_SET.has(role)) {
      fail(ctx, `当前角色【${getRoleLabel(role)}】无权限执行${actionLabel}`, 403)
      return ''
    }
    if (!hasAdminPermission(account, permissionKey, permissionAction)) {
      fail(ctx, `当前账号无权限执行${actionLabel}`, 403)
      return ''
    }
  }
  else if (!ADMIN_ROLE_SET.has(role) || !roleMatchesAllowedRoles(role, allowedRoles, strictRoles)) {
    fail(ctx, `当前角色【${getRoleLabel(role)}】无权限执行${actionLabel}`, 403)
    return ''
  }
  if (account.scopeType === 'platform') {
    if (!(await resolveEffectiveTenantId(ctx))) {
      return ''
    }
    if (!(await enforcePlatformReadonlyForTenantWrite(ctx, actionLabel))) {
      return ''
    }
    return role || ADMIN_ROLES.SUPER
  }
  if (!(await resolveEffectiveTenantId(ctx))) {
    return ''
  }
  if (!(await enforcePlatformReadonlyForTenantWrite(ctx, actionLabel))) {
    return ''
  }
  return role
}

async function requireAdminPermissionOnAny(ctx, permissionKeys, permissionAction, actionLabel) {
  const role = await resolveAdminRole(ctx)
  if (!role) {
    fail(
      ctx,
      `未提供后台角色信息，无法执行${actionLabel}。请在请求头传 x-admin-role: super_admin / boss / reviewer / collector`,
      401,
    )
    return ''
  }
  const account = await resolveAdminAccount(ctx)
  if (!account) {
    fail(ctx, '未识别到有效后台账号，请重新登录', 401)
    return ''
  }
  if (!ADMIN_ROLE_SET.has(role)) {
    fail(ctx, `当前角色【${getRoleLabel(role)}】无权限执行${actionLabel}`, 403)
    return ''
  }
  if (!hasAdminPermissionOnAny(account, permissionKeys, permissionAction)) {
    fail(ctx, `当前账号无权限执行${actionLabel}`, 403)
    return ''
  }
  if (account.scopeType === 'platform') {
    if (!(await resolveEffectiveTenantId(ctx))) {
      return ''
    }
    if (!(await enforcePlatformReadonlyForTenantWrite(ctx, actionLabel))) {
      return ''
    }
    return role || ADMIN_ROLES.SUPER
  }
  if (!(await resolveEffectiveTenantId(ctx))) {
    return ''
  }
  if (!(await enforcePlatformReadonlyForTenantWrite(ctx, actionLabel))) {
    return ''
  }
  return role
}

async function requireAdminPermissionCompat(ctx, allowedRoles, actionLabel, options = {}) {
  const permissionKey = String(options.permissionKey || '').trim()
  const permissionAction = String(options.permissionAction || 'view').trim() || 'view'
  const legacyAction = String(options.legacyAction || '').trim()
  if (!legacyAction || !permissionKey) {
    return requireAdminPermission(ctx, allowedRoles, actionLabel, options)
  }
  const role = await resolveAdminRole(ctx)
  if (!role) {
    fail(ctx, `未提供后台角色信息，无法执行${actionLabel}`, 401)
    return ''
  }
  const account = await resolveAdminAccount(ctx)
  if (!account) {
    fail(ctx, '未识别到有效后台账号，请重新登录', 401)
    return ''
  }
  if (!ADMIN_ROLE_SET.has(role) || !hasAdminPermissionCompat(account, permissionKey, permissionAction, legacyAction)) {
    fail(ctx, `当前账号无权限执行${actionLabel}`, 403)
    return ''
  }
  if (account.scopeType === 'platform' && !(await resolveEffectiveTenantId(ctx))) {
    return ''
  }
  if (!(await resolveEffectiveTenantId(ctx))) {
    return ''
  }
  if (!(await enforcePlatformReadonlyForTenantWrite(ctx, actionLabel))) {
    return ''
  }
  return role
}

async function requireAdminMarkPaidPermission(ctx, actionLabel, permissionAction = 'markPaid') {
  return requireAdminPermission(ctx, [], actionLabel, {
    permissionKey: 'orders.cardData',
    permissionAction,
  })
}

function uniqueActions(actions) {
  return [...new Set(actions.map(action => String(action || '').trim()).filter(Boolean))]
}

function adminAccountPatchPermissionActions(payload) {
  const actions = []
  const body = payload && typeof payload === 'object' ? payload : {}
  const updateFields = ['username', 'phone', 'name', 'scopeType', 'tenantId', 'scopeTenantIds']
  if (updateFields.some(field => Object.prototype.hasOwnProperty.call(body, field))) actions.push('update')
  if (Object.prototype.hasOwnProperty.call(body, 'status')) actions.push('toggleStatus')
  if (Object.prototype.hasOwnProperty.call(body, 'role')) actions.push('changeRole')
  if (Object.prototype.hasOwnProperty.call(body, 'password')) actions.push('resetPassword')
  if (Object.prototype.hasOwnProperty.call(body, 'permissions')) actions.push('permission')
  return uniqueActions(actions.length ? actions : ['update'])
}

async function requireAdminAccountPatchPermissions(ctx, payload, actionLabel = '修改后台账号') {
  const role = await resolveAdminRole(ctx)
  if (!role) {
    fail(ctx, `未提供后台角色信息，无法执行${actionLabel}`, 401)
    return ''
  }
  const account = await resolveAdminAccount(ctx)
  if (!account) {
    fail(ctx, '未识别到有效后台账号，请重新登录', 401)
    return ''
  }
  if (!ADMIN_ROLE_SET.has(role)) {
    fail(ctx, `当前角色【${getRoleLabel(role)}】无权限执行${actionLabel}`, 403)
    return ''
  }
  const actions = adminAccountPatchPermissionActions(payload)
  for (const action of actions) {
    const allowed = hasAdminPermission(account, 'accounts', action)
      || (action !== 'permission' && hasAdminPermission(account, 'tenants.system', 'update'))
    if (!allowed) {
      fail(ctx, `当前账号无权限执行${actionLabel}`, 403)
      return ''
    }
  }
  if (account.scopeType === 'platform') {
    if (!(await resolveEffectiveTenantId(ctx))) {
      return ''
    }
    if (!(await enforcePlatformReadonlyForTenantWrite(ctx, actionLabel))) {
      return ''
    }
    return role || ADMIN_ROLES.SUPER
  }
  if (!(await resolveEffectiveTenantId(ctx))) {
    return ''
  }
  if (!(await enforcePlatformReadonlyForTenantWrite(ctx, actionLabel))) {
    return ''
  }
  return actions[0] || 'update'
}

async function requirePlatformAccountPatchPermissions(ctx, payload, actionLabel = '修改主系统账号') {
  const actions = adminAccountPatchPermissionActions(payload)
  let account = null
  for (const action of actions) {
    account = await requirePlatformScope(ctx, actionLabel, { permissionKey: 'accounts', permissionAction: action })
    if (!account) {
      return null
    }
  }
  return account
}

function trafficChannelPatchPermissionActions(payload) {
  const actions = []
  const body = payload && typeof payload === 'object' ? payload : {}
  if (Object.prototype.hasOwnProperty.call(body, 'name')) actions.push('editChannel')
  if (Object.prototype.hasOwnProperty.call(body, 'remark')) actions.push('remark')
  if (Object.prototype.hasOwnProperty.call(body, 'disabled')) actions.push('toggleStatus')
  if (Object.prototype.hasOwnProperty.call(body, 'portalUsername')
    || Object.prototype.hasOwnProperty.call(body, 'portalPassword')) {
    actions.push('bindPortalAccount')
  }
  return uniqueActions(actions.length ? actions : ['editChannel'])
}

async function requireTrafficActions(ctx, actions, actionLabel) {
  for (const action of uniqueActions(actions)) {
    if (!await requireAdminPermission(ctx, [ADMIN_ROLES.SUPER], actionLabel, { permissionKey: 'traffic', permissionAction: action })) {
      return ''
    }
  }
  return true
}

function trafficPartnerPatchPermissionActions(payload) {
  const body = payload && typeof payload === 'object' ? payload : {}
  const actions = []
  if (Object.prototype.hasOwnProperty.call(body, 'status')) actions.push('toggleStatus')
  if (Object.prototype.hasOwnProperty.call(body, 'channelCodes')
    || Object.prototype.hasOwnProperty.call(body, 'username')
    || Object.prototype.hasOwnProperty.call(body, 'password')) {
    actions.push('bindPortalAccount')
  }
  if (Object.prototype.hasOwnProperty.call(body, 'name')) actions.push('editChannel')
  return uniqueActions(actions.length ? actions : ['editChannel'])
}

async function requireAdminShipmentTrackingPermission(ctx, actionLabel) {
  const role = await resolveAdminRole(ctx)
  if (!role) {
    fail(
      ctx,
      `未提供后台角色信息，无法执行${actionLabel}。请在请求头传 x-admin-role: super_admin / boss / reviewer / collector`,
      401,
    )
    return ''
  }
  const account = await resolveAdminAccount(ctx)
  if (!account) {
    fail(ctx, '未识别到有效后台账号，请重新登录', 401)
    return ''
  }
  if (!ADMIN_ROLE_SET.has(role)) {
    fail(ctx, `当前角色【${getRoleLabel(role)}】无权限执行${actionLabel}`, 403)
    return ''
  }
  if (!hasAdminShipmentTrackingPermission(account)) {
    fail(ctx, `当前账号无权限执行${actionLabel}`, 403)
    return ''
  }
  if (account.scopeType === 'platform') {
    if (!(await resolveEffectiveTenantId(ctx))) {
      return ''
    }
    if (!(await enforcePlatformReadonlyForTenantWrite(ctx, actionLabel))) {
      return ''
    }
    return role || ADMIN_ROLES.SUPER
  }
  if (!(await resolveEffectiveTenantId(ctx))) {
    return ''
  }
  if (!(await enforcePlatformReadonlyForTenantWrite(ctx, actionLabel))) {
    return ''
  }
  return role
}

async function requireAdminUsersListView(ctx, actionLabel) {
  const view = normalizeAdminUsersListView(ctx.query?.view)
  return requireAdminPermission(ctx, [], actionLabel, {
    permissionKey: adminUsersPermissionKeyForView(view),
    permissionAction: 'view',
  })
}

async function requireAdminUsersActionOnAny(ctx, action, actionLabel) {
  const role = await resolveAdminRole(ctx)
  if (!role) {
    fail(
      ctx,
      `未提供后台角色信息，无法执行${actionLabel}。请在请求头传 x-admin-role: super_admin / boss / reviewer / collector`,
      401,
    )
    return ''
  }
  const account = await resolveAdminAccount(ctx)
  if (!account) {
    fail(ctx, '未识别到有效后台账号，请重新登录', 401)
    return ''
  }
  if (!ADMIN_ROLE_SET.has(role)) {
    fail(ctx, `当前角色【${getRoleLabel(role)}】无权限执行${actionLabel}`, 403)
    return ''
  }
  const keys = ['users.registered', 'users.noOrder', 'users.ordering', 'users.cardPackageIssued']
  const allowed = keys.some(key => hasAdminPermission(account, key, action))
  if (!allowed) {
    fail(ctx, `当前账号无权限执行${actionLabel}`, 403)
    return ''
  }
  if (account.scopeType === 'platform') {
    if (!(await resolveEffectiveTenantId(ctx))) {
      return ''
    }
    if (!(await enforcePlatformReadonlyForTenantWrite(ctx, actionLabel))) {
      return ''
    }
    return role || ADMIN_ROLES.SUPER
  }
  if (!(await resolveEffectiveTenantId(ctx))) {
    return ''
  }
  if (!(await enforcePlatformReadonlyForTenantWrite(ctx, actionLabel))) {
    return ''
  }
  return role
}

/** 用户页注册渠道筛选项：具备任一用户列表查看权或流量管理查看权即可 */
async function requireAdminTrafficChannelsRead(ctx, actionLabel = '查看流量渠道') {
  const role = await resolveAdminRole(ctx)
  if (!role) {
    fail(
      ctx,
      `未提供后台角色信息，无法执行${actionLabel}。请在请求头传 x-admin-role: super_admin / boss / reviewer / collector`,
      401,
    )
    return ''
  }
  const account = await resolveAdminAccount(ctx)
  if (!account) {
    fail(ctx, '未识别到有效后台账号，请重新登录', 401)
    return ''
  }
  if (!ADMIN_ROLE_SET.has(role)) {
    fail(ctx, `当前角色【${getRoleLabel(role)}】无权限执行${actionLabel}`, 403)
    return ''
  }
  const allowed = hasAdminPermission(account, 'traffic', 'view')
    || hasAdminUsersPermissionOnAny(account, 'view')
  if (!allowed) {
    fail(ctx, `当前账号无权限执行${actionLabel}`, 403)
    return ''
  }
  if (account.scopeType === 'platform') {
    if (!(await resolveEffectiveTenantId(ctx))) {
      return ''
    }
    return role || ADMIN_ROLES.SUPER
  }
  if (!(await resolveEffectiveTenantId(ctx))) {
    return ''
  }
  return role
}

async function requireAdminOrderDeletePermission(ctx) {
  const role = await resolveAdminRole(ctx)
  if (!role) {
    fail(
      ctx,
      '未提供后台角色信息，无法执行删除订单。请在请求头传 x-admin-role: super_admin / boss / reviewer / collector',
      401,
    )
    return ''
  }
  const account = await resolveAdminAccount(ctx)
  if (!account) {
    fail(ctx, '未识别到有效后台账号，请重新登录', 401)
    return ''
  }
  if (!ADMIN_ROLE_SET.has(role)) {
    fail(ctx, `当前角色【${getRoleLabel(role)}】无权限执行删除订单`, 403)
    return ''
  }
  const db = readDb()
  const { id } = ctx.params
  const idx = db.orders.findIndex(item => item.id === id)
  if (idx < 0) {
    fail(ctx, '订单不存在', 404)
    return ''
  }
  const target = db.orders[idx]
  if (!hasAdminOrderDeletePermission(account, target.status)) {
    fail(ctx, '当前账号无权限执行删除订单', 403)
    return ''
  }
  if (account.scopeType === 'platform') {
    if (!(await resolveEffectiveTenantId(ctx))) {
      return ''
    }
    if (!(await enforcePlatformReadonlyForTenantWrite(ctx, '删除订单'))) {
      return ''
    }
    ctx.state._orderDeleteCtx = { db, idx, id }
    return role || ADMIN_ROLES.SUPER
  }
  if (!(await resolveEffectiveTenantId(ctx))) {
    return ''
  }
  if (!(await enforcePlatformReadonlyForTenantWrite(ctx, '删除订单'))) {
    return ''
  }
  ctx.state._orderDeleteCtx = { db, idx, id }
  return role
}

async function resolveEffectiveTenantId(ctx) {
  const requestTenant = normalizeTenantId(ctx.state && ctx.state.tenantId ? ctx.state.tenantId : 'default')
  const requestWorkspaceType = normalizeWorkspaceType(ctx.state && ctx.state.workspaceType ? ctx.state.workspaceType : 'tenant')
  const account = await resolveAdminAccount(ctx)
  if (!account) {
    ctx.state.effectiveTenantId = requestTenant
    ctx.state.effectiveWorkspaceType = requestWorkspaceType
    setCurrentWorkspace(requestWorkspaceType, requestTenant)
    return requestTenant
  }
  if (account.scopeType === 'platform') {
    if (requestWorkspaceType === 'tenant' && !accountCanAccessTenant(account, requestTenant)) {
      fail(ctx, '当前平台账号无权限访问该子系统', 403)
      return ''
    }
    ctx.state.effectiveTenantId = requestTenant
    ctx.state.effectiveWorkspaceType = requestWorkspaceType
    setCurrentWorkspace(requestWorkspaceType, requestTenant)
    return requestTenant
  }
  const accountTenant = normalizeTenantId(account.tenantId || 'default')
  ctx.state.effectiveTenantId = accountTenant
  ctx.state.effectiveWorkspaceType = 'tenant'
  setCurrentTenant(accountTenant)
  if (requestTenant !== accountTenant) {
    ctx.set('x-tenant-id', accountTenant)
  }
  return accountTenant
}

/** 从副标题文案解析「赠送价值2000现金卡包」类金额（元），无匹配则 0 */
function inferCardPackageAmountYuanFromSubtitle(subtitle) {
  const s = String(subtitle || '')
  const m = s.match(/价值\s*(\d+(?:\.\d+)?)/)
  if (!m)
    return 0
  const n = Number(m[1])
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0
}

function normalizeProductDetailImages(product) {
  const raw = product?.detailImages
  if (Array.isArray(raw)) {
    return raw.map(item => String(item || '').trim()).filter(Boolean)
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        return parsed.map(item => String(item || '').trim()).filter(Boolean)
      }
    }
    catch {
      // ignore
    }
  }
  return []
}

function normalizeProductRecord(product) {
  const now = new Date().toISOString()
  const rawMode = String(product.salesMode || '').trim()
  const salesMode = PRODUCT_SALES_MODES.has(rawMode) ? rawMode : 'installment'
  const hasExplicitCardPackage = Object.prototype.hasOwnProperty.call(product, 'cardPackageAmount')
    && product.cardPackageAmount !== null
    && product.cardPackageAmount !== undefined
    && (typeof product.cardPackageAmount !== 'string' || String(product.cardPackageAmount).trim() !== '')
  let cardPackageAmount = Number(product.cardPackageAmount)
  if (!Number.isFinite(cardPackageAmount) || cardPackageAmount < 0) {
    cardPackageAmount = 0
  }
  else {
    cardPackageAmount = Math.round(cardPackageAmount)
  }
  if (!hasExplicitCardPackage && salesMode === 'installment') {
    cardPackageAmount = inferCardPackageAmountYuanFromSubtitle(product.subtitle)
  }
  /** 首页商城专区：卡包金额统一为 0，不从副标题推断也不沿用错误存量字段 */
  if (salesMode === 'mall') {
    cardPackageAmount = 0
  }
  const detailImages = normalizeProductDetailImages(product)
  return {
    id: Number(product.id),
    name: String(product.name || '').trim(),
    subtitle: String(product.subtitle || '').trim(),
    description: String(product.description || '').trim(),
    origin: String(product.origin || '').trim(),
    price: Number(product.price || 0),
    image: String(product.image || '').trim(),
    detailImages,
    category: resolveProductCategoryKey(product.category),
    salesMode,
    cardPackageAmount,
    onSale: typeof product.onSale === 'boolean' ? product.onSale : true,
    createdAt: product.createdAt || now,
    updatedAt: product.updatedAt || product.createdAt || now,
  }
}

function parseProductDetailImagesPayload(raw) {
  if (raw === undefined) {
    return { ok: true, images: undefined }
  }
  let arr = raw
  if (typeof raw === 'string') {
    try {
      arr = JSON.parse(raw)
    }
    catch {
      return { ok: false, error: 'detailImages 须为 JSON 数组或数组字段' }
    }
  }
  if (!Array.isArray(arr)) {
    return { ok: false, error: 'detailImages 须为非空字符串 URL 的数组' }
  }
  const images = arr.map(item => String(item || '').trim()).filter(Boolean)
  if (images.length > 40) {
    return { ok: false, error: '商品详情图最多 40 张' }
  }
  return { ok: true, images }
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

  if (payload.detailImages !== undefined) {
    const parsedDi = parseProductDetailImagesPayload(payload.detailImages)
    if (!parsedDi.ok) {
      return { error: parsedDi.error }
    }
    next.detailImages = parsedDi.images
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

  if (payload.cardPackageAmount !== undefined) {
    const cap = Number(payload.cardPackageAmount)
    if (!Number.isFinite(cap) || cap < 0) {
      return { error: '卡包金额须为非负数字' }
    }
    next.cardPackageAmount = Math.round(cap)
  }

  if (payload.onSale !== undefined) {
    next.onSale = normalizeBoolean(payload.onSale, true)
  }

  if (payload.salesMode !== undefined) {
    const sm = String(payload.salesMode || '').trim()
    if (!PRODUCT_SALES_MODES.has(sm)) {
      return { error: '销售渠道必须为 mall（首页商城）或 installment（先享后付可下单）' }
    }
    next.salesMode = sm
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
    if (next.salesMode === undefined) {
      next.salesMode = 'installment'
    }
  }

  return { data: next }
}

/**
 * 商品列表完全以持久化层（Mongo / db.json）为准，不再注入或改写模拟目录。
 * 仅修正历史数据中非法的 salesMode，避免接口报错。
 */
function ensureProductCatalog(db) {
  if (!Array.isArray(db.products)) {
    db.products = []
  }
  let changed = false
  for (const p of db.products) {
    const prev = String(p.salesMode || '').trim()
    if (!PRODUCT_SALES_MODES.has(prev)) {
      p.salesMode = 'installment'
      changed = true
    }
  }
  if (changed) {
    writeProductsDb(db)
  }
}

/**
 * 先享后付下单 7 步风控单条 → 管理端十四项 `fourteenRows` 中的对应槽位（与 `runOrderSubmitSingleRiskStep` 的 key 一致）
 * @param {Record<string, unknown>} s
 */
function riskProductRowFromOrderSubmitRiskStep(s) {
  const slotKey = String(s.key || s.slotKey || '').trim()
  const productLabel = String(
    s.label || ORDER_INSTALLMENT_RISK_STEP_LABELS[slotKey] || slotKey,
  )
  if (s.skipped) {
    return {
      slotKey,
      productLabel,
      state: 'skipped',
      skippedReason: String(s.reason || ''),
      httpStatus: s.httpStatus != null ? Number(s.httpStatus) : undefined,
      rawResponse: s.response ?? null,
    }
  }
  const ok = s.ok === true
  return {
    slotKey,
    productLabel,
    state: ok ? 'ok' : 'fail',
    httpStatus: s.httpStatus != null ? Number(s.httpStatus) : undefined,
    error: ok ? undefined : String(s.error || ''),
    rawResponse: s.response ?? null,
  }
}

/** 管理端手动调取全景雷达时保留的历史条数上限（仅追加，不影响 fourteenRows 最新槽位） */
const RADAR_V4_MANUAL_HISTORY_MAX = 30

function findRadarV4RowInFourteenRows(fourteenRows) {
  if (!Array.isArray(fourteenRows)) {
    return null
  }
  const row = fourteenRows.find(r => r && r.slotKey === 'radar_v4_enc')
  if (!row || row.state === 'skipped') {
    return null
  }
  return row
}

function radarV4RowContentKey(row) {
  if (!row || typeof row !== 'object') {
    return ''
  }
  try {
    return JSON.stringify({
      state: row.state,
      error: row.error ?? '',
      httpStatus: row.httpStatus ?? null,
      rawResponse: row.rawResponse ?? null,
    })
  }
  catch {
    return String(row.state || '')
  }
}

function cloneRadarV4HistoryEntries(raw) {
  if (!Array.isArray(raw)) {
    return []
  }
  return raw
    .filter(item => item && typeof item === 'object' && item.row && item.fetchedAt)
    .map(item => ({
      fetchedAt: String(item.fetchedAt),
      row: { ...item.row },
    }))
}

/**
 * 手动调取 radar_v4_enc 成功后追加一条历史（新条目在前）。
 * 若 fourteenRows 中仍有本次覆盖前的雷达快照且尚未入库，会先归档一条，避免「仅保留最后一次」。
 */
function appendRadarV4ManualHistory(prevSnapshot, row, fetchedAtIso) {
  const history = cloneRadarV4HistoryEntries(prevSnapshot?.radarV4History)
  const newEntry = { fetchedAt: fetchedAtIso, row: { ...row } }
  const prevRow = findRadarV4RowInFourteenRows(prevSnapshot?.fourteenRows)
  const newKey = radarV4RowContentKey(row)
  const prevKey = prevRow ? radarV4RowContentKey(prevRow) : ''

  history.unshift(newEntry)

  if (prevRow && prevKey && prevKey !== newKey) {
    const alreadyArchived = history.some(
      (item, idx) => idx !== 0 && radarV4RowContentKey(item.row) === prevKey,
    )
    if (!alreadyArchived) {
      const seedAt = String(prevSnapshot?.checkedAt || '').trim() || fetchedAtIso
      history.splice(1, 0, { fetchedAt: seedAt, row: { ...prevRow } })
    }
  }

  if (history.length > RADAR_V4_MANUAL_HISTORY_MAX) {
    history.length = RADAR_V4_MANUAL_HISTORY_MAX
  }
  return history
}

/**
 * 将本次下单已执行的接口结果合并进商城用户 `riskControlSnapshot`，供管理端风控弹窗与列表复用。
 */
function mergeInstallmentOrderRiskStepsIntoUserSnapshot(user, stepsRaw, checkedAtIso) {
  if (!user || !Array.isArray(stepsRaw) || stepsRaw.length === 0) {
    return
  }
  const prev = user.riskControlSnapshot && typeof user.riskControlSnapshot === 'object'
    ? { ...user.riskControlSnapshot }
    : {}
  let fourteenRows = Array.isArray(prev.fourteenRows) ? [...prev.fourteenRows] : null
  if (!fourteenRows || fourteenRows.length !== 14) {
    fourteenRows = normalizeFourteenProductRows([])
  }
  const byKey = new Map(fourteenRows.map((r, i) => [r.slotKey, i]))
  for (const raw of stepsRaw) {
    const row = riskProductRowFromOrderSubmitRiskStep(raw)
    if (!row.slotKey)
      continue
    const i = byKey.get(row.slotKey)
    if (i === undefined)
      continue
    fourteenRows[i] = row
  }
  const anyFail = fourteenRows.some(r => r.state === 'fail')
  user.riskControlSnapshot = {
    ...prev,
    fourteenRows,
    configured: isRiskUpstreamConfigured(),
    simulated: false,
    passed: !anyFail,
    checkedAt: checkedAtIso || new Date().toISOString(),
    summaryMessage: typeof prev.summaryMessage === 'string' ? prev.summaryMessage : '',
    userId: user.id,
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function buildOrderRiskDetail(order, db) {
  ensureOrderRiskState(order)
  const totalAmount = Number(order.totalAmount || 0)
  const periods = Number(order.installmentPeriods || (Array.isArray(order.installmentPlan) ? order.installmentPlan.length : 1) || 1)
  let phoneForRiskTail = ''
  if (db && Array.isArray(db.users)) {
    const buyer = resolveMallBuyerFromOrder(db, order)
    if (buyer) {
      let p = normalizePhone(buyer.phone || '')
      if (p.startsWith('86') && p.length === 13) {
        p = p.slice(2)
      }
      if (/^1\d{10}$/.test(p)) {
        phoneForRiskTail = p
      }
    }
  }
  const phoneTail = Number(String(phoneForRiskTail || '').slice(-2) || '0')
  const baseScore = Math.round(totalAmount / Math.max(1, periods)) + phoneTail
  const riskScore = order.riskStatus === 'failed'
    ? Math.min(5000, baseScore + 420)
    : Math.max(300, baseScore - 180)
  const threshold = 2200
  const checkedAt = order.riskCheckedAt || order.createdAt || new Date().toISOString()
  const decision = order.riskStatus === 'failed' ? '拒绝' : '通过'
  const reason = order.riskStatus === 'failed'
    ? (order.riskReason || '风险评分超阈值，建议降低订单金额或稍后重试')
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
      name: '先享后付期数风险',
      hit: periods > 1,
      scoreImpact: periods > 1 ? 120 : 0,
      detail: periods > 1
        ? `先享后付期数 ${periods} 期，期数越长违约不确定性越高`
        : '当前为单期还款，无多期展期风险',
    },
    {
      code: 'R003',
      name: '手机号尾号特征',
      hit: phoneTail >= 70,
      scoreImpact: phoneTail >= 70 ? 60 : 0,
      detail: `手机号尾号 ${String(phoneForRiskTail || '').slice(-2) || '--'} 参与辅助评分`,
    },
  ]

  const factors = [
    `订单金额：¥${totalAmount}`,
    `支付方式：${order.payType === 'installment' ? '先享后付' : '全款'}`,
    `先享后付期数：${periods} 期`,
    `手机号尾号：${String(phoneForRiskTail || '').slice(-2) || '--'}`,
  ]

  /** 与后台「用户风控」卡片口径一致：订单详情接口当前为简化摘要，十四槽位未在此接口实测时展示为未测/跳过 */
  const testedSlotCount = 0
  const okSlotCount = 0
  const failSlotCount = 0
  const skippedSlotCount = 14

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
    testedSlotCount,
    okSlotCount,
    failSlotCount,
    skippedSlotCount,
  }
}

function buildInstallmentPlan(totalAmount, payType, repayAnchorAt, paid, installmentPeriods) {
  const parsedAmount = Number(totalAmount || 0)
  if (payType !== 'installment') {
    return [{
      period: 1,
      dueDate: addMonths(repayAnchorAt, 1),
      principal: parsedAmount,
      fee: 0,
      amount: parsedAmount,
      paid: Boolean(paid),
    }]
  }

  /** 仅支持单期：应还总额=订单 totalAmount；还款日为卡包发放后第 10 天，未发放前为空。 */
  const principal = Number(parsedAmount.toFixed(2))
  return [{
    period: 1,
    dueDate: installmentDueDateFromRepayAnchor(repayAnchorAt),
    principal,
    fee: 0,
    amount: principal,
    paid: Boolean(paid),
  }]
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
    // 不信任「order.paid 则强行首期已还」的内存补丁：会与持久化快照不一致，
    // 导致 /bills（用户端）与 /orders（后台）展示分裂。首期是否已还以存储与 PATCH pay / 先享后付接口为准。
    return
  }
  order.installmentPlan = buildInstallmentPlan(
    order.totalAmount,
    order.payType,
    installmentRepayAnchorForOrder(order),
    order.paid,
    order.installmentPeriods,
  )
}

/**
 * 历史数据：旧版在内存中把「订单已付 + 先享后付」的首期标为已还，但未写库，导致用户端与后台、与持久化不一致。
 * 若库里 order.paid 为 true 且还款详情里没有任何一期 paid，则把第 1 期写入 paid（幂等，只补缺）。
 * 若已对应用 installmentScheduleExplicit（见 PATCH installments pay），则说明先享后付状态以人工/接口为准，不再回填首期。
 * @returns {boolean} 是否修改了该订单
 */
function persistLegacyInstallmentFirstPaidIfOrderPaid(order) {
  /** 管理员或接口已显式调整过先享后付入账状态后，不得以「订单已付」为由再自动把首期标已还 */
  if (order.installmentScheduleExplicit) {
    return false
  }
  if (order.payType !== 'installment' || !order.paid) {
    return false
  }
  const plan = order.installmentPlan
  if (!Array.isArray(plan) || plan.length === 0) {
    return false
  }
  if (plan.some(item => item && installmentItemIsPaid(item))) {
    return false
  }
  const first = plan.find(item => item && Number(item.period) === 1) || plan[0]
  if (!first || installmentItemIsPaid(first)) {
    return false
  }
  first.paid = true
  return true
}

/** 先享后付订单：全部先享后付已还则订单进入 enjoying（已完成）；若有任一期未还则从 enjoying 退回 shipping/receiving。
 * @param {{ ignoreAdminSkip?: boolean }} opts 为 true 时忽略 skipInstallmentAutoEnjoying（用户还款、标记先享后付等「真实入账」路径）
 */
function applyInstallmentCompletionOrderStatus(order, opts = {}) {
  const ignoreAdminSkip = opts.ignoreAdminSkip === true
  ensureOrderCardPackage(order)
  if (order.payType !== 'installment') {
    return false
  }
  const plan = order.installmentPlan
  if (!Array.isArray(plan) || plan.length === 0) {
    return false
  }
  const allPaid = plan.every(item => installmentItemIsPaid(item))
  if (allPaid) {
    if (order.status !== 'enjoying') {
      /** 后台手动改过订单状态后，列表接口 reconcile 不应再强行覆盖为 enjoying（否则前端「订单状态已更新」刷新仍显示已完成） */
      if (!ignoreAdminSkip && order.skipInstallmentAutoEnjoying === true) {
        return false
      }
      order.status = 'enjoying'
      order.skipInstallmentAutoEnjoying = false
      return true
    }
    return false
  }
  if (order.status === 'enjoying') {
    ensureOrderShipment(order)
    const tn = String(order.trackingNumber || '').trim()
    order.status = tn ? 'receiving' : 'shipping'
    return true
  }
  return false
}

/** 幂等：只有已还清的先享后付订单，才可对齐为 enjoying（已完成） */
function reconcileCardPackageIssuedToEnjoying(order) {
  ensureOrderCardPackage(order)
  if (order.payType !== 'installment' || !order.cardPackageIssued || !isMallOrderRepaymentSettled(order)) {
    return false
  }
  if (order.status === 'enjoying') {
    return false
  }
  order.status = 'enjoying'
  return true
}

/**
 * 旧版曾把先享后付订单 totalAmount 写成「商品小计 × 1.35」。与当前规则（totalAmount=商品小计）不一致。
 * 若当前 total 与 sub×1.35 在容差内匹配，则回写 totalAmount=sub 并重建 installmentPlan（保留首期是否已还）。
 * @returns {boolean} 是否修改了任意订单
 */
function reconcileLegacyInstallmentTotalAmountFrom135(db) {
  const products = Array.isArray(db.products) ? db.products : []
  const productsById = new Map()
  for (const p of products) {
    const row = normalizeProductRecord(p)
    productsById.set(String(row.id), row)
  }
  let changed = false
  for (const order of db.orders || []) {
    if (order.payType !== 'installment') {
      continue
    }
    const pid = String(order.productId || '').trim()
    if (!pid) {
      continue
    }
    const product = productsById.get(pid)
    if (!product || !Number.isFinite(Number(product.price))) {
      continue
    }
    const qty = Math.max(1, Number(order.quantity) || 1)
    const sub = Number((Number(product.price) * qty).toFixed(2))
    if (!(sub > 0)) {
      continue
    }
    const total = Number(order.totalAmount)
    if (!Number.isFinite(total)) {
      continue
    }
    const inflated = Number((sub * 1.35).toFixed(2))
    const tolerance = Math.max(0.15, Math.abs(inflated) * 0.0005)
    if (Math.abs(total - inflated) > tolerance) {
      continue
    }
    const prevPaid = Boolean(order.paid)
      || (Array.isArray(order.installmentPlan) && order.installmentPlan.some(item => item && item.paid))
    order.totalAmount = sub
    order.installmentPlan = buildInstallmentPlan(
      sub,
      'installment',
      installmentRepayAnchorForOrder(order),
      prevPaid,
      order.installmentPeriods,
    )
    changed = true
  }
  return changed
}

/**
 * 幂等修正订单衍生字段（状态、卡包金额、先享后付还清等）。
 * 性能：仅在写路径、启动、还款 POST 等调用；不在 GET 轮询路径执行。
 * @returns {boolean} 是否修改了任意订单
 */
function reconcileInstallmentCompletionAcrossDb(db) {
  let changed = false
  if (reconcileLegacyInstallmentTotalAmountFrom135(db)) {
    changed = true
  }
  for (const order of db.orders) {
    ensureOrderInstallmentPlan(order)
    if (ensureOrderCardPackageAmountFromProduct(db, order)) {
      changed = true
    }
    if (persistLegacyInstallmentFirstPaidIfOrderPaid(order)) {
      changed = true
    }
    if (applyInstallmentCompletionOrderStatus(order)) {
      changed = true
    }
    if (reconcileCardPackageIssuedToEnjoying(order)) {
      changed = true
    }
    if (reconcileInstallmentDueDateBeforeCardIssue(order)) {
      changed = true
    }
  }
  const todayKey = formatDate(new Date().toISOString())
  if (reconcileOverdueUserBlacklistAcrossDb(db, todayKey)) {
    writeUsersDb(db)
  }
  if (changed) {
    writeOrdersDb(db)
  }
}

/**
 * 订单卡包金额（元）：已落库则规范化；否则按商品卡包金额 × 数量回填（幂等，供对账写库）。
 * @returns {boolean} 是否写入了与之前不同的值
 */
function ensureOrderCardPackageAmountFromProduct(db, order) {
  const qty = Math.max(1, Math.floor(Number(order.quantity)) || 1)
  let resolved = 0
  let hasProduct = false
  const pid = String(order.productId || '').trim()
  if (pid) {
    const raw = (Array.isArray(db.products) ? db.products : []).find(p => p && String(p.id) === pid)
    if (raw) {
      hasProduct = true
      const product = normalizeProductRecord(raw)
      resolved = Math.max(0, Math.round(Number(product.cardPackageAmount) || 0)) * qty
    }
  }
  if (order.cardPackageAmount !== undefined && order.cardPackageAmount !== null) {
    const n = Number(order.cardPackageAmount)
    if (Number.isFinite(n) && n >= 0) {
      const rounded = Math.round(n)
      if (rounded !== Number(order.cardPackageAmount)) {
        order.cardPackageAmount = rounded
        return true
      }
      order.cardPackageAmount = rounded
      if (hasProduct && rounded !== resolved) {
        order.cardPackageAmount = resolved
        return true
      }
      return false
    }
  }
  if (Number(order.cardPackageAmount) === resolved) {
    order.cardPackageAmount = resolved
    return false
  }
  order.cardPackageAmount = resolved
  return true
}

function ensureOrderCardPackage(order) {
  if (typeof order.cardPackageIssued !== 'boolean') {
    order.cardPackageIssued = false
  }
  if (order.cardPackageIssuedAt === undefined || order.cardPackageIssuedAt === null) {
    order.cardPackageIssuedAt = ''
  }
  if (!order.cardPackageIssued && String(order.cardPackageIssuedAt || '').trim()) {
    order.cardPackageIssuedAt = ''
  }
  if (order.cardPackageContractNo === undefined || order.cardPackageContractNo === null) {
    order.cardPackageContractNo = ''
  }
  if (order.cardPackageContractSignaturePng === undefined || order.cardPackageContractSignaturePng === null) {
    order.cardPackageContractSignaturePng = ''
  }
  if (order.cardPackageContractPdfCacheFile === undefined || order.cardPackageContractPdfCacheFile === null) {
    order.cardPackageContractPdfCacheFile = ''
  }
}

/** 卡包合同：本地模拟签署（不调用开放平台电子签，仅流程约束） */
function isMallCardPackageContractMock() {
  return normalizeBoolean(process.env.MALL_CARD_PACKAGE_CONTRACT_MOCK, false)
}

function mallCardPackagePublicOrigin(ctx) {
  const explicit = String(process.env.MALL_PUBLIC_API_ORIGIN || '').trim().replace(/\/+$/, '')
  if (explicit && (explicit.startsWith('http://') || explicit.startsWith('https://'))) {
    return explicit
  }

  const xfProto = String(ctx.get('x-forwarded-proto') || '').trim().split(',')[0]
  const scheme = xfProto === 'https' ? 'https' : 'http'

  const reqHost = String(ctx.get('host') || '').trim().split(/\s+/)[0]
  const hostnameOnly = reqHost.replace(/^\[|\]$/g, '').split(':')[0]
  /** 发往 Koa 的 Host 若为公网/内网网关（非本地回环），优先用它拼装 iframe URL，不要用 X-Forwarded-Host（常为前端域名，易指错机） */
  const loopbackLike = !hostnameOnly
    || hostnameOnly === 'localhost'
    || hostnameOnly === '127.0.0.1'
    || hostnameOnly === '::1'

  if (reqHost && !loopbackLike)
    return `${scheme}://${reqHost}`

  const xfHost = String(ctx.get('x-forwarded-host') || '').trim().split(',')[0]
  if (xfHost)
    return `${scheme}://${xfHost}`

  if (typeof ctx.origin === 'string' && ctx.origin)
    return ctx.origin
  return `${ctx.protocol}://${ctx.host}`
}

/** 模拟签署：带用户信息 + 确认按钮的 HTML 页（非静态 PDF） */
function mallCardPackageMockSignPageUrl(ctx, orderId, phone) {
  const oid = encodeURIComponent(String(orderId || '').trim())
  const ph = encodeURIComponent(String(phone || '').trim())
  const tid = normalizeTenantId(ctx?.state?.tenantId || DEFAULT_TENANT_ID)
  /**
   * iframe 无法带 x-tenant-id。query 由 resolveTenantIdFromRequest 在无头时选用。
   * 始终附带 tenantId（含 default），避免仅依赖 Host、并与 contract-flow 当期租户严格一致。
   */
  const qs = `phone=${ph}&tenantId=${encodeURIComponent(tid)}`
  return `${mallCardPackagePublicOrigin(ctx)}/api/card-packages/${oid}/contract-view?${qs}`
}

function buildMockGetContractJson(ctx, order, contractNo, phone) {
  const pageUrl = mallCardPackageMockSignPageUrl(ctx, order.id, phone)
  const signed = Boolean(order.cardPackageContractSignedAt)
  const name = sanitizeCardPackageContractName(order)
  return {
    success: true,
    code: 0,
    msg: 'ok',
    data: {
      contractNo,
      contractName: name,
      status: signed ? '2' : '1',
      previewUrl: pageUrl,
      embeddedUrl: pageUrl,
      signUrl: pageUrl,
      signUser: [
        {
          account: phone,
          noticeMobile: phone,
          signUrl: pageUrl,
          signStatus: signed ? '2' : '1',
        },
      ],
    },
  }
}

/** 商城卡包领取：上游合同 JSON 是否视为成功 */
function mallUpstreamContractJsonOk(json) {
  if (!json || typeof json !== 'object') {
    return false
  }
  if (Object.prototype.hasOwnProperty.call(json, 'success') && json.success === false) {
    return false
  }
  const c = json.code ?? json.Code
  if (c !== undefined && c !== null && String(c).trim() !== '') {
    const cn = Number(c)
    if (!Number.isNaN(cn) && cn >= 400) {
      return false
    }
    const cs = String(c).trim().toLowerCase()
    if (['fail', 'false', 'error', '-1'].includes(cs)) {
      return false
    }
  }
  return true
}

function buildCardPackageContractNo(order) {
  const raw = String(order.id || '').replace(/[^a-zA-Z0-9]/g, '') || `OD${Date.now()}`
  const prefixed = `CP${raw}`
  return prefixed.slice(0, 40)
}

function sanitizeCardPackageContractName(order) {
  const fixed = String(process.env.MALL_CONTRACT_DOC_TITLE || '').trim()
  if (fixed) {
    const cleaned = fixed.replace(/[*":\\/<>|]/g, '').slice(0, 120)
    if (cleaned) {
      return cleaned
    }
  }
  let name = `先享后付订单-${String(order.name || '订单').trim()}`.slice(0, 120)
  name = name.replace(/[*":\\/<>|]/g, '')
  if (!name) {
    name = '商品购销及服务协议'
  }
  return name
}

function safeCardPackageContractPdfFileName(order) {
  let base = sanitizeCardPackageContractName(order)
    .replace(/[\x00-\x1f<>:"/\\|?*\uFFFD]/g, '_')
    .trim()
    .slice(0, 120) || '合同'
  base = base.replace(/\.pdf$/i, '')
  return `${base}.pdf`
}

/** 模拟合同 PDF 磁盘缓存目录（首次生成慢，命中后等同静态文件下载） */
const MOCK_CARD_PACKAGE_PDF_CACHE_DIR = path.join(API_PUBLIC_DIR, 'generated', 'card-package-contracts')

/** 同一缓存键并发只跑一趟 Chromium，减轻内存与 CPU 尖峰（降低 502 概率） */
const mockCardPackagePdfBuildInFlight = new Map()

function makeMockCardPackagePdfCacheFilename(order, user, phone, contractNo, apiOrigin) {
  const signedAt = String(order.cardPackageContractSignedAt || '')
  const sig = String(order.cardPackageContractSignaturePng || '')
  const userPart = user
    ? [user.name, user.idNumber, user.locationText].map(x => String(x || '')).join('\t')
    : ''
  const raw = [
    String(phone),
    String(order.id),
    String(contractNo),
    signedAt,
    String(sig.length),
    sig.slice(0, 500),
    String(order.name || ''),
    String(order.spec || ''),
    String(order.totalAmount ?? ''),
    String(order.receiverName || ''),
    String(order.receiverPhone || ''),
    String(order.receiverAddress || ''),
    String(order.createdAt || ''),
    userPart,
    String(apiOrigin || ''),
  ].join('\n')
  const hex = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32)
  return `cpdf-${hex}.pdf`
}

async function readMockCardPackagePdfCache(filename) {
  if (!filename || !/^cpdf-[a-f0-9]{32}\.pdf$/i.test(filename)) {
    return null
  }
  const full = path.join(MOCK_CARD_PACKAGE_PDF_CACHE_DIR, filename)
  try {
    const st = await fsp.stat(full)
    if (st.size < 64) {
      return null
    }
    return await fsp.readFile(full)
  }
  catch {
    return null
  }
}

async function unlinkMockCardPackagePdfCacheFile(order) {
  ensureOrderCardPackage(order)
  const fn = String(order.cardPackageContractPdfCacheFile || '').trim()
  order.cardPackageContractPdfCacheFile = ''
  if (!fn || !/^cpdf-[a-f0-9]{32}\.pdf$/i.test(fn)) {
    return
  }
  await fsp.unlink(path.join(MOCK_CARD_PACKAGE_PDF_CACHE_DIR, fn)).catch(() => {})
}

/**
 * 生成或读取缓存的模拟卡包合同 PDF（避免每次下载都跑 Chromium）。
 * 调试可加 query nocache=1 跳过缓存。
 */
async function getOrBuildMockCardPackagePdfBuffer(ctx, db, order, user, phone, contractNo, skipCache) {
  const apiOrigin = mallCardPackagePublicOrigin(ctx)
  const filename = makeMockCardPackagePdfCacheFilename(order, user || null, phone, contractNo, apiOrigin)
  if (!skipCache) {
    const hit = await readMockCardPackagePdfCache(filename)
    if (hit) {
      return hit
    }
  }
  let inflight = mockCardPackagePdfBuildInFlight.get(filename)
  if (inflight) {
    return await inflight
  }
  inflight = (async () => {
    try {
      await fsp.mkdir(MOCK_CARD_PACKAGE_PDF_CACHE_DIR, { recursive: true })
      const buf = await buildCardPackageContractPdfBuffer({
        order,
        user: user || null,
        phone,
        contractNo,
        contractTitle: sanitizeCardPackageContractName(order),
        signedAt: order.cardPackageContractSignedAt || '',
        apiOrigin,
        orderId: order.id,
        scopeTenantId: normalizeTenantId(ctx.state?.tenantId || DEFAULT_TENANT_ID),
      })
      await fsp.writeFile(path.join(MOCK_CARD_PACKAGE_PDF_CACHE_DIR, filename), buf).catch((e) => {
        console.warn('[card-package-pdf-cache-write]', e && e.message ? String(e.message) : e)
      })
      const prev = String(order.cardPackageContractPdfCacheFile || '').trim()
      order.cardPackageContractPdfCacheFile = filename
      if (prev && prev !== filename && /^cpdf-[a-f0-9]{32}\.pdf$/i.test(prev)) {
        await fsp.unlink(path.join(MOCK_CARD_PACKAGE_PDF_CACHE_DIR, prev)).catch(() => {})
      }
      writeOrderDb(db, order)
      return buf
    }
    finally {
      mockCardPackagePdfBuildInFlight.delete(filename)
    }
  })()
  mockCardPackagePdfBuildInFlight.set(filename, inflight)
  return await inflight
}

/**
 * 卡包电子签创建合同时，上游通常要求 contractFiles 为可拉取的 PDF URL 数组。
 * 配置其一即可：
 * - MALL_CARD_PACKAGE_CONTRACT_FILE_URL：单个 URL
 * - MALL_CARD_PACKAGE_CONTRACT_FILE_URLS：逗号/分号/换行分隔，或以 JSON 数组形式
 */
function resolveMallCardPackageContractFileUrls() {
  const single = String(process.env.MALL_CARD_PACKAGE_CONTRACT_FILE_URL || '').trim()
  const multi = String(process.env.MALL_CARD_PACKAGE_CONTRACT_FILE_URLS || '').trim()
  const list = []
  if (multi.startsWith('[')) {
    try {
      const parsed = JSON.parse(multi)
      if (Array.isArray(parsed)) {
        for (const x of parsed) {
          const u = String(x || '').trim()
          if (u) {
            list.push(u)
          }
        }
      }
    }
    catch (_) {
      /* ignore */
    }
  }
  if (list.length === 0 && multi) {
    for (const part of multi.split(/[,;|\n]+/)) {
      const u = part.trim()
      if (u) {
        list.push(u)
      }
    }
  }
  if (list.length === 0 && single) {
    list.push(single)
  }
  return list
}

function mallUpstreamContractErrorMessage(json) {
  if (!json || typeof json !== 'object') {
    return '电子合同接口异常'
  }
  const s = json.msg ?? json.message ?? json.info ?? json.Msg ?? json.Message ?? json.Info
  const t = String(s || '').trim()
  return t || '电子合同接口异常'
}

function resolveSignAuthSerialNo(db, phone) {
  const envSerial = String(process.env.MALL_CARD_PACKAGE_SIGN_AUTH_SERIAL || '').trim()
  if (envSerial) {
    return envSerial
  }
  const user = db.users.find(item => item.phone === phone)
  if (user && typeof user.signAuthSerialNo === 'string') {
    const s = user.signAuthSerialNo.trim()
    if (s) {
      return s
    }
  }
  return ''
}

/**
 * 卡包电子签：添加签署方前先在签约平台登记个人用户（与人脸/实名 serialNo 绑定）。
 * 无 serial 时跳过；失败仅打日志，仍继续尝试 addSigner（兼容已登记用户）。
 */
async function ensureEsignPersonalUserForCardPackage(db, phone) {
  const serialNo = resolveSignAuthSerialNo(db, phone)
  if (!serialNo) {
    return
  }
  try {
    const res = await postAddPersonalUser({ account: phone, serialNo })
    if (mallUpstreamContractJsonOk(res.json)) {
      return
    }
    const msg = mallUpstreamContractErrorMessage(res.json)
    if (/已|重复|exist|registered|成功/i.test(msg)) {
      return
    }
    console.warn('[card-package] addPersonalUser:', msg)
  }
  catch (err) {
    console.warn('[card-package] addPersonalUser:', err && err.message ? String(err.message) : err)
  }
}

function cardPackageAddSignerFailHint() {
  return '若提示签名或签署方错误，请为人脸/实名认证返回的 serialNo 配置到用户字段 signAuthSerialNo（管理端 PATCH）或临时使用环境变量 MALL_CARD_PACKAGE_SIGN_AUTH_SERIAL（仅联调），并确认上游「添加个人用户」与「添加签署方」使用同一 account（手机号）。'
}

function findMallCardPackageClaimOrder(db, phone, orderId) {
  const id = String(orderId || '').trim()
  if (!id) {
    return null
  }
  const mallUser = resolveRegisteredMallUserByNormalizedPhone(db, phone)
  const order = db.orders.find(item => String(item.id) === id)
  if (!order || !mallUser || !orderBelongsToRegisteredMallUser(db, order, mallUser)) {
    return null
  }
  if (!isOrderCardPackageEligible(order)) {
    return null
  }
  ensureOrderCardPackage(order)
  if (order.cardPackageIssued) {
    return null
  }
  return order
}

/** 卡包合同查看/预览：已发放卡包且已签署（或有合同编号）的订单仍可拉取 contract-flow / contract-view */
function findMallCardPackageContractViewOrder(db, phone, orderId) {
  const fromClaim = findMallCardPackageClaimOrder(db, phone, orderId)
  if (fromClaim) {
    return fromClaim
  }
  const id = String(orderId || '').trim()
  if (!id) {
    return null
  }
  const mallUser = resolveRegisteredMallUserByNormalizedPhone(db, phone)
  const order = db.orders.find(item => String(item.id) === id)
  if (!order || !mallUser || !orderBelongsToRegisteredMallUser(db, order, mallUser)) {
    return null
  }
  if (!isOrderCardPackageEligible(order)) {
    return null
  }
  ensureOrderCardPackage(order)
  if (!order.cardPackageIssued) {
    return null
  }
  if (
    !String(order.cardPackageContractSignedAt || '').trim()
    && !String(order.cardPackageContractNo || '').trim()
  ) {
    return null
  }
  return order
}

function isCardPackageContractSignedInUpstreamData(data) {
  const d = data && typeof data === 'object' ? data : {}
  const s = d.status
  return s === 2 || s === '2'
}

function ensureOrderShipment(order) {
  if (order.trackingNumber === undefined || order.trackingNumber === null) {
    order.trackingNumber = ''
  }
  else {
    order.trackingNumber = String(order.trackingNumber)
  }
}

function isOrderCardPackageEligible(order) {
  return ['shipping', 'receiving', 'enjoying'].includes(order.status)
}

function fail(ctx, msg, code = 400) {
  ctx.status = code
  ctx.body = { success: false, code, msg, data: null }
}

function shouldRequireMallContactsForClient(ctx) {
  const queryPlatform = String(ctx.query && ctx.query.clientPlatform || '').trim().toLowerCase()
  const body = ctx.request && ctx.request.body && typeof ctx.request.body === 'object' ? ctx.request.body : {}
  const bodyPlatform = String(body.clientPlatform || '').trim().toLowerCase()
  const platform = queryPlatform || bodyPlatform
  if (platform) {
    return platform === 'android'
  }
  const ua = String(ctx.headers && ctx.headers['user-agent'] || '')
  return /Android/i.test(ua)
}

function failMallContactsRequired(ctx, order) {
  if (!shouldRequireMallContactsForClient(ctx)) {
    return false
  }
  const blocked = shouldBlockContractForMallContacts(order)
  if (!blocked.block) {
    return false
  }
  ctx.status = 409
  ctx.body = {
    success: false,
    code: 409,
    msg: blocked.msg,
    data: {
      errorCode: blocked.code,
      orderId: order && order.id ? String(order.id) : '',
    },
  }
  return true
}

async function platformAuditRecord(ctx, action, detail = {}) {
  try {
    const account = await resolveAdminAccount(ctx)
    if (!account || account.scopeType !== 'platform') {
      return
    }
    const db = await readCoreDb()
    if (!db._meta || typeof db._meta !== 'object') {
      db._meta = {}
    }
    if (!Array.isArray(db._meta.platformAuditLogs)) {
      db._meta.platformAuditLogs = []
    }
    db._meta.platformAuditLogs.unshift({
      id: `PAL${Date.now()}${Math.floor(Math.random() * 1000)}`,
      at: new Date().toISOString(),
      actor: {
        username: account.username,
        phone: account.phone,
        role: account.role,
      },
      action: String(action || ''),
      tenantId: normalizeTenantId(ctx?.state?.effectiveTenantId || ctx?.state?.tenantId || DEFAULT_TENANT_ID),
      path: String(ctx?.path || ''),
      method: String(ctx?.method || ''),
      detail,
    })
    if (db._meta.platformAuditLogs.length > 2000) {
      db._meta.platformAuditLogs.length = 2000
    }
    await writeCoreDb(db)
  }
  catch {
    // ignore audit write failures
  }
}

async function requirePlatformScope(ctx, actionLabel = '访问平台接口', options = {}) {
  const role = await requireAdminPermission(ctx, [ADMIN_ROLES.SUPER, ADMIN_ROLES.BOSS], actionLabel, options)
  if (!role) {
    return null
  }
  const account = await resolveAdminAccount(ctx)
  if (!account || account.scopeType !== 'platform') {
    fail(ctx, '仅平台账号可访问该接口', 403)
    return null
  }
  return account
}

/** 子系统管理等：仅超级管理员（平台老板不可用） */
async function requirePlatformSuperAdminScope(ctx, actionLabel = '访问子系统管理', options = {}) {
  const role = await requireAdminPermission(ctx, [ADMIN_ROLES.SUPER], actionLabel, { ...options, strictRoles: true })
  if (!role) {
    return null
  }
  const account = await resolveAdminAccount(ctx)
  if (!account || account.scopeType !== 'platform') {
    fail(ctx, '仅平台账号可访问该接口', 403)
    return null
  }
  return account
}

async function requirePlatformSuperAdminScopeOnAny(ctx, permissionKeys, permissionAction, actionLabel = '访问子系统管理') {
  const role = await resolveAdminRole(ctx)
  if (!role) {
    fail(ctx, `未提供后台角色信息，无法执行${actionLabel}`, 401)
    return null
  }
  const account = await resolveAdminAccount(ctx)
  if (!account) {
    fail(ctx, '未识别到有效后台账号，请重新登录', 401)
    return null
  }
  if (!roleMatchesAllowedRoles(role, [ADMIN_ROLES.SUPER], true)
    || !hasAdminPermissionOnAny(account, permissionKeys, permissionAction)) {
    fail(ctx, `当前账号无权限执行${actionLabel}`, 403)
    return null
  }
  if (account.scopeType !== 'platform') {
    fail(ctx, '仅平台账号可访问该接口', 403)
    return null
  }
  if (!(await resolveEffectiveTenantId(ctx))) {
    return null
  }
  return account
}

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '')
}

/** 订单对应的商城注册用户：仅允许 mallUserId → users.id（禁止用收货手机号推测买家） */
function resolveMallBuyerFromOrder(db, order) {
  if (!order || !db || !Array.isArray(db.users)) {
    return null
  }
  const mid = String(order.mallUserId || '').trim()
  if (!mid) {
    return null
  }
  return db.users.find(u => u && String(u.id || '').trim() === mid) || null
}

function normalizeBuyerPhoneDigits(phone) {
  let digits = normalizePhone(phone || '')
  if (digits.startsWith('86') && digits.length === 13) {
    digits = digits.slice(2)
  }
  return digits
}

/** 后台 GET /orders keyword：订单号、商品、注册/收货用户姓名、注册/收货手机号 */
function orderMatchesAdminKeyword(db, order, keywordRaw) {
  const keyword = String(keywordRaw || '').trim()
  if (!keyword) {
    return true
  }
  const keywordLower = keyword.toLowerCase()
  const keywordDigits = normalizePhone(keyword)

  if (String(order.id || '').includes(keyword)) {
    return true
  }
  if (String(order.name || '').toLowerCase().includes(keywordLower)) {
    return true
  }
  if (String(order.receiverName || '').toLowerCase().includes(keywordLower)) {
    return true
  }
  if (keywordDigits) {
    const receiverPhone = normalizePhone(order.receiverPhone || '')
    if (receiverPhone.includes(keywordDigits)) {
      return true
    }
  }

  const buyer = resolveMallBuyerFromOrder(db, order)
  if (buyer) {
    const buyerName = String(buyer.name || '').toLowerCase()
    if (buyerName.includes(keywordLower)) {
      return true
    }
    if (keywordDigits) {
      const buyerPhone = normalizeBuyerPhoneDigits(buyer.phone || '')
      if (buyerPhone.includes(keywordDigits)) {
        return true
      }
    }
  }
  return false
}

const MALL_SELF_REGISTER_CHANNEL_LABEL = '商城注册'

function resolveOrderRegisterChannelView(db, buyer) {
  if (!buyer) {
    return {
      registerChannelCode: '',
      registerChannelName: '',
      registerChannelLabel: '',
    }
  }
  const code = String(buyer.registerChannelCode || '').trim()
  if (!code) {
    return {
      registerChannelCode: '',
      registerChannelName: '',
      registerChannelLabel: MALL_SELF_REGISTER_CHANNEL_LABEL,
    }
  }
  const name = String(buyer.registerChannelName || '').trim()
  return {
    registerChannelCode: code,
    registerChannelName: name,
    registerChannelLabel: resolveUserRegisterChannelLabel(db, buyer) || code,
  }
}

/** GET /orders、详情等：附带注册买家快照字段（列表「用户」须展示注册信息，非收货人） */
function enrichMallOrderWithBuyerFields(db, order) {
  const buyer = resolveMallBuyerFromOrder(db, order)
  const buyerName = buyer ? String(buyer.name || '').trim() : ''
  let buyerPhoneDigits = buyer ? normalizePhone(buyer.phone || '') : ''
  if (buyerPhoneDigits.startsWith('86') && buyerPhoneDigits.length === 13) {
    buyerPhoneDigits = buyerPhoneDigits.slice(2)
  }
  const buyerPhone = /^1\d{10}$/.test(buyerPhoneDigits) ? buyerPhoneDigits : ''
  const rawRemark = buyer && typeof buyer.adminRemark === 'string' ? buyer.adminRemark.trim() : ''
  const rawManualRejectReason = buyer && typeof buyer.manualRejectReason === 'string' ? buyer.manualRejectReason.trim() : ''
  const emergencyContactsComplete = buyer
    ? isEmergencyContactsComplete(normalizeEmergencyContactsList(buyer.emergencyContacts))
    : null
  const registerChannelView = resolveOrderRegisterChannelView(db, buyer)
  return {
    ...order,
    buyerName: buyerName || '',
    buyerPhone,
    buyerAdminRemark: rawRemark,
    manualRejectReason: rawManualRejectReason,
    emergencyContactsComplete,
    ...registerChannelView,
  }
}

function normalizeImageExtForIdCard(file) {
  const ext = path.extname(String(file?.originalname || '')).toLowerCase()
  return ALLOWED_ID_CARD_EXTS.has(ext) ? ext : ''
}

function detectImageMimeByMagic(buffer) {
  if (!buffer || buffer.length < 12) {
    return ''
  }
  // JPEG
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    return 'image/jpeg'
  }
  // PNG
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'image/png'
  }
  // WebP: RIFF....WEBP
  if (
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46
    && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) {
    return 'image/webp'
  }
  // GIF87a / GIF89a
  if (
    buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46
    && buffer[3] === 0x38 && (buffer[4] === 0x37 || buffer[4] === 0x39) && buffer[5] === 0x61
  ) {
    return 'image/gif'
  }
  return ''
}

function detectImageExtFromMime(mimetype) {
  const mt = String(mimetype || '').toLowerCase()
  if (mt === 'image/png') return '.png'
  if (mt === 'image/webp') return '.webp'
  if (mt === 'image/gif') return '.gif'
  return '.jpg'
}

function validateIdCardImageBuffer(file) {
  const ext = normalizeImageExtForIdCard(file)
  if (!ext) {
    return { ok: false, msg: '图片扩展名仅支持 .jpg/.jpeg/.png/.webp' }
  }
  const mimetype = String(file?.mimetype || '').toLowerCase()
  if (!ALLOWED_ID_CARD_MIMES.has(mimetype)) {
    return { ok: false, msg: '图片类型仅支持 JPG/PNG/WebP' }
  }
  const detectedMime = detectImageMimeByMagic(file?.buffer)
  if (!detectedMime || detectedMime !== mimetype) {
    return { ok: false, msg: '图片内容与类型不匹配，请重新上传' }
  }
  let sizeInfo
  try {
    sizeInfo = imageSize(file.buffer)
  }
  catch {
    return { ok: false, msg: '无法解析图片尺寸，请更换图片重试' }
  }
  const width = Number(sizeInfo?.width || 0)
  const height = Number(sizeInfo?.height || 0)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { ok: false, msg: '图片尺寸无效，请更换图片重试' }
  }
  const c = getOssConfig()
  const maxPixels = Math.round(Number(c.maxImageMegaPixels || 20) * 1000000)
  if (width * height > maxPixels) {
    return { ok: false, msg: `图片像素过大（上限 ${c.maxImageMegaPixels}MP），请压缩后重试` }
  }
  return { ok: true }
}

function validatePublicImageBuffer(file) {
  const mimetype = String(file?.mimetype || '').toLowerCase()
  const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
  if (!allowed.has(mimetype)) {
    return { ok: false, msg: '图片类型仅支持 JPG/PNG/WebP/GIF' }
  }
  const detectedMime = detectImageMimeByMagic(file?.buffer)
  if (!detectedMime || detectedMime !== mimetype) {
    return { ok: false, msg: '图片内容与类型不匹配，请重新上传' }
  }
  try {
    const sizeInfo = imageSize(file.buffer)
    const width = Number(sizeInfo?.width || 0)
    const height = Number(sizeInfo?.height || 0)
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return { ok: false, msg: '图片尺寸无效，请更换图片重试' }
    }
  }
  catch {
    return { ok: false, msg: '无法解析图片尺寸，请更换图片重试' }
  }
  return { ok: true }
}

/** 分期 period 在 JSON/Mongo 中可能为字符串，与严格相等比较会找不到期次导致还款未落库 */
function findInstallmentPlanItemByPeriod(plan, periodNumber) {
  if (!Array.isArray(plan)) {
    return undefined
  }
  const n = Number(periodNumber)
  if (!Number.isInteger(n) || n <= 0) {
    return undefined
  }
  return plan.find(item => item && Number(item.period) === n)
}

/** 协商还款：解析「协商后未还金额还款日」为 YYYY-MM-DD */
function normalizeNegotiateRemainderDueDate(raw) {
  const s = String(raw || '').trim()
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : ''
}

/** 协商部分还款：剩余应还始终等于本期应还（延期费模型，不扣减本金） */
function negotiateExtensionFeeRemainderAmount(planItem) {
  return Number(Number(planItem && planItem.amount != null ? planItem.amount : 0).toFixed(2))
}

/** 对外展示剩余未还：以当前本期应还为准（兼容历史已写入的扣减型 remainderAmount） */
function resolveNegotiateRemainderAmountForDisplay(planItem, storedRemainder) {
  const cur = negotiateExtensionFeeRemainderAmount(planItem)
  if (cur > 0) {
    return cur
  }
  return Number(Number(storedRemainder || 0).toFixed(2))
}

/**
 * 完成「协商支付」延期费：仅更新还款日与协商完成态，不扣减本期应还金额。
 * @returns {{ ok: true } | { ok: false, msg: string }}
 */
function applyInstallmentNegotiationPayCompleted(planItem) {
  const pend = planItem.negotiationPayPending
  if (!pend || !Number.isFinite(Number(pend.negotiatedAmount)) || Number(pend.negotiatedAmount) <= 0) {
    return { ok: false, msg: '暂无待支付的协商款项' }
  }
  const remainderDue = normalizeNegotiateRemainderDueDate(pend.remainderDueDate)
  if (!remainderDue || !/^\d{4}-\d{2}-\d{2}$/.test(remainderDue)) {
    return { ok: false, msg: '协商待支付数据异常，请联系客服' }
  }
  const hist = planItem.negotiationHistory
  const last = Array.isArray(hist) && hist.length > 0 ? hist[hist.length - 1] : null
  if (last && !String(last.originalDueDate || '').trim()) {
    last.originalDueDate = String(planItem.dueDate || '').trim()
  }
  planItem.dueDate = remainderDue
  planItem.negotiationPayPending = null
  if (last) {
    last.userPaidAt = new Date().toISOString()
  }
  return { ok: true }
}

/**
 * 撤销末条「协商支付」完成态：恢复 negotiationPayPending 与还款日（不改动本期应还金额）
 * @returns {{ ok: true } | { ok: false, msg: string }}
 */
function revertLastNegotiationPayCompletion(planItem) {
  const hist = planItem.negotiationHistory
  if (!Array.isArray(hist) || hist.length === 0) {
    return { ok: false, msg: '无协商历史' }
  }
  const last = hist[hist.length - 1]
  if (planItem.negotiationPayPending && Number(planItem.negotiationPayPending.negotiatedAmount || 0) > 0) {
    return { ok: false, msg: '当前仍有待协商支付，无法撤销' }
  }
  const nAmt = Number(Number(last.negotiatedAmount || 0).toFixed(2))
  const rem = negotiateExtensionFeeRemainderAmount(planItem)
  planItem.negotiationPayPending = {
    negotiatedAmount: nAmt,
    remainderAmount: rem,
    remainderDueDate: String(last.remainderDueDate || '').trim(),
    createdAt: String(last.createdAt || new Date().toISOString()),
  }
  const priorDue = normalizeNegotiateRemainderDueDate(String(last.originalDueDate || '').trim())
  const fallbackDue = normalizeNegotiateRemainderDueDate(String(last.remainderDueDate || '').trim())
  planItem.dueDate = priorDue || fallbackDue
  if (!planItem.dueDate) {
    return { ok: false, msg: '缺少原还款日信息，无法撤销' }
  }
  delete last.userPaidAt
  return { ok: true }
}

/** 与持久化/前端展示一致地判断单期是否已还（兼容 Mongo/JSON 中数字、字符串等） */
function installmentItemIsPaid(planItem) {
  if (!planItem || planItem.paid == null) {
    return false
  }
  const p = planItem.paid
  return p === true || p === 1 || p === '1' || p === 'true'
}

/**
 * 将本期改回「未还」时：若末条协商尚未完成「协商支付」（无 userPaidAt）、且当前无有效待付协商款，
 * 则从末条协商记录恢复 negotiationPayPending（例如用户曾用常规还款一次结清导致 pending 被清空）。
 */
function restoreNegotiationPayPendingFromLastHistoryIfNeeded(planItem) {
  if (!planItem || installmentItemIsPaid(planItem)) {
    return
  }
  const existing = planItem.negotiationPayPending
  if (existing && Number(existing.negotiatedAmount || 0) > 0) {
    return
  }
  const hist = planItem.negotiationHistory
  if (!Array.isArray(hist) || hist.length === 0) {
    return
  }
  const last = hist[hist.length - 1]
  if (!last || String(last.userPaidAt || '').trim()) {
    return
  }
  const negotiatedAmount = Number(Number(last.negotiatedAmount || 0).toFixed(2))
  if (!Number.isFinite(negotiatedAmount) || negotiatedAmount <= 0) {
    return
  }
  const remainderAmount = negotiateExtensionFeeRemainderAmount(planItem)
  planItem.negotiationPayPending = {
    negotiatedAmount,
    remainderAmount,
    remainderDueDate: String(last.remainderDueDate || '').trim(),
    createdAt: String(last.createdAt || new Date().toISOString()),
  }
}

function ensureCsSessions(db) {
  if (!Array.isArray(db.csSessions)) {
    db.csSessions = []
  }
}

/** 客服会话展示名：已登录商城用户显示库内姓名全称（不脱敏） */
function csMallUserFullDisplayName(name) {
  const s = String(name || '').trim()
  return s || '用户'
}

/** 列表/详情/响应用：有 mallUserId 时始终以 users 当前姓名为准 */
function resolveCsSessionDisplayName(db, session) {
  if (!session) {
    return ''
  }
  if (session.mallUserId) {
    const u = db.users.find(x => x && x.id === session.mallUserId)
    if (u) {
      const n = String(u.name || '').trim()
      if (n) {
        return n
      }
    }
  }
  return String(session.displayName || '').trim() || '访客'
}

function csNewMsgId() {
  return `m_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`
}

function csAppendMessage(session, role, text, extras = {}) {
  const isImage = extras.type === 'image'
  let msg
  const now = new Date().toISOString()
  const agentName = role === 'agent' ? String(extras.agentName || '').trim() : ''
  if (!Array.isArray(session.messages)) {
    session.messages = []
  }
  if (isImage) {
    const imageUrl = String(extras.imageUrl || '').trim()
    if (!imageUrl) {
      return null
    }
    msg = {
      id: csNewMsgId(),
      role,
      type: 'image',
      text: '',
      imageUrl,
      createdAt: now,
      agentName,
    }
    session.messages.push(msg)
    session.updatedAt = now
    session.lastMessagePreview = '[图片]'
  }
  else {
    const trimmed = String(text || '').trim()
    if (!trimmed) {
      return null
    }
    msg = {
      id: csNewMsgId(),
      role,
      type: 'text',
      text: trimmed.slice(0, 2000),
      imageUrl: '',
      createdAt: now,
      agentName,
    }
    session.messages.push(msg)
    session.updatedAt = now
    session.lastMessagePreview = msg.text.slice(0, 120)
  }
  if (role === 'user') {
    session.unreadAgent = Number(session.unreadAgent || 0) + 1
  }
  else {
    session.unreadUser = Number(session.unreadUser || 0) + 1
  }
  return msg
}

function findCsSessionForMall(db, mallUserId) {
  ensureCsSessions(db)
  return db.csSessions.find(s => s && s.mallUserId === mallUserId) || null
}

function findCsSessionByVisitorKey(db, visitorKey) {
  ensureCsSessions(db)
  const key = String(visitorKey || '').trim()
  if (!key) {
    return null
  }
  return db.csSessions.find(s => s && s.visitorKey === key) || null
}

function findCsSessionById(db, id) {
  ensureCsSessions(db)
  return db.csSessions.find(s => s && s.id === id) || null
}

function resolveCsMallSession(ctx, db, { requireExisting = false } = {}) {
  ensureCsSessions(db)
  const sid = String(ctx.headers['x-cs-session-id'] || '').trim()
  const sec = String(ctx.headers['x-cs-secret'] || '').trim()
  if (sid && sec) {
    const s = findCsSessionById(db, sid)
    if (!s || s.authSecret !== sec) {
      return { error: '客服会话无效，请从首页重新进入客服' }
    }
    return { session: s }
  }
  const phone = normalizePhone(parsePhoneFromToken(ctx.headers.authorization))
  if (phone && /^1\d{10}$/.test(phone)) {
    const user = db.users.find(u => u.phone === phone)
    if (!user) {
      return { error: '请先登录商城后再使用在线客服' }
    }
    const s = findCsSessionForMall(db, user.id)
    if (!s && requireExisting) {
      return { error: '请先开启客服会话' }
    }
    return { session: s, mallUser: user }
  }
  if (requireExisting) {
    return { error: '请先开启客服会话（访客请从客服页发起会话）' }
  }
  return {}
}

function createCsSessionRecord({ mallUser, visitorKey }) {
  const now = new Date().toISOString()
  const id = `cs_${crypto.randomBytes(10).toString('hex')}`
  const authSecret = crypto.randomBytes(18).toString('hex')
  if (mallUser) {
    return {
      id,
      mallUserId: mallUser.id,
      visitorKey: null,
      authSecret,
      displayName: csMallUserFullDisplayName(mallUser.name),
      messages: [],
      unreadAgent: 0,
      unreadUser: 0,
      lastMessagePreview: '',
      updatedAt: now,
      userOnlineAt: now,
    }
  }
  const vk = visitorKey || `v_${crypto.randomBytes(10).toString('hex')}`
  const hexish = vk.replace(/[^a-fA-F0-9]/g, '')
  const tail = (hexish.slice(-4) || '0000').padStart(4, '0')
  return {
    id,
    mallUserId: null,
    visitorKey: vk,
    authSecret,
    displayName: `访客_${tail}`,
    messages: [],
    unreadAgent: 0,
    unreadUser: 0,
    lastMessagePreview: '',
    updatedAt: now,
    userOnlineAt: now,
  }
}

function resolveCsAgentName(ctx, db) {
  ensureAdminAccounts(db)
  const phone = normalizePhone(ctx.headers['x-admin-phone'] || parsePhoneFromToken(ctx.headers.authorization))
  if (!phone) {
    return '客服'
  }
  const acc = db.adminAccounts.find(a => a.phone === phone && a.status === 'active')
  if (acc) {
    return String(acc.name || acc.username || '客服').trim() || '客服'
  }
  return '客服'
}

function csUserOnline(session) {
  const t = new Date(session.userOnlineAt || 0).getTime()
  return Number.isFinite(t) && (Date.now() - t < 90_000)
}

/** 管理端侧栏：是否存在客服未读（只读 csSessions.unreadAgent，命中即早停） */
function computeCsAdminBadge(db) {
  ensureCsSessions(db)
  for (const s of db.csSessions || []) {
    if (s && Number(s.unreadAgent || 0) > 0) {
      return { hasUnread: true }
    }
  }
  return { hasUnread: false }
}

/** 客服会话变更仅持久化 csSessions，避免整库 11 集合 sync */
function writeCsSessionsDb(db) {
  writeDbPartial(db, ['csSessions'])
}

function writeAppMetaDb(db) {
  writeDbPartial(db, [])
}

function writeProductsDb(db) {
  writeDbPartial(db, ['products'])
}

function writeAdminAccountsDb(db) {
  writeDbPartial(db, ['adminAccounts'])
}

/** 订单对账/变更仅持久化 orders */
function writeOrdersDb(db) {
  writeDbPartial(db, ['orders'])
}

/** 审核状态变更仅持久化当前订单 */
function writeOrderDb(db, order) {
  writeDbEntity(db, 'orders', order)
}

/** 审核不通过原因仅持久化绑定用户，避免写全量 users 集合 */
function writeUserDb(db, user) {
  writeDbEntity(db, 'users', user)
}

function reviewPerfNowMs() {
  return Number(process.hrtime.bigint() / 1000000n)
}

function reviewSlowLogThresholdMs() {
  const raw = Number(process.env.API_REVIEW_SLOW_LOG_MS)
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0
}

function maybeLogReviewPerf(ctx, marks, extra = {}) {
  const threshold = reviewSlowLogThresholdMs()
  if (threshold <= 0 || !marks || !marks.start || !marks.end) {
    return
  }
  const totalMs = marks.end - marks.start
  if (totalMs < threshold) {
    return
  }
  const safe = {
    orderId: extra.orderId || '',
    operation: extra.operation || '',
    statusCode: ctx.status || 200,
    totalMs,
    readDbMs: marks.readDbEnd && marks.start ? marks.readDbEnd - marks.start : undefined,
    authMs: marks.authEnd && marks.authStart ? marks.authEnd - marks.authStart : undefined,
    businessMs: marks.businessEnd && marks.businessStart ? marks.businessEnd - marks.businessStart : undefined,
    persistScheduleMs: marks.persistScheduleEnd && marks.persistScheduleStart ? marks.persistScheduleEnd - marks.persistScheduleStart : undefined,
    flushMs: marks.flushEnd && marks.flushStart ? marks.flushEnd - marks.flushStart : undefined,
  }
  console.warn('[review-status-perf]', safe)
}

/** 拉卡拉流水变更仅持久化 lakalaPayments */
function writeLakalaPaymentsDb(db) {
  writeDbPartial(db, ['lakalaPayments'])
}

/** 支付成功落库：订单 + 拉卡拉流水 */
function writeOrdersAndLakalaPaymentsDb(db) {
  writeDbPartial(db, ['orders', 'lakalaPayments'])
}

/** 下单风控快照可能同时更新 users + orders */
function writeOrdersAndUsersDb(db) {
  writeDbPartial(db, ['orders', 'users'])
}

/** 地址变更仅持久化 addresses */
function writeAddressesDb(db) {
  writeDbPartial(db, ['addresses'])
}

/** 银行卡变更仅持久化 bankCards */
function writeBankCardsDb(db) {
  writeDbPartial(db, ['bankCards'])
}

/** 商城用户变更仅持久化 users */
function writeUsersDb(db) {
  writeDbPartial(db, ['users'])
}

function writeTrafficChannelsDb(db) {
  writeDbPartial(db, ['trafficChannels'])
}

function writeTrafficPartnersDb(db) {
  writeDbPartial(db, ['trafficPartners'])
}

function writeTrafficChannelsAndPartnersDb(db) {
  writeDbPartial(db, ['trafficChannels', 'trafficPartners'])
}

/** 删除用户时同步清理 addresses / bankCards */
function writeUsersAddressesBankCardsDb(db) {
  writeDbPartial(db, ['users', 'addresses', 'bankCards'])
}

/** 商城 poll 心跳：内存每请求更新在线时间，落库 debounce（多实例下在线态最多延迟一次间隔） */
const CS_MALL_HEARTBEAT_PERSIST_MS = 45_000

function touchCsMallSessionPollState(session, { resolvedDisplayName } = {}) {
  let needsPersist = false
  if (resolvedDisplayName && session.mallUserId && session.displayName !== resolvedDisplayName) {
    session.displayName = resolvedDisplayName
    needsPersist = true
  }
  if (Number(session.unreadUser || 0) > 0) {
    session.unreadUser = 0
    needsPersist = true
  }
  const nowMs = Date.now()
  const lastOnlineMs = new Date(session.userOnlineAt || 0).getTime()
  session.userOnlineAt = new Date().toISOString()
  if (!Number.isFinite(lastOnlineMs) || nowMs - lastOnlineMs >= CS_MALL_HEARTBEAT_PERSIST_MS) {
    needsPersist = true
  }
  return needsPersist
}

/**
 * 管理端单项/全量风控：合并请求体与库内 users 记录。
 * 前端在打开档案后会把当前展示的三要素写入 body，避免仅用旧库字段导致缺参。
 */
function mergeAdminRiskCallParams(target, body = {}) {
  const userName = String(
    body.userName != null && String(body.userName).trim() !== ''
      ? body.userName
      : (target.name || ''),
  ).trim()
  const phoneRaw = body.phoneNumber != null && String(body.phoneNumber).trim() !== ''
    ? body.phoneNumber
    : (target.phone || '')
  const phoneNumber = normalizePhone(phoneRaw)
  const idFromBody = typeof body.idNumber === 'string' ? body.idNumber.trim() : ''
  const idNumber = String(idFromBody || target.idNumber || '').trim()
  return {
    userName,
    phoneNumber,
    idNumber,
    idCardFront: String(target.idCardFront || ''),
    idCardBack: String(target.idCardBack || ''),
    totalAmount: Number(target.totalAmount || 0),
  }
}

/** 与 H5 `?channel=`、注册请求 body.channel 一致；需在后台「流量管理」中已创建且未停用 */
const TRAFFIC_CHANNEL_CODE_RE = /^[a-zA-Z0-9_-]{2,40}$/

function ensureTrafficChannels(db) {
  if (!Array.isArray(db.trafficChannels)) {
    db.trafficChannels = []
  }
}

function resolveRegisterChannelForUser(db, payload) {
  ensureTrafficChannels(db)
  const result = resolveRegisterChannelForRegistration(db, payload)
  return result.channel
}

function createMallUserFromRegisterPayload(db, payload) {
  const phone = normalizePhone(payload.phone)
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
    creditStatus: '待风控',
    registerAt: new Date().toISOString(),
    quota: normalizeUserQuota(payload.quota),
    adminRemark: '',
    orderBlacklisted: false,
  }
  const reg = resolveRegisterChannelForUser(db, payload)
  if (reg) {
    nextUser.registerChannelCode = reg.code
    if (reg.name) {
      nextUser.registerChannelName = reg.name
    }
  }
  if (typeof payload.idNumber === 'string' && payload.idNumber.trim()) {
    nextUser.idNumber = payload.idNumber.trim()
  }
  if (typeof payload.password === 'string' && payload.password.length >= 6) {
    nextUser.passwordHash = hashMallUserPassword(payload.password)
    nextUser.adminPasswordPlain = String(payload.password)
  }
  nextUser.emergencyContacts = Array.isArray(payload.emergencyContacts)
    ? payload.emergencyContacts.map(item => ({ name: item.name, phone: item.phone })).slice(0, 2)
    : []
  db.users.unshift(nextUser)
  return nextUser
}

function attachUserOrderStats(db, user, opts = {}) {
  let orderCount = 0
  let totalAmount = 0
  let lastOrderAt = ''
  const pre = opts.precomputedOrderStats
  if (pre && typeof pre === 'object') {
    orderCount = Math.max(0, Number(pre.orderCount || 0))
    totalAmount = Number(Number(pre.totalAmount || 0).toFixed(2))
    lastOrderAt = pre.lastOrderAt ? String(pre.lastOrderAt) : ''
  }
  else {
    /** 与用户注册商城账号 mallUser.id 一致的订单计入统计（忽略收货手机号） */
    const userOrders = ordersForRegisteredMallUser(db, user)
    /** 管理端展示：仅计审核通过后的订单；待审核 reviewing 不计入订单数与成交累计 */
    let approvedOrders = userOrders.filter(item => item.status !== 'reviewing')
    /**
     * 与财务报表 KPI 一致：仅统计「卡包已发放」订单（见 DashboardPage ordersWithCardPackageIssued）。
     * 用于 GET /platform/mall-users，避免总部汇总与子系统后台财务口径不一致。
     */
    if (opts.kpiCardPackageIssuedOnly === true) {
      approvedOrders = approvedOrders.filter(item => Boolean(item.cardPackageIssued))
    }
    orderCount = approvedOrders.length
    totalAmount = Number(approvedOrders.reduce((sum, item) => sum + Number(item.totalAmount || 0), 0).toFixed(2))
    if (approvedOrders.length > 0) {
      let maxMs = 0
      for (const o of approvedOrders) {
        const ms = new Date(o.createdAt).getTime()
        if (!Number.isNaN(ms) && ms >= maxMs) {
          maxMs = ms
        }
      }
      if (maxMs > 0) {
        lastOrderAt = new Date(maxMs).toISOString()
      }
    }
  }
  const mall = Boolean(opts.mall)
  const emList = normalizeEmergencyContactsList(user.emergencyContacts)
  const base = {
    ...sanitizeMallUser(user, { mall }),
    quota: normalizeUserQuota(user.quota),
    orderCount,
    totalAmount,
    /** 管理端列表与弹窗种子：与 GET /users/:id 的 riskView.upstreamConfigured 一致 */
    riskUpstreamConfigured: isRiskUpstreamConfigured(),
    orderBlacklisted: Boolean(user && user.orderBlacklisted),
    emergencyContacts: emList,
    emergencyContactsComplete: isEmergencyContactsComplete(emList),
  }
  if (lastOrderAt) {
    base.lastOrderAt = lastOrderAt
  }
  if (opts.includeAdminPasswordEcho === true && user && typeof user.adminPasswordPlain === 'string') {
    base.adminPasswordPlain = user.adminPasswordPlain
  }
  if (!mall) {
    const code = String(user.registerChannelCode || '').trim()
    const storedName = String(user.registerChannelName || '').trim()
    const label = resolveUserRegisterChannelLabel(db, user)
    base.registerChannelCode = code
    /** 注册时的渠道名称快照；老数据可能为空 */
    base.registerChannelName = storedName
    /** 列表/详情展示：快照优先，否则当前渠道库名称，再无则 code */
    base.registerChannelLabel = label
  }
  return base
}

/**
 * 管理端只读优化总开关（env 任一为 true 即启用）：
 * - GET /orders、GET /users 先分页再 enrich
 * - 流量 portal-stats 订单索引、GET /products 短缓存、报表短缓存等
 * 未开启时保持原路径，便于紧急回滚。
 */
function isAdminReadOptimizeEnabled() {
  return mongoConfig.isAdminReadOptimizeEnabled()
}

/**
 * 管理端轻量 GET：仅增量刷新所需分集合（须 API 只读优化开关开启）。
 * @returns {{ mode: 'full' } | { mode: 'partial', keys: string[], allowColdPartial: boolean } | { mode: 'skip' }}
 */
function isPaginatedListQuery(ctx) {
  const pageRaw = ctx.query && ctx.query.page
  return pageRaw != null && String(pageRaw).trim() !== ''
}

function resolveApiMongoRefreshPlan(ctx) {
  const method = String(ctx.method || 'GET').toUpperCase()
  const path = String(ctx.path || '')
  const duodiandianPlan = resolveDuodiandianMongoRefreshPlan(method, path)
  if (duodiandianPlan) {
    return duodiandianPlan
  }
  if (!isAdminReadOptimizeEnabled()) {
    return { mode: 'full' }
  }
  if (method !== 'GET') {
    return { mode: 'full' }
  }
  /** 直连 Mongo 单集合，跳过 hydrate 队列（账号页 / 侧栏角标 / 商品列表） */
  if (
    path === '/api/admin/accounts'
    || path === '/api/platform/accounts'
    || path === '/api/admin/orders/sidebar-counts'
    || path === '/api/products'
  ) {
    return { mode: 'skip' }
  }
  if (path === '/api/orders' && isPaginatedListQuery(ctx)) {
    const safeOrderFilter = adminMongoReadOptimize.buildAdminOrderMongoFilter({
      keyword: ctx.query.keyword,
      status: ctx.query.status,
      adminStatus: ctx.query.adminStatus,
      payType: ctx.query.payType,
      date: ctx.query.date,
      scope: ctx.query.listScope,
      repay: ctx.query.repayFilter,
      risk: ctx.query.riskStatus,
      registerChannel: ctx.query.registerChannel,
    })
    if (safeOrderFilter) {
      return { mode: 'skip' }
    }
  }
  /** 流量管理 overview：渠道 + 流量商账号 + 用户/订单统计（非 11 集合全量） */
  const trafficOverviewKeys = ['adminAccounts', 'trafficChannels', 'trafficPartners', 'users', 'orders']
  const trafficListKeys = ['adminAccounts', 'trafficChannels', 'trafficPartners', 'users']
  const csSessionsWithUsersKeys = ['csSessions', 'users']
  const adminOrdersUsersKeys = ['orders', 'users']
  const adminOrdersUsersAuthKeys = ['adminAccounts', 'orders', 'users']
  const adminUsersAuthKeys = ['adminAccounts', 'users', 'orders', 'trafficChannels']
  const mallOrdersUsersKeys = ['users', 'orders']
  const byPath = {
    '/api/admin/dashboard/kpis': ['orders'],
    '/api/admin/cs/badge': ['csSessions'],
    '/api/admin/cs/unread-sum': ['csSessions'],
    '/api/admin/traffic-channels/overview': trafficOverviewKeys,
    '/api/admin/traffic-channels/portal-stats': trafficOverviewKeys,
    '/api/admin/traffic-channels/quality': trafficOverviewKeys,
    '/api/admin/traffic-channels/daily-disbursement': trafficOverviewKeys,
    '/api/traffic-partner/stats': trafficOverviewKeys,
    '/api/admin/traffic-channels': trafficListKeys,
    '/api/admin/cs/sessions': csSessionsWithUsersKeys,
    '/api/my/summary': ['users', 'orders', 'bankCards'],
    '/api/my/orders': mallOrdersUsersKeys,
    '/api/mall/me/bill-risk': ['users'],
    '/api/mall/contacts/status': mallOrdersUsersKeys,
    '/api/mall/contacts/upload/start': mallOrdersUsersKeys,
    '/api/mall/contacts/upload/complete': mallOrdersUsersKeys,
    '/api/mall/contract-pending': mallOrdersUsersKeys,
    '/api/card-packages': mallOrdersUsersKeys,
    '/api/bills': mallOrdersUsersKeys,
    '/api/addresses': ['addresses'],
    '/api/bank-cards': ['bankCards'],
  }
  const keys = byPath[path]
  if (keys) {
    return { mode: 'partial', keys, allowColdPartial: true }
  }
  if (/^\/api\/products\/[^/]+$/.test(path)) {
    return { mode: 'partial', keys: ['products'], allowColdPartial: true }
  }
  if (/^\/api\/admin\/cs\/sessions\/[^/]+$/.test(path)) {
    return { mode: 'partial', keys: csSessionsWithUsersKeys, allowColdPartial: true }
  }
  if (path === '/api/mall/contacts/upload/batch') {
    return { mode: 'skip' }
  }
  if (/^\/api\/orders\/[^/]+$/.test(path)) {
    return { mode: 'partial', keys: adminOrdersUsersAuthKeys, allowColdPartial: true }
  }
  if (/^\/api\/users\/[^/]+$/.test(path)) {
    return { mode: 'partial', keys: adminUsersAuthKeys, allowColdPartial: true }
  }
  if (/^\/api\/card-packages\/[^/]+\/contract-(view|flow)$/.test(path)) {
    return { mode: 'partial', keys: mallOrdersUsersKeys, allowColdPartial: true }
  }
  if (path === '/api/orders' && isPaginatedListQuery(ctx)) {
    return { mode: 'partial', keys: adminOrdersUsersKeys, allowColdPartial: true }
  }
  if (path === '/api/users' && isPaginatedListQuery(ctx)) {
    return { mode: 'partial', keys: adminOrdersUsersKeys, allowColdPartial: true }
  }
  return { mode: 'full' }
}

/** @deprecated 别名，与 isAdminReadOptimizeEnabled 相同 */
function isApiListPaginateBeforeEnrichEnabled() {
  return isAdminReadOptimizeEnabled()
}

const adminReadCacheStore = new Map()

function clearAdminAccountCaches() {
  adminAuthAccountCache.clear()
  adminReadCacheStore.clear()
}

function adminReadCacheTtlMs() {
  if (!isAdminReadOptimizeEnabled()) {
    return 0
  }
  const raw = Number(process.env.API_ADMIN_READ_CACHE_TTL_MS || 45000)
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0
}

function adminReadCacheScopeKey(ctx) {
  const ws = String(ctx.state && ctx.state.workspaceType ? ctx.state.workspaceType : 'tenant').trim().toLowerCase()
  const tid = String(ctx.state && ctx.state.tenantId ? ctx.state.tenantId : DEFAULT_TENANT_ID).trim().toLowerCase()
  return `${ws}:${tid}`
}

function withAdminReadCache(ctx, subKey, computeFn) {
  const ttl = adminReadCacheTtlMs()
  if (ttl <= 0) {
    return computeFn()
  }
  const scopeKey = adminReadCacheScopeKey(ctx)
  const fullKey = `${scopeKey}:${subKey}`
  const now = Date.now()
  const hit = adminReadCacheStore.get(fullKey)
  if (hit && now - hit.at < ttl) {
    return hit.data
  }
  const data = computeFn()
  adminReadCacheStore.set(fullKey, { at: now, data })
  return data
}

async function withAdminReadCacheAsync(ctx, subKey, computeFn) {
  const ttl = adminReadCacheTtlMs()
  if (ttl <= 0) {
    return computeFn()
  }
  const scopeKey = adminReadCacheScopeKey(ctx)
  const fullKey = `${scopeKey}:${subKey}`
  const now = Date.now()
  const hit = adminReadCacheStore.get(fullKey)
  if (hit && now - hit.at < ttl) {
    return hit.data
  }
  const data = await computeFn()
  adminReadCacheStore.set(fullKey, { at: now, data })
  return data
}

/** 单次扫描 orders → mallUserId 索引，供流量统计等避免每用户 filter 全库 */
function buildOrdersByMallUserIdIndex(db) {
  const index = new Map()
  for (const order of db.orders || []) {
    const mid = String(order.mallUserId || '').trim()
    if (!mid) {
      continue
    }
    let list = index.get(mid)
    if (!list) {
      list = []
      index.set(mid, list)
    }
    list.push(order)
  }
  return index
}

function ordersForRegisteredMallUserIndexed(db, mallUser, ordersByUserId) {
  if (!mallUser) {
    return []
  }
  if (ordersByUserId) {
    return ordersByUserId.get(String(mallUser.id || '').trim()) || []
  }
  return ordersForRegisteredMallUser(db, mallUser)
}

function buildRegisterChannelUserCounts(db) {
  const counts = new Map()
  for (const u of db.users || []) {
    const c = u && u.registerChannelCode ? String(u.registerChannelCode) : ''
    if (c) {
      counts.set(c, (counts.get(c) || 0) + 1)
    }
  }
  return counts
}

/** 单次扫描 orders，供用户列表 filter/sort 与 attachUserOrderStats 复用 */
function buildMallUserOrderStatsIndex(db, opts = {}) {
  const index = new Map()
  for (const order of db.orders || []) {
    if (!order || order.status === 'reviewing') {
      continue
    }
    if (opts.kpiCardPackageIssuedOnly === true && !order.cardPackageIssued) {
      continue
    }
    const mid = String(order.mallUserId || '').trim()
    if (!mid) {
      continue
    }
    let row = index.get(mid)
    if (!row) {
      row = { orderCount: 0, totalAmount: 0, lastOrderAtMs: 0, lastOrderAt: '' }
      index.set(mid, row)
    }
    row.orderCount += 1
    row.totalAmount += Number(order.totalAmount || 0)
    const ms = orderCreatedAtMs(order)
    if (ms > row.lastOrderAtMs) {
      row.lastOrderAtMs = ms
      row.lastOrderAt = new Date(ms).toISOString()
    }
  }
  for (const row of index.values()) {
    row.totalAmount = Number(row.totalAmount.toFixed(2))
  }
  return index
}

function resolveUserRegisterChannelLabel(db, user) {
  ensureTrafficChannels(db)
  const code = String(user.registerChannelCode || '').trim()
  const storedName = String(user.registerChannelName || '').trim()
  let label = storedName
  if (!label && code) {
    const ch = db.trafficChannels.find(c => c && String(c.code) === code)
    if (ch) {
      label = String(ch.name || '').trim()
    }
  }
  if (!label && code) {
    label = code
  }
  return label
}

function userRegisterChannelDisplayKeyFromUser(db, user) {
  const label = resolveUserRegisterChannelLabel(db, user)
  if (label) {
    return label
  }
  const name = String(user.registerChannelName || '').trim()
  if (name) {
    return name
  }
  return String(user.registerChannelCode || '').trim()
}

function prepareAdminOrderListItem(item) {
  ensureOrderInstallmentPlan(item)
  ensureOrderCardPackage(item)
  ensureOrderShipment(item)
  if (item.payType === 'full' && item.status !== 'reviewing' && !item.paid) {
    item.paid = true
  }
}

/** 未审核列表风控筛选：未传 risk 时默认排除「风控未通过」，仅显式 risk=failed 时展示 */
function adminPendingListMatchesRiskFilter(item, risk) {
  ensureOrderRiskState(item)
  const rs = item.riskStatus === 'failed' ? 'failed' : 'passed'
  if (risk === 'passed' || risk === 'failed') {
    return rs === risk
  }
  return rs !== 'failed'
}

function adminOrderMatchesRegisterChannel(db, item, registerChannelRaw) {
  const registerChannel = String(registerChannelRaw || '').trim()
  if (!registerChannel || registerChannel === '__all__') {
    return true
  }
  const buyer = resolveMallBuyerFromOrder(db, item)
  if (!buyer) {
    return false
  }
  const code = String(buyer.registerChannelCode || '').trim()
  if (registerChannel === '__none__') {
    return !code
  }
  return code === registerChannel
}

function adminOrderPassesListFilters(db, item, filters) {
  const {
    keyword = '',
    status = '',
    adminStatus = '',
    payType = '',
    date = '',
    scope = '',
    repay = '',
    risk = '',
    registerChannel = '',
  } = filters
  if (scope && !matchesAdminOrderListScope(item, scope)) {
    return false
  }
  if (scope === 'pending' && !adminPendingListMatchesRiskFilter(item, risk)) {
    return false
  }
  if (scope === 'card-data' && repay && repay !== '全部') {
    if (orderRepayBucketForAdmin(item) !== repay) {
      return false
    }
  }
  if (!adminOrderMatchesRegisterChannel(db, item, registerChannel)) {
    return false
  }
  if (!orderMatchesAdminKeyword(db, item, keyword)) {
    return false
  }
  if (status && item.status !== status) {
    return false
  }
  if (adminStatus && resolveAdminOrderDisplayStatus(item) !== adminStatus) {
    return false
  }
  if (payType && item.payType !== payType) {
    return false
  }
  if (date && !formatDateTime(item.createdAt).startsWith(String(date))) {
    return false
  }
  return true
}

function listAdminOrdersPaginatedBeforeEnrich(db, filters, page, pageSize) {
  const matched = []
  for (const item of db.orders) {
    prepareAdminOrderListItem(item)
    if (adminOrderPassesListFilters(db, item, filters)) {
      matched.push(item)
    }
  }
  matched.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
  const total = matched.length
  const start = (page - 1) * pageSize
  const pageSlice = matched.slice(start, start + pageSize)
  const userOrdersCache = new Map()
  const list = pageSlice.map((order) => {
    const row = enrichMallOrderWithBuyerFields(db, order)
    return {
      ...row,
      isOldCustomer: isOldCustomerAtOrder(db, order, userOrdersCache),
    }
  })
  return { list, total, page, pageSize }
}

function listAdminUsersFilteredRows(db, query, opts = {}) {
  const {
    key = '',
    view = 'registered',
    registerChannel = '',
    orderDate = '',
  } = query
  const needOrderStats = opts.needOrderStats !== false
  const statsIndex = needOrderStats
    ? buildMallUserOrderStatsIndex(db, {
      kpiCardPackageIssuedOnly: view === 'card-package-issued',
    })
    : null

  let candidates = db.users
  if (key) {
    candidates = candidates.filter(item => item.id.includes(key) || item.name.includes(key) || item.phone.includes(key))
  }

  if (registerChannel === '__none__') {
    candidates = candidates.filter(item => !userRegisterChannelDisplayKeyFromUser(db, item))
  }
  else if (registerChannel && registerChannel !== '__all__') {
    candidates = candidates.filter(item => userRegisterChannelDisplayKeyFromUser(db, item) === registerChannel)
  }

  let rows = candidates.map((user) => {
    if (!needOrderStats) {
      return { user, orderCount: 0, lastOrderAt: '' }
    }
    const uid = String(user.id || '').trim()
    const stats = statsIndex.get(uid) || { orderCount: 0, totalAmount: 0, lastOrderAt: '' }
    return { user, orderCount: stats.orderCount, lastOrderAt: stats.lastOrderAt }
  })

  if (view === 'ordering' || view === 'card-package-issued') {
    rows = rows.filter(item => Number(item.orderCount || 0) > 0)
    rows = rows.filter(item => matchesAdminUserOrderDateFilter(item.lastOrderAt, query))
    rows.sort((a, b) => {
      const ta = a.lastOrderAt ? new Date(a.lastOrderAt).getTime() : 0
      const tb = b.lastOrderAt ? new Date(b.lastOrderAt).getTime() : 0
      if (tb !== ta) {
        return tb - ta
      }
      return String(a.user.phone).localeCompare(String(b.user.phone))
    })
  }
  else {
    if (view === 'no-order') {
      rows = rows.filter(item => Number(item.orderCount || 0) === 0)
    }
    rows.sort((a, b) => {
      const ta = a.user.registerAt ? new Date(a.user.registerAt).getTime() : 0
      const tb = b.user.registerAt ? new Date(b.user.registerAt).getTime() : 0
      if (tb !== ta) {
        return tb - ta
      }
      return String(a.user.phone).localeCompare(String(b.user.phone))
    })
  }

  return { rows, statsIndex }
}

function listAdminUsersPaginatedBeforeEnrich(db, query) {
  const {
    page = 1,
    pageSize = 20,
  } = query
  const { rows, statsIndex } = listAdminUsersFilteredRows(db, query)
  const total = rows.length
  const start = (page - 1) * pageSize
  const pageRows = rows.slice(start, start + pageSize)
  const list = pageRows.map(({ user }) => attachUserOrderStats(db, user, {
    includeAdminPasswordEcho: true,
    precomputedOrderStats: statsIndex && statsIndex.get(String(user.id || '').trim()),
  }))
  return { list, total, page, pageSize }
}

/** 与管理端 UsersPage 列表「信誉状态」列一致：仅依据先享后付下单七项快照 */
function displayCreditStatusFromOrderSevenSnapshot(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.fourteenRows)) {
    return '待风控'
  }
  const byKey = new Map()
  for (const row of snapshot.fourteenRows) {
    if (row && row.slotKey) {
      byKey.set(row.slotKey, row)
    }
  }
  for (const key of ORDER_INSTALLMENT_RISK_STEP_KEYS) {
    const row = byKey.get(key)
    if (row && row.state === 'fail') {
      return '风险'
    }
  }
  for (const key of ORDER_INSTALLMENT_RISK_STEP_KEYS) {
    const row = byKey.get(key)
    if (!row || row.state !== 'ok') {
      return '待风控'
    }
  }
  return '良好'
}

function escapeCsvCell(value) {
  const s = String(value ?? '')
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function registerChannelExportLabelFromUser(db, user) {
  const label = resolveUserRegisterChannelLabel(db, user)
  if (label) {
    return label
  }
  return '商城注册'
}

function exportNeedsOrderStats(fields, view = 'registered') {
  if (view === 'card-package-issued') {
    return true
  }
  return Array.isArray(fields) && fields.includes('orderCount')
}

function parseExportMaskPhone(raw) {
  const value = String(raw || '').trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes'
}

/** 导出 CSV：11 位手机号保留前 3 后 4，中间以 * 替代 */
function maskPhoneForExport(phone) {
  const digits = String(phone || '').replace(/\D/g, '')
  if (digits.length >= 11) {
    return `${digits.slice(0, 3)}****${digits.slice(-4)}`
  }
  if (digits.length >= 7) {
    return `${digits.slice(0, 3)}****${digits.slice(-4)}`
  }
  if (digits.length >= 3) {
    return `${digits.slice(0, 2)}***`
  }
  return digits
}

function exportNeedsChannelResolution(fields, registerChannel) {
  if (Array.isArray(fields) && fields.includes('registerChannel')) {
    return true
  }
  return registerChannel === '__none__' || Boolean(registerChannel && registerChannel !== '__all__')
}

/** 按导出勾选字段逐项取值，避免 attachUserOrderStats 的无关 enrich */
function pickRegisteredUserExportValues(user, db, fields, statsIndex, opts = {}) {
  const maskPhone = opts.maskPhone === true
  const values = {}
  for (const key of fields) {
    switch (key) {
      case 'registerAt':
        values.registerAt = formatDateTime(user.registerAt || '')
        break
      case 'name':
        values.name = String(user.name || '').trim()
        break
      case 'phone': {
        const raw = String(user.phone || '').trim()
        values.phone = maskPhone ? maskPhoneForExport(raw) : raw
        break
      }
      case 'registerChannel':
        values.registerChannel = registerChannelExportLabelFromUser(db, user)
        break
      case 'creditStatus': {
        const snap = user.riskControlSnapshot && typeof user.riskControlSnapshot === 'object'
          ? user.riskControlSnapshot
          : null
        values.creditStatus = displayCreditStatusFromOrderSevenSnapshot(snap)
        break
      }
      case 'quota':
        values.quota = normalizeUserQuota(user.quota)
        break
      case 'orderCount': {
        const uid = String(user.id || '').trim()
        const stats = statsIndex && statsIndex.get(uid)
        values.orderCount = stats ? Math.max(0, Number(stats.orderCount || 0)) : 0
        break
      }
      case 'remark':
        values.remark = String(user.adminRemark || '').trim() || '暂无备注'
        break
      case 'manualRejectReason':
        values.manualRejectReason = String(user.manualRejectReason || '').trim()
        break
      default:
        break
    }
  }
  return values
}

const REGISTERED_USER_EXPORT_FIELDS = Object.freeze({
  registerAt: '注册时间',
  name: '姓名',
  phone: '手机号',
  registerChannel: '注册渠道',
  creditStatus: '信誉状态',
  quota: '额度',
  orderCount: '订单数',
  remark: '备注',
  manualRejectReason: '不通过原因',
})

const REGISTERED_USER_EXPORT_FIELD_KEYS = Object.freeze(Object.keys(REGISTERED_USER_EXPORT_FIELDS))

function parseRegisteredUserExportFields(raw) {
  const allowed = new Set(REGISTERED_USER_EXPORT_FIELD_KEYS)
  const parts = String(raw || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
  const picked = parts.filter(key => allowed.has(key))
  if (picked.length > 0) {
    return picked
  }
  return ['name', 'phone']
}

function buildRegisteredUsersExportCsv(db, query) {
  const fields = parseRegisteredUserExportFields(query.fields)
  const registerChannel = String(query.registerChannel || '').trim() || '__all__'
  const view = normalizeAdminUsersListView(query.view || 'registered')
  const maskPhone = parseExportMaskPhone(query.maskPhone)
  if (exportNeedsChannelResolution(fields, registerChannel)) {
    ensureTrafficChannels(db)
  }
  const { rows, statsIndex } = listAdminUsersFilteredRows(db, {
    registerChannel,
    view,
    orderDateFrom: String(query.orderDateFrom || '').trim(),
    orderDateTo: String(query.orderDateTo || '').trim(),
    orderDate: String(query.orderDate || '').trim(),
  }, {
    needOrderStats: exportNeedsOrderStats(fields, view),
  })
  const headers = fields.map(key => REGISTERED_USER_EXPORT_FIELDS[key])
  const lines = [headers.map(escapeCsvCell).join(',')]
  for (const { user } of rows) {
    const valuesByField = pickRegisteredUserExportValues(user, db, fields, statsIndex, { maskPhone })
    lines.push(fields.map(key => valuesByField[key]).map(escapeCsvCell).join(','))
  }
  return `${lines.join('\r\n')}\r\n`
}

function exportFilenameDateStamp() {
  const d = new Date()
  const y = d.getFullYear()
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  const hh = `${d.getHours()}`.padStart(2, '0')
  const min = `${d.getMinutes()}`.padStart(2, '0')
  return `${y}${m}${day}_${hh}${min}`
}

function exportFilenameDateYmd() {
  const d = new Date()
  const y = d.getFullYear()
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${y}${m}${day}`
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
  const mallUser = resolveRegisteredMallUserByNormalizedPhone(db, phone)
  const userOrders = ordersForRegisteredMallUser(db, mallUser || null)
  const userCards = db.bankCards.filter(item => normalizePhone(item.userPhone || '') === phone)

  const mallSummaryStatus = (item) => {
    ensureOrderCardPackage(item)
    return mallOrderRepaymentAwareStatus(item)
  }
  const orderCount = {
    reviewing: userOrders.filter(item => mallSummaryStatus(item) === 'reviewing').length,
    shipping: userOrders.filter(item => mallSummaryStatus(item) === 'shipping').length,
    receiving: userOrders.filter(item => mallSummaryStatus(item) === 'receiving').length,
    enjoying: userOrders.filter(item => mallSummaryStatus(item) === 'enjoying').length,
  }
  const { totalPending: billPendingAmount } = buildMallBillingListAndSummaries(db, phone)

  return {
    orderCount,
    bankCardCount: userCards.length,
    billPendingAmount,
  }
}

/** 将 Nominatim address 拼成尽量完整的中文地址（省市区镇 + 街道/村/路/门牌等） */
function formatDetailedCnAddressFromNominatim(addr) {
  if (!addr || typeof addr !== 'object') {
    return ''
  }
  /** 行政区：自上而下；同一字符串只出现一次 */
  const adminKeys = [
    'state',
    'region',
    'city',
    'county',
    'city_district',
    'district',
    'town',
  ]
  /** 细化：乡镇以下到道路门牌 */
  const detailKeys = [
    'village',
    'suburb',
    'neighbourhood',
    'quarter',
    'road',
    'pedestrian',
    'house_number',
  ]
  const seen = new Set()
  const collect = (keys) => {
    const parts = []
    for (const key of keys) {
      const raw = addr[key]
      const t = typeof raw === 'string' ? raw.trim() : ''
      if (!t || seen.has(t)) {
        continue
      }
      seen.add(t)
      parts.push(t)
    }
    return parts
  }
  const adminParts = collect(adminKeys)
  const detailParts = collect(detailKeys)
  const merged = [...adminParts, ...detailParts].join('')
  if (merged) {
    const postcode = typeof addr.postcode === 'string' ? addr.postcode.trim() : ''
    if (postcode && !merged.includes(postcode)) {
      return `${merged}（邮编 ${postcode}）`
    }
    return merged
  }
  return ''
}

router.get('/geocode/reverse', async (ctx) => {
  const lat = Number(ctx.query.lat)
  const lng = Number(ctx.query.lng ?? ctx.query.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    fail(ctx, '请提供有效的 lat、lng')
    return
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    fail(ctx, '经纬度超出范围')
    return
  }
  try {
    const reverseGeocodeUrl = String(process.env.REVERSE_GEOCODE_URL || 'https://nominatim.openstreetmap.org/reverse').trim()
    const url = new URL(reverseGeocodeUrl)
    url.searchParams.set('format', 'jsonv2')
    url.searchParams.set('lat', String(lat))
    url.searchParams.set('lon', String(lng))
    url.searchParams.set('accept-language', 'zh-CN')
    /** zoom 越高细节越多：18 接近道路/建筑级 */
    url.searchParams.set('zoom', '18')
    const res = await fetch(url.toString(), {
      headers: {
        Accept: 'application/json',
        'User-Agent': String(process.env.REVERSE_GEOCODE_USER_AGENT || 'tea-mall-registration/1.0 (dev)').trim(),
      },
    })
    if (!res.ok) {
      fail(ctx, `逆地理服务暂不可用（HTTP ${res.status}）`, 502)
      return
    }
    const json = await res.json()
    const addr = json && json.address ? json.address : {}
    let formatted = formatDetailedCnAddressFromNominatim(addr)
    const displayName = typeof json.display_name === 'string' ? json.display_name.trim() : ''
    const displayPretty = displayName ? displayName.replace(/\s*,\s*/g, ' · ') : ''
    if (!formatted) {
      formatted = displayPretty || `纬度 ${lat.toFixed(6)}，经度 ${lng.toFixed(6)}`
    }
    else if (formatted.length < 16 && displayPretty.length > formatted.length + 10) {
      /** 仅有省市区而 OSM 有更完整的中文描述时，采用更长的一条 */
      formatted = displayPretty
    }
    ctx.body = success({
      formatted,
      latitude: lat,
      longitude: lng,
      displayName,
      address: addr,
    })
  }
  catch (err) {
    console.error('[geocode/reverse]', err)
    fail(ctx, '逆地理解析失败', 502)
  }
})

router.get('/health', async (ctx) => {
  let mallSnapshot = null
  const dbm = mongo.getMongoDb()
  if (dbm) {
    try {
      const entityCounts = {}
      for (const key of mongo.SHARDED_ENTITY_KEYS) {
        const name = mongo.COLLECTIONS[key]
        entityCounts[key] = await dbm.collection(name).estimatedDocumentCount()
      }
      const metaMain = await dbm.collection(mongo.APP_META).findOne(
        { _id: 'main' },
        { projection: { _id: 1, updatedAt: 1 } },
      )
      const legacyMain = await dbm.collection(mongo.APP_STATE).findOne(
        { _id: 'main' },
        { projection: { _id: 1, updatedAt: 1 } },
      )
      mallSnapshot = {
        database: dbm.databaseName,
        layout: 'sharded_v1',
        entityCollections: entityCounts,
        metaCollection: mongo.APP_META,
        metaUpdatedAt: metaMain && metaMain.updatedAt ? metaMain.updatedAt.toISOString() : null,
        /** 若仍为 true，说明尚未完成迁移或存在旧数据，应重启 api 并检查 Mongo 状态 */
        legacyAppStateMainPresent: Boolean(legacyMain),
      }
    }
    catch (err) {
      mallSnapshot = { error: String(err.message || err) }
    }
  }

  ctx.body = success({
    status: 'up',
    hdCloud: cloudConfig.getCloudConfigSummary(),
    mongo: mongo.getMongoHealthSummary(),
    persistence: isMongoPersistenceEnabled() ? 'mongodb' : 'json_file',
    mallSnapshot,
  })
})

router.get('/products', async (ctx) => {
  const {
    category = '',
    keyword = '',
    includeAll = '',
    salesMode: salesModeQ = '',
  } = ctx.query
  const categoryKey = String(category || '').trim()
  const searchKey = String(keyword || '').trim()
  const showAll = includeAll === '1'
  const salesMode = String(salesModeQ || ctx.query.zone || '').trim()
  if (ctx.headers.authorization || ctx.headers['x-admin-role']) {
    const permissionKey = adminProductPermissionKeyForSalesMode(salesMode)
    if (!await requireAdminPermission(ctx, [ADMIN_ROLES.SUPER], 'admin action', { permissionKey, permissionAction: 'view' })) {
      return
    }
  }
  const tenantId = normalizeTenantId(ctx.state && ctx.state.tenantId ? ctx.state.tenantId : DEFAULT_TENANT_ID)
  const workspaceType = normalizeWorkspaceType(ctx.state && ctx.state.workspaceType ? ctx.state.workspaceType : 'tenant')
  const filterOpts = { categoryKey, searchKey, showAll, salesMode }

  const cacheKey = `products:${salesMode}:${showAll ? 1 : 0}:${categoryKey}:${searchKey}`
  const list = await withAdminReadCacheAsync(ctx, cacheKey, async () => {
    if (isAdminReadOptimizeEnabled() && isMongoPersistenceEnabled()) {
      const products = await readProductsFromMongoScoped(workspaceType, tenantId)
      if (Array.isArray(products)) {
        return filterProductListForQuery(products, filterOpts)
      }
    }
    const db = readDb()
    return filterProductListForQuery(db.products || [], filterOpts)
  })
  ctx.body = success(list)
})

router.post('/products', async (ctx) => {
  const payload = ctx.request.body || {}
  const permissionKey = adminProductPermissionKeyForSalesMode(payload.salesMode)
  if (!await requireAdminPermission(ctx, [ADMIN_ROLES.SUPER], 'admin action', { permissionKey, permissionAction: 'create' })) {
    return
  }
  const db = readDb()
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
  writeProductsDb(db)
  ctx.body = success(nextProduct)
})

router.patch('/products/:id', async (ctx) => {
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
  const permissionKey = adminProductPermissionKeyForSalesMode(prev.salesMode || parsed.data.salesMode)
  const patchKeys = Object.keys(parsed.data || {})
  const permissionAction = patchKeys.length === 1 && patchKeys[0] === 'onSale' ? 'toggleOnSale' : 'update'
  if (!await requireAdminPermission(ctx, [ADMIN_ROLES.SUPER], 'admin action', { permissionKey, permissionAction })) {
    return
  }
  const merged = normalizeProductRecord({
    ...prev,
    ...parsed.data,
    updatedAt: new Date().toISOString(),
  })
  db.products[targetIndex] = merged
  db.products = db.products.map(normalizeProductRecord)
  writeProductsDb(db)
  ctx.body = success(merged)
})

router.delete('/products/:id', async (ctx) => {
  const db = readDb()
  const { id } = ctx.params
  const target = db.products.find(item => String(item.id) === String(id))
  if (!target) {
    fail(ctx, 'not found', 404)
    return
  }
  const permissionKey = adminProductPermissionKeyForSalesMode(target.salesMode)
  if (!await requireAdminPermission(ctx, [ADMIN_ROLES.SUPER], 'admin action', { permissionKey, permissionAction: 'delete' })) {
    return
  }
  db.products = db.products
    .map(normalizeProductRecord)
    .filter(item => String(item.id) !== String(id))
  writeProductsDb(db)
  ctx.body = success({ id: Number(id) })
})

router.get('/products/:id', async (ctx) => {
  const db = readDb()
  const { id } = ctx.params
  const target = db.products
    .map(normalizeProductRecord)
    .find(item => String(item.id) === String(id))
  if (!target) {
    fail(ctx, '商品不存在', 404)
    return
  }
  if (ctx.headers.authorization || ctx.headers['x-admin-role']) {
    const permissionKey = adminProductPermissionKeyForSalesMode(target.salesMode)
    if (!await requireAdminPermission(ctx, [ADMIN_ROLES.SUPER], 'view detail', { permissionKey, permissionAction: 'view' })) {
      return
    }
  }
  ctx.body = success(target)
})

router.post('/auth/register/sms/send', async (ctx) => {
  const payload = ctx.request.body || {}
  const phone = normalizePhone(payload.phone)
  if (!/^1\d{10}$/.test(phone)) {
    fail(ctx, '手机号格式不正确')
    return
  }
  const db = readDb()
  const existing = db.users.find(item => item.phone === phone)
  if (existing) {
    fail(ctx, '该手机号已注册，请直接登录', 409)
    return
  }
  try {
    await sendRegisterVerificationSms(phone)
    ctx.body = success({})
  }
  catch (e) {
    const status = Number(e.httpStatus) >= 400 && Number(e.httpStatus) < 600
      ? Number(e.httpStatus)
      : 500
    fail(ctx, e.message || '短信发送失败', status)
  }
})

/** 已注册用户：发送登录短信验证码（与注册短信分桶存储） */
router.post('/auth/login/sms/send', async (ctx) => {
  const payload = ctx.request.body || {}
  const phone = normalizePhone(payload.phone)
  if (!/^1\d{10}$/.test(phone)) {
    fail(ctx, '手机号格式不正确')
    return
  }
  const db = readDb()
  const user = db.users.find(item => item.phone === phone)
  if (!user) {
    fail(ctx, '该手机号未注册，请先完成注册', 404)
    return
  }
  try {
    await sendLoginVerificationSms(phone)
    ctx.body = success({})
  }
  catch (e) {
    const status = Number(e.httpStatus) >= 400 && Number(e.httpStatus) < 600
      ? Number(e.httpStatus)
      : 500
    fail(ctx, e.message || '短信发送失败', status)
  }
})

router.post('/auth/register', async (ctx) => {
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

  const idNumberRaw = String(payload.idNumber || '').trim().toUpperCase()
  if (!idNumberRaw) {
    fail(ctx, '身份证号不能为空')
    return
  }
  if (!/^[1-9]\d{5}(18|19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dX]$/.test(idNumberRaw)) {
    fail(ctx, '身份证号格式不正确')
    return
  }
  payload.idNumber = idNumberRaw

  const pwdRaw = String(payload.password != null ? payload.password : '').trim()
  if (pwdRaw.length < 6) {
    fail(ctx, '请设置登录密码（至少 6 位）')
    return
  }
  payload.password = pwdRaw

  const emergencyCheck = validateEmergencyContactsInput(payload.emergencyContacts, phone)
  if (!emergencyCheck.ok) {
    fail(ctx, emergencyCheck.msg, 400)
    return
  }
  payload.emergencyContacts = emergencyCheck.list

  const existing = db.users.find(item => item.phone === phone)
  if (existing) {
    fail(ctx, '该手机号已注册，请直接登录', 409)
    return
  }

  const channelCheck = resolveRegisterChannelForRegistration(db, payload)
  if (channelCheck.error) {
    fail(ctx, channelCheck.error.msg || '推广链接失效，请重新打开', 400)
    return
  }

  const smsCheck = verifyAndConsumeRegisterSms(phone, payload.smsCode)
  if (!smsCheck.ok) {
    fail(ctx, smsCheck.reason)
    return
  }

  const user = createMallUserFromRegisterPayload(db, payload)
  writeUsersDb(db)
  ctx.body = success(attachUserOrderStats(db, user, { mall: true }))
})

router.post('/auth/login', async (ctx) => {
  const db = readDb()
  ensureAdminAccounts(db)
  const payload = ctx.request.body || {}
  const phone = normalizePhone(payload.phone)
  const loginType = String(payload.loginType || 'sms').toLowerCase()

  if (!/^1\d{10}$/.test(phone)) {
    fail(ctx, '手机号格式不正确')
    return
  }

  let user = db.users.find(item => item.phone === phone)

  if (loginType === 'password') {
    const password = String(payload.password || '')
    if (password.length < 6) {
      fail(ctx, '密码至少6位')
      return
    }
    if (!user) {
      fail(ctx, '该手机号未注册，请先完成注册', 404)
      return
    }
    if (!user.passwordHash) {
      fail(ctx, '该账号尚未设置密码，请使用验证码登录或联系管理员设置')
      return
    }
    if (!verifyMallUserPassword(password, user.passwordHash)) {
      fail(ctx, '手机号或密码错误', 401)
      return
    }
    ctx.body = success({
      token: `mock-token-${phone}`,
      user: attachUserOrderStats(db, user, { mall: true }),
      adminRole: getAdminRoleByPhone(db, phone) || '',
    })
    return
  }

  const verifyCode = String(payload.verifyCode || '').trim()
  if (!verifyCode) {
    fail(ctx, '验证码不能为空')
    return
  }
  if (!user) {
    fail(ctx, '该手机号未注册，请先完成注册', 404)
    return
  }

  const smsCheck = verifyAndConsumeLoginSms(phone, verifyCode)
  if (!smsCheck.ok) {
    fail(ctx, smsCheck.reason)
    return
  }

  ctx.body = success({
    token: `mock-token-${phone}`,
    user: attachUserOrderStats(db, user, { mall: true }),
    adminRole: getAdminRoleByPhone(db, phone) || '',
  })
})

async function handleAdminLogin(ctx) {
  const payload = ctx.request.body || {}
  const username = String(payload.username || '').trim()
  const password = String(payload.password || '').trim()
  const requestTenantId = normalizeTenantId(ctx.state && ctx.state.tenantId ? ctx.state.tenantId : DEFAULT_TENANT_ID)
  const account = await getAdminAccountByUsernameAcrossTenants(username, requestTenantId)
  if (!account || account.password !== password) {
    fail(ctx, '账号或密码错误', 401)
    return
  }
  if (account.status !== 'active') {
    fail(ctx, '账号已被禁用，请联系超级管理员', 403)
    return
  }

  const effectiveTenant = account.scopeType === 'platform'
    ? requestTenantId
    : normalizeTenantId(account.tenantId || DEFAULT_TENANT_ID)
  if (!accountCanAccessTenant(account, effectiveTenant)) {
    fail(ctx, '当前账号无权访问该子系统', 403)
    return
  }

  ctx.body = success({
    username,
    name: String(account.name || '').trim(),
    token: `mock-token-${account.phone}`,
    adminRole: account.role,
    roleLabel: getRoleLabel(account.role),
    scopeType: account.scopeType || 'tenant',
    tenantId: normalizeTenantId(account.tenantId || 'default'),
    tenantName: effectiveTenant === DEFAULT_TENANT_ID ? '主系统' : effectiveTenant,
    scopeTenantIds: effectiveScopeTenantIds(account),
    permissions: effectiveAdminPermissions(account.role, account.permissions),
  })
}

router.post('/admin/login', async (ctx) => {
  await handleAdminLogin(ctx)
})

// 兼容部分前端将后台登录请求到 /api/login 的场景。
router.post('/login', async (ctx) => {
  await handleAdminLogin(ctx)
})

router.get('/admin/profile', async (ctx) => {
  const account = await resolveAdminAccount(ctx)
  if (!account || account.status !== 'active') {
    fail(ctx, '未登录或账号无效', 401)
    return
  }
  ctx.body = success({
    username: account.username,
    name: String(account.name || '').trim() || getRoleLabel(account.role),
    role: account.role,
    roleLabel: getRoleLabel(account.role),
    permissions: effectiveAdminPermissions(account.role, account.permissions),
  })
})

function toAdminAccountView(account) {
  const tenantId = normalizeTenantId(account.tenantId || 'default')
  return {
    id: account.id,
    username: account.username,
    role: account.role,
    roleLabel: getRoleLabel(account.role),
    name: account.name,
    phone: account.phone,
    status: account.status,
    scopeType: account.scopeType || 'tenant',
    tenantId,
    tenantName: tenantId === DEFAULT_TENANT_ID ? '主系统' : tenantId,
    scopeTenantIds: effectiveScopeTenantIds(account),
    permissions: effectiveAdminPermissions(account.role, account.permissions),
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  }
}

function isBossAccount(account) {
  return normalizeAdminRole(account && account.role ? account.role : '') === ADMIN_ROLES.BOSS
}

async function listTenantAdminAccountsForValidation(extraTenantIds = []) {
  const base = await collectKnownTenantIds()
  const set = new Set(base)
  extraTenantIds
    .map(item => normalizeTenantId(item))
    .filter(item => item && item !== DEFAULT_TENANT_ID)
    .forEach(item => set.add(item))
  const rows = []
  for (const tenantId of set) {
    const db = await readDbByTenantId(tenantId)
    const accounts = Array.isArray(db.adminAccounts) ? db.adminAccounts : []
    accounts.forEach((item) => {
      rows.push({
        account: normalizeAdminAccount(item),
        tenantId,
      })
    })
  }
  return rows
}

async function findDuplicatedBossUsername(username, extraTenantIds = [], excludeAccountId = '') {
  const key = String(username || '').trim()
  if (!key) return null
  const rows = await listTenantAdminAccountsForValidation(extraTenantIds)
  return rows.find(({ account }) => {
    if (!account || account.id === excludeAccountId) return false
    if (!isBossAccount(account)) return false
    return String(account.username || '').trim() === key
  }) || null
}

async function findDuplicatedBossPhone(phone, extraTenantIds = [], excludeAccountId = '') {
  const key = normalizePhone(phone)
  if (!key) return null
  const rows = await listTenantAdminAccountsForValidation(extraTenantIds)
  return rows.find(({ account }) => {
    if (!account || account.id === excludeAccountId) return false
    if (!isBossAccount(account)) return false
    return normalizePhone(account.phone) === key
  }) || null
}

async function createTenantScopedAdminAccount(targetTenantId, payload) {
  const tid = normalizeTenantId(targetTenantId)
  if (isMongoPersistenceEnabled()) {
    await refreshScopeCacheFromMongo('tenant', tid)
  }
  return runWithTenant(tid, async () => {
    const db = readDb()
    ensureAdminAccounts(db)
    const username = String(payload.username || '').trim()
    const phone = normalizePhone(payload.phone)
    const role = normalizeAdminRole(payload.role)
    if (role === ADMIN_ROLES.BOSS) {
      const duplicatedBossUsername = await findDuplicatedBossUsername(username, [tid])
      if (duplicatedBossUsername) {
        return { ok: false, code: 409, msg: '老板账号已存在，请更换账号' }
      }
      const duplicatedBossPhone = await findDuplicatedBossPhone(phone, [tid])
      if (duplicatedBossPhone) {
        return { ok: false, code: 409, msg: '老板手机号已存在，请更换手机号' }
      }
    }
    if (db.adminAccounts.some(item => item.username === username)) {
      return { ok: false, code: 409, msg: '该子系统已存在同名后台账号' }
    }
    if (db.adminAccounts.some(item => item.phone === phone)) {
      return { ok: false, code: 409, msg: '该子系统手机号已被后台账号占用' }
    }
    const now = new Date().toISOString()
    const next = normalizeAdminAccount({
      id: `A${Date.now()}`,
      username,
      password: String(payload.password || '').trim(),
      role: payload.role,
      phone,
      name: String(payload.name || '').trim() || getRoleLabel(payload.role),
      status: 'active',
      scopeType: 'tenant',
      tenantId: tid,
      scopeTenantIds: [tid],
      permissions: payload.permissions,
      createdAt: now,
      updatedAt: now,
    })
    db.adminAccounts.unshift(next)
    writeAdminAccountsDb(db)
    clearAdminAccountCaches()
    return { ok: true, account: next }
  })
}

async function createPlatformScopedAdminAccount(payload) {
  if (isMongoPersistenceEnabled()) {
    await refreshScopeCacheFromMongo('core', DEFAULT_TENANT_ID)
  }
  return runWithWorkspace('core', DEFAULT_TENANT_ID, () => {
    const db = readDb()
    ensureAdminAccounts(db)
    const username = String(payload.username || '').trim()
    const phone = normalizePhone(payload.phone)
    if (db.adminAccounts.some(item => item.username === username)) {
      return { ok: false, code: 409, msg: '主系统已存在同名后台账号' }
    }
    if (db.adminAccounts.some(item => item.phone === phone)) {
      return { ok: false, code: 409, msg: '主系统手机号已被后台账号占用' }
    }
    const now = new Date().toISOString()
    const next = normalizeAdminAccount({
      id: `A${Date.now()}`,
      username,
      password: String(payload.password || '').trim(),
      role: payload.role,
      phone,
      name: String(payload.name || '').trim() || getRoleLabel(payload.role),
      status: 'active',
      scopeType: 'platform',
      tenantId: DEFAULT_TENANT_ID,
      scopeTenantIds: payload.scopeTenantIds,
      permissions: payload.permissions,
      createdAt: now,
      updatedAt: now,
    })
    db.adminAccounts.unshift(next)
    writeAdminAccountsDb(db)
    clearAdminAccountCaches()
    return { ok: true, account: next }
  })
}

function parseKnownTenantIdsFromMeta(meta) {
  if (!meta || typeof meta !== 'object') {
    return []
  }
  const raw = Array.isArray(meta.knownTenantIds) ? meta.knownTenantIds : []
  const out = []
  for (const item of raw) {
    const t = normalizeTenantId(item)
    if (!out.includes(t)) {
      out.push(t)
    }
  }
  return out
}

function parseTenantCreatedAtMapFromMeta(meta) {
  if (!meta || typeof meta !== 'object' || !meta.tenantCreatedAtById || typeof meta.tenantCreatedAtById !== 'object') {
    return {}
  }
  const out = {}
  Object.entries(meta.tenantCreatedAtById).forEach(([rawTenantId, rawCreatedAt]) => {
    const tenantId = normalizeTenantId(rawTenantId)
    if (!tenantId || tenantId === DEFAULT_TENANT_ID) return
    const createdAt = String(rawCreatedAt || '').trim()
    if (!createdAt) return
    out[tenantId] = createdAt
  })
  return out
}

function writeTenantCreatedAtMapMeta(db, createdAtById) {
  if (!db._meta || typeof db._meta !== 'object') {
    db._meta = {}
  }
  db._meta.tenantCreatedAtById = { ...createdAtById }
}

function writeKnownTenantIdsMeta(db, tenantIds) {
  const list = []
  for (const item of tenantIds) {
    const t = normalizeTenantId(item)
    if (!list.includes(t)) {
      list.push(t)
    }
  }
  if (!db._meta || typeof db._meta !== 'object') {
    db._meta = {}
  }
  db._meta.knownTenantIds = list
}

function ensureTenantRegistered(db, tenantId) {
  const tenant = normalizeTenantId(tenantId)
  if (!tenant || tenant === DEFAULT_TENANT_ID) {
    return false
  }
  const known = parseKnownTenantIdsFromMeta(db._meta)
  const createdAtById = parseTenantCreatedAtMapFromMeta(db._meta)
  let changed = false
  if (!known.includes(tenant)) {
    known.push(tenant)
    changed = true
  }
  if (!createdAtById[tenant]) {
    createdAtById[tenant] = new Date().toISOString()
    changed = true
  }
  if (changed) {
    writeKnownTenantIdsMeta(db, known)
    writeTenantCreatedAtMapMeta(db, createdAtById)
    writeAppMetaDb(db)
  }
  return true
}

async function registerKnownTenantId(tenantId) {
  const nextTenantId = normalizeTenantId(tenantId || DEFAULT_TENANT_ID)
  if (isMongoPersistenceEnabled()) {
    await refreshScopeCacheFromMongo('core', DEFAULT_TENANT_ID)
  }
  runWithWorkspace('core', DEFAULT_TENANT_ID, () => {
    const db = readDb()
    ensureTenantRegistered(db, nextTenantId)
  })
}

async function unregisterKnownTenantId(tenantId) {
  const nextTenantId = normalizeTenantId(tenantId || DEFAULT_TENANT_ID)
  if (!nextTenantId || nextTenantId === DEFAULT_TENANT_ID) {
    return false
  }
  if (isMongoPersistenceEnabled()) {
    await refreshScopeCacheFromMongo('core', DEFAULT_TENANT_ID)
  }
  return runWithWorkspace('core', DEFAULT_TENANT_ID, () => {
    const db = readDb()
    const known = parseKnownTenantIdsFromMeta(db._meta)
    const createdAtById = parseTenantCreatedAtMapFromMeta(db._meta)
    const nextKnown = known.filter(item => item !== nextTenantId)
    if (nextKnown.length === known.length && !createdAtById[nextTenantId]) {
      return false
    }
    if (createdAtById[nextTenantId]) {
      delete createdAtById[nextTenantId]
    }
    writeKnownTenantIdsMeta(db, nextKnown)
    writeTenantCreatedAtMapMeta(db, createdAtById)
    writeAppMetaDb(db)
    return true
  })
}

async function collectKnownTenantIds() {
  const set = new Set()
  const dbCore = await readCoreDb()
  parseKnownTenantIdsFromMeta(dbCore._meta)
    .filter(id => id !== DEFAULT_TENANT_ID)
    .forEach(id => set.add(id))
  return [...set]
}

async function collectKnownTenantIdsForPlatform() {
  const set = new Set(await collectKnownTenantIds())
  const client = mongo.getMongoClient ? mongo.getMongoClient() : null
  if (client) {
    try {
      const admin = client.db().admin()
      const all = await admin.listDatabases()
      const dbName = String(mongoConfig.getMongoConfig().dbName || 'mall').trim() || 'mall'
      const prefix = `${dbName}__tenant_`
      const list = Array.isArray(all?.databases) ? all.databases : []
      list.forEach((item) => {
        const name = String(item?.name || '')
        if (!name.startsWith(prefix)) {
          return
        }
        const suffix = name.slice(prefix.length)
        const tenantId = normalizeTenantId(suffix || DEFAULT_TENANT_ID)
        if (tenantId && tenantId !== DEFAULT_TENANT_ID) {
          set.add(tenantId)
        }
      })
    }
    catch {
      // ignore mongo list failure, fallback to meta-known tenants
    }
  }
  const fromScan = [...set].filter(id => id !== DEFAULT_TENANT_ID)
  /** 与 core._meta 合并后的视图；必须返回该列表，若仅返回 fromScan，会在并发下漏掉他刚写入的 knownTenantIds（列表空却「ID 已存在」）。 */
  let mergedForReturn = fromScan
  if (isMongoPersistenceEnabled()) {
    await refreshScopeCacheFromMongo('core', DEFAULT_TENANT_ID)
  }
  runWithWorkspace('core', DEFAULT_TENANT_ID, () => {
    const db = readDb()
    const known = parseKnownTenantIdsFromMeta(db._meta).filter(id => id !== DEFAULT_TENANT_ID)
    const merged = [...new Set([...known, ...fromScan])].sort((a, b) => a.localeCompare(b))
    mergedForReturn = merged
    const knownSet = new Set(known)
    const needsMetaWrite = merged.length !== known.length
      || merged.some(id => !knownSet.has(id))
    if (needsMetaWrite) {
      writeKnownTenantIdsMeta(db, merged)
      writeAppMetaDb(db)
    }
  })
  return mergedForReturn
}

function resolveMongoScopedDbName(workspaceType, tenantId) {
  const ws = normalizeWorkspaceType(workspaceType || 'tenant')
  const t = normalizeTenantId(tenantId || DEFAULT_TENANT_ID)
  const dbName = String(mongoConfig.getMongoConfig().dbName || 'mall').trim() || 'mall'
  if (ws === 'core') {
    return `${dbName}__core`
  }
  if (ws === 'self') {
    return `${dbName}__self`
  }
  if (t !== DEFAULT_TENANT_ID) {
    return `${dbName}__tenant_${t}`
  }
  return dbName
}

function getMongoScopedCollection(workspaceType, tenantId, collectionName) {
  const client = mongo.getMongoClient && mongo.getMongoClient()
  if (!client || !collectionName) {
    return null
  }
  return client.db(resolveMongoScopedDbName(workspaceType, tenantId)).collection(collectionName)
}

async function readMongoEntityDocsByIds(workspaceType, tenantId, collectionName, ids) {
  const cleanIds = [...new Set((Array.isArray(ids) ? ids : [])
    .map(id => String(id || '').trim())
    .filter(Boolean))]
  if (!cleanIds.length) {
    return []
  }
  const coll = getMongoScopedCollection(workspaceType, tenantId, collectionName)
  if (!coll) {
    return null
  }
  const docs = await coll.find({ _id: { $in: cleanIds } }).toArray()
  return docs.map(mapMongoEntityDoc).filter(Boolean)
}

async function buildAdminOrderMongoEnrichDb(workspaceType, tenantId, fallbackDb, pageOrders) {
  try {
    const userIds = [...new Set((Array.isArray(pageOrders) ? pageOrders : [])
      .map(order => String(order && order.mallUserId || '').trim())
      .filter(Boolean))]
    const users = await readMongoEntityDocsByIds(workspaceType, tenantId, mongo.COLLECTIONS.users, userIds)
    const ordersColl = getMongoScopedCollection(workspaceType, tenantId, mongo.COLLECTIONS.orders)
    if (!ordersColl || !Array.isArray(users)) {
      return fallbackDb
    }
    const orders = userIds.length
      ? (await ordersColl.find({ mallUserId: { $in: userIds } }).toArray()).map(mapMongoEntityDoc).filter(Boolean)
      : []
    return {
      ...(fallbackDb || {}),
      users,
      orders,
    }
  }
  catch {
    return fallbackDb
  }
}

function mapMongoEntityDoc(doc) {
  if (!doc || typeof doc !== 'object') {
    return null
  }
  const { _id, ...rest } = doc
  if (rest.id === undefined && _id !== undefined) {
    if (typeof _id === 'object' && _id && typeof _id.toHexString === 'function') {
      return { ...rest, id: _id.toString() }
    }
    return { ...rest, id: _id }
  }
  return { ...rest }
}

async function readAdminAccountsFromMongoScoped(workspaceType, tenantId) {
  const client = mongo.getMongoClient && mongo.getMongoClient()
  if (!client) {
    return null
  }
  try {
    const scopedDbName = resolveMongoScopedDbName(workspaceType, tenantId)
    const docs = await client.db(scopedDbName).collection(mongo.COLLECTIONS.adminAccounts).find({}).toArray()
    return docs
      .map(mapMongoEntityDoc)
      .map(item => normalizeAdminAccount(item))
      .filter(item => item && item.username)
  }
  catch {
    return null
  }
}

async function readOrdersFromMongoScoped(workspaceType, tenantId) {
  const client = mongo.getMongoClient && mongo.getMongoClient()
  if (!client) {
    return null
  }
  try {
    const scopedDbName = resolveMongoScopedDbName(workspaceType, tenantId)
    const docs = await client.db(scopedDbName).collection(mongo.COLLECTIONS.orders).find({}).toArray()
    return docs.map(mapMongoEntityDoc).filter(Boolean)
  }
  catch {
    return null
  }
}

async function readProductsFromMongoScoped(workspaceType, tenantId) {
  const client = mongo.getMongoClient && mongo.getMongoClient()
  if (!client) {
    return null
  }
  try {
    const scopedDbName = resolveMongoScopedDbName(workspaceType, tenantId)
    const docs = await client.db(scopedDbName).collection(mongo.COLLECTIONS.products).find({}).toArray()
    return docs.map(mapMongoEntityDoc).filter(Boolean)
  }
  catch {
    return null
  }
}

function filterProductListForQuery(products, { categoryKey, searchKey, showAll, salesMode }) {
  return products
    .map(normalizeProductRecord)
    .filter((item) => {
      if (salesMode === 'mall' || salesMode === 'installment') {
        if (item.salesMode !== salesMode) {
          return false
        }
      }
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
        || String(item.cardPackageAmount ?? '').includes(searchKey)
    })
    .sort((a, b) => Number(b.id) - Number(a.id))
}

function normalizeAdminAccountsListInTenantContext(tenantId, accounts) {
  const list = Array.isArray(accounts) ? accounts : []
  return runWithTenant(normalizeTenantId(tenantId || DEFAULT_TENANT_ID), () => {
    const db = { adminAccounts: list }
    ensureAdminAccounts(db)
    return db.adminAccounts
  })
}

async function lookupActiveAdminAccountFromMongo(workspaceType, tenantId, username, phone) {
  const accounts = await readAdminAccountsFromMongoScoped(workspaceType, tenantId)
  if (!Array.isArray(accounts) || !accounts.length) {
    return null
  }
  const t = normalizeTenantId(tenantId || DEFAULT_TENANT_ID)
  const normalized = normalizeAdminAccountsListInTenantContext(t, accounts)
  const key = String(username || '').trim()
  const normalizedPhone = normalizePhone(phone)
  const account = normalized.find(item => item && item.username === key) || null
  if (
    account
    && account.status === 'active'
    && normalizePhone(account.phone) === normalizedPhone
  ) {
    return account
  }
  return null
}

function buildAdminAccountsListView(accounts, scopeTypeQuery, currentAccount) {
  let rows = (Array.isArray(accounts) ? accounts : [])
    .map(toAdminAccountView)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
  if (scopeTypeQuery === 'platform' || scopeTypeQuery === 'tenant') {
    rows = rows.filter(item => item.scopeType === scopeTypeQuery)
  }
  if (!currentAccount || currentAccount.scopeType !== 'platform') {
    rows = rows.filter(item => item.scopeType !== 'platform')
  }
  return rows
}

function buildPlatformAccountsListView(accounts) {
  return (Array.isArray(accounts) ? accounts : [])
    .filter(item => String(item.scopeType || 'tenant') === 'platform')
    .map(item => ({
      ...toAdminAccountView(item),
      sourceTenantId: DEFAULT_TENANT_ID,
      sourceTenantName: '主系统',
    }))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
}

async function readTenantAdminAccountsFromMongo(tenantId) {
  return readAdminAccountsFromMongoScoped('tenant', tenantId)
}

/**
 * 合并 Mongo 与本地 JSON 子库账号：Mongo 集合存在但为空时（常见于仅有业务数据写入、账号仍在 JSON），须回退 readDbByTenantId，
 * 否则平台「子系统列表」会误判该子系统无老板账号。
 */
async function resolveTenantAdminAccountsList(tenantId) {
  const mongoAccounts = await readTenantAdminAccountsFromMongo(tenantId)
  if (Array.isArray(mongoAccounts) && mongoAccounts.length > 0) {
    return mongoAccounts
  }
  const db = await readDbByTenantId(tenantId)
  ensureAdminAccounts(db)
  return db.adminAccounts
}

async function findGlobalBossConflict({ username, phone, excludeAccountId = '' }) {
  const usernameKey = String(username || '').trim()
  const phoneKey = normalizePhone(phone)
  const known = await collectKnownTenantIdsForPlatform()
  const tenantIds = [...new Set(known.filter(id => id && id !== DEFAULT_TENANT_ID))]

  for (const tenantId of tenantIds) {
    const sourceAccounts = await resolveTenantAdminAccountsList(tenantId)
    for (const raw of sourceAccounts) {
      const account = normalizeAdminAccount(raw)
      if (!account || account.id === excludeAccountId) continue
      if (normalizeAdminRole(account.role) !== ADMIN_ROLES.BOSS) continue
      if (usernameKey && String(account.username || '').trim() === usernameKey) {
        return { type: 'username', tenantId }
      }
      if (phoneKey && normalizePhone(account.phone) === phoneKey) {
        return { type: 'phone', tenantId }
      }
    }
  }

  const coreDb = await readCoreDb()
  ensureAdminAccounts(coreDb)
  for (const raw of coreDb.adminAccounts || []) {
    const account = normalizeAdminAccount(raw)
    if (!account || account.id === excludeAccountId) continue
    if (normalizeAdminRole(account.role) !== ADMIN_ROLES.BOSS) continue
    if (usernameKey && String(account.username || '').trim() === usernameKey) {
      return { type: 'username', tenantId: DEFAULT_TENANT_ID }
    }
    if (phoneKey && normalizePhone(account.phone) === phoneKey) {
      return { type: 'phone', tenantId: DEFAULT_TENANT_ID }
    }
  }

  return null
}

router.get('/admin/permissions/catalog', async (ctx) => {
  if (!await requireAdminPermission(ctx, [ADMIN_ROLES.SUPER, ADMIN_ROLES.BOSS], '查看后台权限目录', { permissionKey: 'accounts', permissionAction: 'permission' })) {
    return
  }
  ctx.body = success({
    actions: ADMIN_PERMISSION_ACTIONS,
    actionLabels: ADMIN_PERMISSION_ACTION_LABELS,
    tree: ADMIN_PERMISSION_TREE,
    roleDefaults: {
      boss: defaultAdminPermissionsForRole(ADMIN_ROLES.BOSS),
      reviewer: defaultAdminPermissionsForRole(ADMIN_ROLES.REVIEWER),
      collector: defaultAdminPermissionsForRole(ADMIN_ROLES.COLLECTOR),
    },
  })
})

router.get('/admin/accounts', async (ctx) => {
  if (!await requireAdminPermission(ctx, [ADMIN_ROLES.SUPER, ADMIN_ROLES.BOSS], '查看后台账号', { permissionKey: 'accounts', permissionAction: 'view' })) {
    return
  }
  const scopeTypeQuery = String(ctx.query?.scopeType || '').trim()
  const currentAccount = await resolveAdminAccount(ctx)
  const tenantId = normalizeTenantId(ctx.state && ctx.state.tenantId ? ctx.state.tenantId : DEFAULT_TENANT_ID)
  const workspaceType = normalizeWorkspaceType(ctx.state && ctx.state.workspaceType ? ctx.state.workspaceType : 'tenant')
  const cacheSubKey = `admin-accounts:${scopeTypeQuery}:${currentAccount?.scopeType || 'unknown'}`
  const list = await withAdminReadCacheAsync(ctx, cacheSubKey, async () => {
    if (isAdminReadOptimizeEnabled() && isMongoPersistenceEnabled()) {
      let accounts = await readAdminAccountsFromMongoScoped(workspaceType, tenantId)
      if (Array.isArray(accounts)) {
        accounts = normalizeAdminAccountsListInTenantContext(tenantId, accounts)
        return buildAdminAccountsListView(accounts, scopeTypeQuery, currentAccount)
      }
    }
    const db = readDb()
    ensureAdminAccounts(db)
    return buildAdminAccountsListView(db.adminAccounts, scopeTypeQuery, currentAccount)
  })
  ctx.body = success(list)
})

router.post('/admin/accounts', async (ctx) => {
  if (!await requireAdminPermissionOnAny(ctx, ['accounts', 'tenants.system'], 'create', '新增后台账号')) {
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
  const tenantId = normalizeTenantId(payload.tenantId || ctx.state.tenantId || 'default')
  const scopeType = ADMIN_SCOPE_TYPES.has(String(payload.scopeType || '').trim())
    ? String(payload.scopeType).trim()
    : ((tenantId === DEFAULT_TENANT_ID && [ADMIN_ROLES.SUPER, ADMIN_ROLES.BOSS].includes(role)) ? 'platform' : 'tenant')
  const scopeTenantIds = Array.isArray(payload.scopeTenantIds)
    ? payload.scopeTenantIds.map(x => String(x || '').trim()).filter(Boolean).map(x => (x === '*' ? '*' : normalizeTenantId(x)))
    : []
  if (!/^[a-zA-Z][a-zA-Z0-9_]{3,20}$/.test(username)) {
    fail(ctx, '账号格式不正确，需4-21位字母数字下划线且以字母开头')
    return
  }
  if (password.length < 4) {
    fail(ctx, '密码长度至少为4位')
    return
  }
  if (![ADMIN_ROLES.REVIEWER, ADMIN_ROLES.COLLECTOR, ADMIN_ROLES.BOSS].includes(role)) {
    fail(ctx, '仅允许新增审核员、催收员或老板账号（审核员含原客服进线与订单审核权限；老板与超级管理员同权）')
    return
  }
  if (role === ADMIN_ROLES.SUPER) {
    fail(ctx, '系统仅允许一个主系统管理员，不支持新增超级管理员账号', 403)
    return
  }
  if (!/^1\d{10}$/.test(phone)) {
    fail(ctx, '手机号格式不正确')
    return
  }
  const currentAccount = await resolveAdminAccount(ctx)
  if (payload.permissions !== undefined) {
    if (!canManageRolePermissions(normalizeAdminRole(currentAccount && currentAccount.role))
      || !hasAdminPermission(currentAccount, 'accounts', 'permission')) {
      fail(ctx, '当前账号无权限分配后台账号权限', 403)
      return
    }
    if (!canGrantAdminPermissions(currentAccount, payload.permissions)) {
      fail(ctx, '不能分配超过当前账号拥有范围的权限', 403)
      return
    }
  }
  const finalScopeType = scopeType
  const finalTenantId = normalizeTenantId(tenantId || 'default')
  if (finalScopeType === 'tenant') {
    const currentTenantId = normalizeTenantId(currentAccount && currentAccount.tenantId ? currentAccount.tenantId : DEFAULT_TENANT_ID)
    if (currentAccount && currentAccount.scopeType !== 'platform' && finalTenantId !== currentTenantId) {
      fail(ctx, '子系统账号只能创建在当前子系统内', 403)
      return
    }
    if (finalTenantId === DEFAULT_TENANT_ID && currentAccount && currentAccount.scopeType !== 'platform') {
      fail(ctx, '子系统账号不能创建到主系统子系统 default', 403)
      return
    }
    if (role === ADMIN_ROLES.BOSS) {
      const bossConflict = await findGlobalBossConflict({ username, phone })
      if (bossConflict) {
        fail(ctx, bossConflict.type === 'username' ? '老板账号已存在，请更换账号' : '老板手机号已存在，请更换手机号', 409)
        return
      }
    }
    const created = await createTenantScopedAdminAccount(finalTenantId, {
      username,
      password,
      role,
      phone,
      name,
      permissions: payload.permissions,
    })
    if (!created.ok) {
      fail(ctx, created.msg, created.code)
      return
    }
    await registerKnownTenantId(finalTenantId)
    ctx.body = success(toAdminAccountView(created.account))
    return
  }
  if (!currentAccount || currentAccount.scopeType !== 'platform') {
    fail(ctx, '仅主系统账号可创建平台账号', 403)
    return
  }
  const created = await createPlatformScopedAdminAccount({
    username,
    password,
    role,
    phone,
    name,
    scopeTenantIds,
    permissions: payload.permissions,
  })
  if (!created.ok) {
    fail(ctx, created.msg, created.code)
    return
  }
  ctx.body = success(toAdminAccountView(created.account))
})

router.patch('/admin/accounts/:id', async (ctx) => {
  const payload = ctx.request.body || {}
  if (!await requireAdminAccountPatchPermissions(ctx, payload, '修改后台账号')) {
    return
  }
  const db = readDb()
  ensureAdminAccounts(db)
  const { id } = ctx.params
  const currentAccount = await resolveAdminAccount(ctx)
  const isPlatformOperator = Boolean(currentAccount && currentAccount.scopeType === 'platform')
  const operatorTenantId = normalizeTenantId(currentAccount && currentAccount.tenantId ? currentAccount.tenantId : DEFAULT_TENANT_ID)
  const target = db.adminAccounts.find(item => item.id === id)
  if (!target) {
    fail(ctx, '后台账号不存在', 404)
    return
  }
  if (!isPlatformOperator && String(target.scopeType || 'tenant') === 'platform') {
    fail(ctx, '子系统不可修改主系统账号', 403)
    return
  }
  if (target.username === DEFAULT_SUPER_ADMIN_USERNAME && payload.role && !isSuperEquivalentRole(normalizeAdminRole(payload.role))) {
    fail(ctx, '默认超级管理员账号角色不可修改')
    return
  }
  const targetTenantId = normalizeTenantId(target.tenantId || operatorTenantId || DEFAULT_TENANT_ID)
  const targetRole = normalizeAdminRole(target.role)
  const nextRolePreview = payload.role !== undefined ? normalizeAdminRole(payload.role) : targetRole
  const nextUsernamePreview = payload.username !== undefined
    ? String(payload.username || '').trim()
    : String(target.username || '').trim()
  const nextPhonePreview = payload.phone !== undefined
    ? normalizePhone(payload.phone)
    : normalizePhone(target.phone)
  const hasPermissionPayload = payload.permissions !== undefined
  const normalizedPermissionPayload = hasPermissionPayload ? normalizeAdminPermissions(payload.permissions) : null
  if (hasPermissionPayload) {
    const operatorRole = normalizeAdminRole(currentAccount && currentAccount.role)
    if (!canManageRolePermissions(operatorRole) || !hasAdminPermission(currentAccount, 'accounts', 'permission')) {
      fail(ctx, '仅系统管理员和老板可以编辑账号权限', 403)
      return
    }
    if (currentAccount && currentAccount.id === target.id) {
      fail(ctx, '不能修改当前登录账号自己的权限，避免误操作锁定账号', 403)
      return
    }
    if (operatorRole !== ADMIN_ROLES.SUPER && normalizeAdminRole(target.role) === ADMIN_ROLES.SUPER) {
      fail(ctx, '仅超级管理员可以修改超级管理员权限', 403)
      return
    }
    if (!canGrantAdminPermissions(currentAccount, normalizedPermissionPayload)) {
      fail(ctx, '不能分配超过当前账号拥有范围的权限', 403)
      return
    }
  }
  if (payload.username !== undefined) {
    const nextUsername = String(payload.username || '').trim()
    if (!/^[a-zA-Z][a-zA-Z0-9_]{3,20}$/.test(nextUsername)) {
      fail(ctx, '账号格式不正确，需4-21位字母数字下划线且以字母开头')
      return
    }
    if (target.username === DEFAULT_SUPER_ADMIN_USERNAME && nextUsername !== DEFAULT_SUPER_ADMIN_USERNAME) {
      fail(ctx, '默认超级管理员账号不可修改账号名')
      return
    }
    const duplicated = db.adminAccounts.some(item => item.id !== target.id && item.username === nextUsername)
    if (duplicated) {
      fail(ctx, '该子系统已存在同名后台账号', 409)
      return
    }
    target.username = nextUsername
  }
  if (payload.role !== undefined) {
    const nextRole = normalizeAdminRole(payload.role)
    if (!nextRole) {
      fail(ctx, '角色不正确')
      return
    }
    if (nextRole === ADMIN_ROLES.SUPER && target.username !== DEFAULT_SUPER_ADMIN_USERNAME) {
      fail(ctx, '系统仅允许一个主系统管理员，不能将其他账号改为超级管理员', 403)
      return
    }
    target.role = nextRole
    if (!hasPermissionPayload) {
      target.permissions = resetAdminPermissionsForRole(nextRole)
    }
  }
  if (payload.scopeType !== undefined) {
    const nextScopeType = String(payload.scopeType || '').trim()
    if (!isPlatformOperator && nextScopeType !== 'tenant') {
      fail(ctx, '子系统仅允许设置子系统账号')
      return
    }
    if (!ADMIN_SCOPE_TYPES.has(nextScopeType)) {
      fail(ctx, 'scopeType 仅支持 tenant / platform')
      return
    }
    target.scopeType = nextScopeType
  }
  if (payload.tenantId !== undefined) {
    const nextTenantId = normalizeTenantId(payload.tenantId || 'default')
    if (!isPlatformOperator && nextTenantId !== operatorTenantId) {
      fail(ctx, '子系统仅允许设置当前子系统ID', 403)
      return
    }
    target.tenantId = nextTenantId
  }
  if (payload.scopeTenantIds !== undefined) {
    if (!Array.isArray(payload.scopeTenantIds)) {
      fail(ctx, 'scopeTenantIds 必须为数组')
      return
    }
    const nextScopeTenantIds = payload.scopeTenantIds
      .map(x => String(x || '').trim())
      .filter(Boolean)
      .map(x => (x === '*' ? '*' : normalizeTenantId(x)))
    if (!isPlatformOperator) {
      const onlyCurrent = nextScopeTenantIds.length === 0
        || (nextScopeTenantIds.length === 1 && nextScopeTenantIds[0] === operatorTenantId)
      if (!onlyCurrent) {
        fail(ctx, '子系统仅允许当前子系统范围', 403)
        return
      }
      target.scopeTenantIds = [operatorTenantId]
    }
    else {
      target.scopeTenantIds = nextScopeTenantIds
    }
  }
  if (payload.status !== undefined) {
    const nextStatus = String(payload.status || '').trim()
    if (!ADMIN_ACCOUNT_STATUS_SET.has(nextStatus)) {
      fail(ctx, '账号状态不正确')
      return
    }
    if (target.username === DEFAULT_SUPER_ADMIN_USERNAME && nextStatus !== 'active') {
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
  if (payload.phone !== undefined) {
    const nextPhone = normalizePhone(payload.phone)
    if (!/^1\d{10}$/.test(nextPhone)) {
      fail(ctx, '手机号格式不正确')
      return
    }
    const duplicatedPhone = db.adminAccounts.some(item => item.id !== target.id && normalizePhone(item.phone) === nextPhone)
    if (duplicatedPhone) {
      fail(ctx, '该子系统手机号已被后台账号占用', 409)
      return
    }
    target.phone = nextPhone
  }
  if (nextRolePreview === ADMIN_ROLES.BOSS) {
    const bossConflict = await findGlobalBossConflict({
      username: nextUsernamePreview,
      phone: nextPhonePreview,
      excludeAccountId: target.id,
    })
    if (bossConflict) {
      fail(ctx, bossConflict.type === 'username' ? '老板账号已存在，请更换账号' : '老板手机号已存在，请更换手机号', 409)
      return
    }
  }
  if (payload.name !== undefined) {
    target.name = String(payload.name || '').trim() || target.name
  }
  if (hasPermissionPayload) {
    target.permissions = normalizedPermissionPayload
  }
  target.updatedAt = new Date().toISOString()
  writeAdminAccountsDb(db)
  clearAdminAccountCaches()
  ctx.body = success(toAdminAccountView(target))
})

router.delete('/admin/accounts/:id', async (ctx) => {
  if (!await requireAdminPermissionOnAny(ctx, ['accounts', 'tenants.system'], 'delete', '删除后台账号')) {
    return
  }
  const db = readDb()
  ensureAdminAccounts(db)
  const { id } = ctx.params
  const currentAccount = await resolveAdminAccount(ctx)
  const isPlatformOperator = Boolean(currentAccount && currentAccount.scopeType === 'platform')
  const role = await resolveAdminRole(ctx)
  const canCrossTenantCleanup = isPlatformOperator || isSuperEquivalentRole(role)
  const target = db.adminAccounts.find(item => item.id === id)
  if (!target) {
    if (!canCrossTenantCleanup) {
      fail(ctx, '后台账号不存在', 404)
      return
    }
    // 平台兜底：历史脏数据可能落在其他子系统库，按已知子系统逐库删除同 ID 子系统账号
    const knownTenantIds = await collectKnownTenantIds()
    for (const tenantId of knownTenantIds) {
      const result = await deleteTenantScopedAdminAccountInTenantDbById(tenantId, id)
      if (!result || !result.found) {
        continue
      }
      if (result.blocked) {
        fail(ctx, result.reason === 'default-super' ? '默认超级管理员账号不可删除' : '子系统不可删除主系统账号', 403)
        return
      }
      ctx.body = success({ id, sourceTenantId: tenantId })
      return
    }
    fail(ctx, '后台账号不存在', 404)
    return
  }
  if (!isPlatformOperator && String(target.scopeType || 'tenant') === 'platform') {
    fail(ctx, '子系统不可删除主系统账号', 403)
    return
  }
  if (target.username === DEFAULT_SUPER_ADMIN_USERNAME) {
    fail(ctx, '默认超级管理员账号不可删除')
    return
  }
  db.adminAccounts = db.adminAccounts.filter(item => item.id !== id)
  writeAdminAccountsDb(db)
  clearAdminAccountCaches()
  ctx.body = success({ id })
})

router.get('/platform/tenants', async (ctx) => {
  const account = await requirePlatformSuperAdminScopeOnAny(ctx, ['tenants.system', 'tenants.mallUsersData'], 'view', '查看子系统列表')
  if (!account) {
    return
  }
  const known = await collectKnownTenantIdsForPlatform()
  const createdAtById = parseTenantCreatedAtMapFromMeta((await readCoreDb())._meta)
  const allow = effectiveScopeTenantIds(account)
  const visibleAll = allow.includes('*')
    ? known
    : known.filter(item => allow.includes(item))
  const visible = visibleAll.filter(item => item !== DEFAULT_TENANT_ID)
  const rows = []
  for (const tenantId of visible) {
    const db = await readDbByTenantId(tenantId)
    const createdAt = createdAtById[tenantId] || null
    rows.push({
      tenantId,
      tenantName: tenantId === DEFAULT_TENANT_ID ? '主系统' : tenantId,
      userCount: Array.isArray(db.users) ? db.users.length : 0,
      orderCount: Array.isArray(db.orders) ? db.orders.length : 0,
      productCount: Array.isArray(db.products) ? db.products.length : 0,
      createdAt,
    })
  }
  const list = rows.sort((a, b) => {
    const ta = new Date(String(a.createdAt || '')).getTime()
    const tb = new Date(String(b.createdAt || '')).getTime()
    const va = Number.isFinite(ta) ? ta : 0
    const vb = Number.isFinite(tb) ? tb : 0
    if (vb !== va) return vb - va
    return a.tenantId.localeCompare(b.tenantId)
  })
  await platformAuditRecord(ctx, 'platform.tenants.list', { visibleTenantCount: list.length })
  ctx.body = success(list)
})

/**
 * 平台：汇总各子系统商城注册用户（tenant 商城 users 集合）。
 * - 不传 tenantId：遍历当前账号可见的全部子系统，并按手机号合并去重；
 * - 传 tenantId：仅该子系统，不做跨系统合并。
 */
router.get('/platform/mall-users', async (ctx) => {
  const account = await requirePlatformSuperAdminScope(ctx, '查看子系统商城用户数据', { permissionKey: 'tenants.mallUsersData', permissionAction: 'view' })
  if (!account) {
    return
  }
  const rawTenantFilter = String(ctx.query?.tenantId || '').trim()
  const tenantFilter = rawTenantFilter ? normalizeTenantId(rawTenantFilter) : ''
  const keywordRaw = String(ctx.query?.keyword || '').trim()
  const keywordLower = keywordRaw.toLowerCase()
  const known = await collectKnownTenantIdsForPlatform()
  const allow = effectiveScopeTenantIds(account)
  const visibleAll = allow.includes('*')
    ? known
    : known.filter(item => allow.includes(item))
  let targetTenants = visibleAll.filter(item => item !== DEFAULT_TENANT_ID)
  if (tenantFilter) {
    if (!targetTenants.includes(tenantFilter)) {
      fail(ctx, '无权查看该子系统或未找到该子系统', 403)
      return
    }
    targetTenants = [tenantFilter]
  }
  const dedupeAcrossTenants = Boolean(!tenantFilter)

  /** @type {ReturnType<typeof attachUserOrderStats>[]} */
  const flattened = []
  for (const tenantId of targetTenants) {
    const db = await readDbByTenantId(tenantId)
    const usersRaw = Array.isArray(db.users) ? db.users : []
    const orderStatsIndex = buildMallUserOrderStatsIndex(db, { kpiCardPackageIssuedOnly: true })
    const tenantLabel = tenantId === DEFAULT_TENANT_ID ? '主系统' : tenantId
    for (const user of usersRaw) {
      if (!user || typeof user !== 'object') {
        continue
      }
      const row = attachUserOrderStats(db, user, {
        kpiCardPackageIssuedOnly: true,
        precomputedOrderStats: orderStatsIndex.get(String(user.id || '').trim()),
      })
      if (row.adminPasswordPlain) {
        delete row.adminPasswordPlain
      }
      const enriched = {
        ...row,
        sourceTenantId: tenantId,
        sourceTenantName: tenantLabel,
      }
      if (keywordLower) {
        const haystack = `${enriched.id || ''}|${enriched.name || ''}|${enriched.phone || ''}`
        if (!haystack.toLowerCase().includes(keywordLower)) {
          continue
        }
      }
      flattened.push(enriched)
    }
  }

  const sortedFlat = flattened.sort((a, b) => {
    const pa = normalizePhone(String(a.phone || ''))
    const pb = normalizePhone(String(b.phone || ''))
    if (pa !== pb) {
      return String(pa || a.id).localeCompare(String(pb || b.id))
    }
    return String(a.sourceTenantId || '').localeCompare(String(b.sourceTenantId || ''))
      || String(a.id).localeCompare(String(b.id))
  })

  /** @typedef {typeof sortedFlat[number]} FlatRow */

  /** @param {FlatRow[]} group */
  const mergeDedupGroup = (group) => {
    const pickCanonical = [...group].sort((a, b) => {
      const ra = Date.parse(String(a.registerAt || ''))
      const rb = Date.parse(String(b.registerAt || ''))
      const va = Number.isFinite(ra) ? ra : 0
      const vb = Number.isFinite(rb) ? rb : 0
      if (vb !== va) {
        return vb - va
      }
      const oa = Number(a.orderCount || 0)
      const ob = Number(b.orderCount || 0)
      if (ob !== oa) {
        return ob - oa
      }
      return String(a.sourceTenantId || '').localeCompare(String(b.sourceTenantId || ''))
    })
    const primary = pickCanonical[0]
    let orderSum = 0
    let amountSum = 0
    let lastMs = 0
    for (const g of group) {
      orderSum += Number(g.orderCount || 0)
      amountSum += Number(g.totalAmount || 0)
      if (g.lastOrderAt) {
        const ms = Date.parse(String(g.lastOrderAt))
        if (Number.isFinite(ms) && ms >= lastMs) {
          lastMs = ms
        }
      }
    }
    const tenantIdsSorted = [...new Set(group.map(r => String(r.sourceTenantId || '')))].filter(Boolean).sort()
    const merged = {
      ...primary,
      orderCount: orderSum,
      totalAmount: Number(amountSum.toFixed(2)),
      duplicateSystemCount: group.length,
      mergedTenantIds: tenantIdsSorted,
      mergedTenantLabel: tenantIdsSorted.join('、'),
    }
    if (lastMs > 0) {
      merged.lastOrderAt = new Date(lastMs).toISOString()
    }
    if (merged.adminPasswordPlain) {
      delete merged.adminPasswordPlain
    }
    return merged
  }

  let listOut
  if (dedupeAcrossTenants) {
    const byPhone = new Map()
    for (const row of sortedFlat) {
      const digits = normalizePhone(String(row.phone || ''))
      const key = digits.length >= 11 ? digits : `__nophone__:${row.sourceTenantId}:${row.id}`
      if (!byPhone.has(key)) {
        byPhone.set(key, [])
      }
      /** @type {FlatRow[]} */ (byPhone.get(key)).push(row)
    }
    listOut = []
    for (const group of byPhone.values()) {
      listOut.push(mergeDedupGroup(group))
    }
    listOut.sort((a, b) => Number(b.orderCount || 0) - Number(a.orderCount || 0)
      || String(a.phone || '').localeCompare(String(b.phone || '')))
  }
  else {
    listOut = sortedFlat.map((row) => ({
      ...row,
      duplicateSystemCount: 1,
      mergedTenantIds: [String(row.sourceTenantId || '').trim()].filter(Boolean),
      mergedTenantLabel: String(row.sourceTenantName || row.sourceTenantId || ''),
    }))
  }

  await platformAuditRecord(ctx, 'platform.mall-users.list', {
    tenantScope: tenantFilter || 'all',
    dedupe: dedupeAcrossTenants,
    rowCount: listOut.length,
    rawFlatCount: sortedFlat.length,
  })
  ctx.body = success(listOut)
})

router.post('/platform/tenants', async (ctx) => {
  const account = await requirePlatformSuperAdminScope(ctx, '新增子系统', { permissionKey: 'tenants.system', permissionAction: 'create' })
  if (!account) {
    return
  }
  const payload = ctx.request.body || {}
  const rawTenantId = String(payload.tenantId || '').trim()
  if (!rawTenantId) {
    fail(ctx, 'tenantId 不能为空')
    return
  }
  const lowered = rawTenantId.toLowerCase()
  if (lowered === 'default' || lowered === 'main' || lowered === 'platform' || rawTenantId === '主系统') {
    fail(ctx, 'tenantId 不可使用 default/main/platform/主系统')
    return
  }
  if (!/^boss\d+$/i.test(rawTenantId)) {
    fail(ctx, 'tenantId 仅支持 boss + 数字，例如 boss1、boss2')
    return
  }
  const tenantId = normalizeTenantId(rawTenantId)
  if (!tenantId || tenantId === DEFAULT_TENANT_ID) {
    fail(ctx, 'tenantId 不合法')
    return
  }
  const known = await collectKnownTenantIdsForPlatform()
  if (known.includes(tenantId)) {
    fail(ctx, '子系统ID已存在，请勿重复开通', 409)
    return
  }
  await registerKnownTenantId(tenantId)
  const dbAfterRegister = await readCoreDb()
  const createdAtById = parseTenantCreatedAtMapFromMeta(dbAfterRegister._meta)
  const createdAt = createdAtById[tenantId] || new Date().toISOString()
  await platformAuditRecord(ctx, 'platform.tenants.create', { tenantId, createdAt })
  ctx.body = success({
    tenantId,
    tenantName: tenantId,
    createdAt,
  })
})

router.post('/platform/tenants/onboard', async (ctx) => {
  const account = await requirePlatformSuperAdminScope(ctx, '一体化开通子系统', { permissionKey: 'tenants.system', permissionAction: 'create' })
  if (!account) {
    return
  }
  const payload = ctx.request.body || {}
  const rawTenantId = String(payload.tenantId || '').trim()
  const username = String(payload.username || '').trim()
  const password = String(payload.password || '').trim()
  const phone = normalizePhone(payload.phone)
  const role = ADMIN_ROLES.BOSS
  const name = String(payload.name || '').trim() || getRoleLabel(role)

  if (!rawTenantId) {
    fail(ctx, 'tenantId 不能为空')
    return
  }
  const lowered = rawTenantId.toLowerCase()
  if (lowered === 'default' || lowered === 'main' || lowered === 'platform' || rawTenantId === '主系统') {
    fail(ctx, 'tenantId 不可使用 default/main/platform/主系统')
    return
  }
  if (!/^boss\d+$/i.test(rawTenantId)) {
    fail(ctx, 'tenantId 仅支持 boss + 数字，例如 boss1、boss2')
    return
  }
  const tenantId = normalizeTenantId(rawTenantId)
  if (!tenantId || tenantId === DEFAULT_TENANT_ID) {
    fail(ctx, 'tenantId 不合法')
    return
  }
  if (!/^[a-zA-Z][a-zA-Z0-9_]{3,20}$/.test(username)) {
    fail(ctx, '账号格式不正确，需4-21位字母数字下划线且以字母开头')
    return
  }
  if (password.length < 4) {
    fail(ctx, '密码长度至少为4位')
    return
  }
  if (!/^1\d{10}$/.test(phone)) {
    fail(ctx, '手机号格式不正确')
    return
  }

  const known = await collectKnownTenantIdsForPlatform()
  if (known.includes(tenantId)) {
    fail(ctx, '子系统ID已存在，请勿重复开通', 409)
    return
  }
  const bossConflict = await findGlobalBossConflict({ username, phone })
  if (bossConflict) {
    fail(ctx, bossConflict.type === 'username' ? '老板账号已存在，请更换账号' : '老板手机号已存在，请更换手机号', 409)
    return
  }

  await registerKnownTenantId(tenantId)
  try {
    const created = await createTenantScopedAdminAccount(tenantId, {
      username,
      password,
      role,
      phone,
      name,
    })
    if (!created.ok) {
      fail(ctx, created.msg, created.code)
      await unregisterKnownTenantId(tenantId)
      return
    }
    const dbAfterRegister = await readCoreDb()
    const createdAtById = parseTenantCreatedAtMapFromMeta(dbAfterRegister._meta)
    const createdAt = createdAtById[tenantId] || new Date().toISOString()
    await platformAuditRecord(ctx, 'platform.tenants.onboard', { tenantId, createdAt, username })
    ctx.body = success({
      tenantId,
      tenantName: tenantId,
      createdAt,
      bossAccount: toAdminAccountView(created.account),
    })
  }
  catch (error) {
    await unregisterKnownTenantId(tenantId)
    fail(ctx, error instanceof Error ? error.message : '开通失败，已自动回滚', 500)
  }
})

router.get('/platform/dashboard/summary', async (ctx) => {
  const account = await requirePlatformScope(ctx, '查看总部汇总', { permissionKey: 'dashboard', permissionAction: 'view' })
  if (!account) {
    return
  }
  const known = await collectKnownTenantIdsForPlatform()
  const allow = effectiveScopeTenantIds(account)
  const visibleAll = allow.includes('*')
    ? known
    : known.filter(item => allow.includes(item))
  const visible = visibleAll.filter(item => item !== DEFAULT_TENANT_ID)
  let totalUsers = 0
  let totalOrders = 0
  let totalProducts = 0
  const tenants = []
  for (const tenantId of visible) {
    const db = await readDbByTenantId(tenantId)
    const userCount = Array.isArray(db.users) ? db.users.length : 0
    const orderCount = Array.isArray(db.orders) ? db.orders.length : 0
    const productCount = Array.isArray(db.products) ? db.products.length : 0
    totalUsers += userCount
    totalOrders += orderCount
    totalProducts += productCount
    tenants.push({
      tenantId,
      tenantName: tenantId === DEFAULT_TENANT_ID ? '主系统' : tenantId,
      userCount,
      orderCount,
      productCount,
    })
  }
  ctx.body = success({
    tenantCount: visible.length,
    totalUsers,
    totalOrders,
    totalProducts,
    tenants,
  })
  await platformAuditRecord(ctx, 'platform.dashboard.summary', {
    tenantCount: visible.length,
    totalUsers,
    totalOrders,
    totalProducts,
  })
})

router.get('/platform/audit-logs', async (ctx) => {
  const account = await requirePlatformScope(ctx, '查看平台审计日志', { permissionKey: 'tenants.system', permissionAction: 'view' })
  if (!account) {
    return
  }
  const limitRaw = Number(ctx.query?.limit || 100)
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, Math.floor(limitRaw))) : 100
  const db = await readCoreDb()
  const logs = db?._meta && Array.isArray(db._meta.platformAuditLogs)
    ? db._meta.platformAuditLogs.slice(0, limit)
    : []
  await platformAuditRecord(ctx, 'platform.audit.list', { limit, returned: logs.length })
  ctx.body = success(logs)
})

router.get('/platform/admin-accounts', async (ctx) => {
  const account = await requirePlatformScope(ctx, '查看全子系统后台账号', { permissionKey: 'tenants.system', permissionAction: 'view' })
  if (!account) {
    return
  }
  const tenantQuery = String(ctx.query?.tenantId || '').trim()
  const scopeTypeQuery = String(ctx.query?.scopeType || '').trim()
  if (scopeTypeQuery && !ADMIN_SCOPE_TYPES.has(scopeTypeQuery)) {
    fail(ctx, 'scopeType 仅支持 tenant / platform')
    return
  }
  const known = await collectKnownTenantIdsForPlatform()
  const allow = effectiveScopeTenantIds(account)
  const visible = allow.includes('*')
    ? known
    : known.filter(item => allow.includes(item))
  const targetTenants = tenantQuery
    ? visible.filter(item => item === normalizeTenantId(tenantQuery))
    : visible
  const list = []
  for (const tenantId of targetTenants) {
    const sourceAccounts = await resolveTenantAdminAccountsList(tenantId)
    sourceAccounts.forEach((item) => {
      if (scopeTypeQuery && String(item.scopeType || 'tenant') !== scopeTypeQuery) {
        return
      }
      list.push({
        ...toAdminAccountView(item),
        sourceTenantId: tenantId,
        sourceTenantName: tenantId === DEFAULT_TENANT_ID ? '主系统' : tenantId,
      })
    })
  }
  await platformAuditRecord(ctx, 'platform.admin-accounts.list', {
    tenantQuery: tenantQuery || 'all',
    tenantCount: targetTenants.length,
    accountCount: list.length,
  })
  ctx.body = success(list)
})

router.get('/platform/accounts', async (ctx) => {
  const account = await requirePlatformScope(ctx, '查看主系统账号', { permissionKey: 'accounts', permissionAction: 'view' })
  if (!account) {
    return
  }
  const list = await withAdminReadCacheAsync(ctx, 'platform-accounts-list', async () => {
    if (isAdminReadOptimizeEnabled() && isMongoPersistenceEnabled()) {
      let accounts = await readAdminAccountsFromMongoScoped('core', DEFAULT_TENANT_ID)
      if (Array.isArray(accounts)) {
        accounts = normalizeAdminAccountsListInTenantContext(DEFAULT_TENANT_ID, accounts)
        return buildPlatformAccountsListView(accounts)
      }
    }
    await migrateLegacyMainAccountsToCore()
    const db = await readCoreDb()
    ensureAdminAccounts(db)
    const hasLegacyPromoted = db.adminAccounts.some(
      item => normalizeTenantId(item.tenantId || DEFAULT_TENANT_ID) === DEFAULT_TENANT_ID
        && String(item.scopeType || 'tenant') === 'platform',
    )
    if (hasLegacyPromoted) {
      await writeCoreDb(db)
    }
    return buildPlatformAccountsListView(db.adminAccounts)
  })
  await platformAuditRecord(ctx, 'platform.accounts.list', { accountCount: list.length })
  ctx.body = success(list)
})

router.post('/platform/accounts', async (ctx) => {
  const current = await requirePlatformScope(ctx, '新增主系统账号', { permissionKey: 'accounts', permissionAction: 'create' })
  if (!current) {
    return
  }
  const payload = ctx.request.body || {}
  const username = String(payload.username || '').trim()
  const password = String(payload.password || '').trim()
  const role = normalizeAdminRole(payload.role)
  const phone = normalizePhone(payload.phone)
  const name = String(payload.name || '').trim() || getRoleLabel(role)
  const scopeTenantIds = Array.isArray(payload.scopeTenantIds)
    ? payload.scopeTenantIds.map(x => String(x || '').trim()).filter(Boolean).map(x => (x === '*' ? '*' : normalizeTenantId(x)))
    : []
  if (!/^[a-zA-Z][a-zA-Z0-9_]{3,20}$/.test(username)) {
    fail(ctx, '账号格式不正确，需4-21位字母数字下划线且以字母开头')
    return
  }
  if (password.length < 4) {
    fail(ctx, '密码长度至少为4位')
    return
  }
  if (![ADMIN_ROLES.REVIEWER, ADMIN_ROLES.COLLECTOR, ADMIN_ROLES.BOSS].includes(role)) {
    fail(ctx, '仅允许新增审核员、催收员或老板账号')
    return
  }
  if (role === ADMIN_ROLES.SUPER) {
    fail(ctx, '系统仅允许一个主系统管理员，不支持新增超级管理员账号', 403)
    return
  }
  if (!/^1\d{10}$/.test(phone)) {
    fail(ctx, '手机号格式不正确')
    return
  }
  if (payload.permissions !== undefined) {
    if (!canManageRolePermissions(normalizeAdminRole(current && current.role))
      || !hasAdminPermission(current, 'accounts', 'permission')) {
      fail(ctx, '当前账号无权限分配后台账号权限', 403)
      return
    }
    if (!canGrantAdminPermissions(current, payload.permissions)) {
      fail(ctx, '不能分配超过当前账号拥有范围的权限', 403)
      return
    }
  }
  const created = await createPlatformScopedAdminAccount({
    username,
    password,
    role,
    phone,
    name,
    scopeTenantIds,
    permissions: payload.permissions,
  })
  if (!created.ok) {
    fail(ctx, created.msg, created.code)
    return
  }
  await registerKnownTenantId(DEFAULT_TENANT_ID)
  await platformAuditRecord(ctx, 'platform.accounts.create', { username, role })
  ctx.body = success(toAdminAccountView(created.account))
})

router.patch('/platform/accounts/:id', async (ctx) => {
  const payload = ctx.request.body || {}
  if (!(await requirePlatformAccountPatchPermissions(ctx, payload, '修改主系统账号'))) {
    return
  }
  const { id } = ctx.params
  const db = await readCoreDb()
  ensureAdminAccounts(db)
  const target = db.adminAccounts.find(item => item.id === id && String(item.scopeType || 'tenant') === 'platform')
  if (!target) {
    fail(ctx, '主系统账号不存在', 404)
    return
  }
  const operator = await resolveAdminAccount(ctx)
  const hasPermissionPayload = payload.permissions !== undefined
  const normalizedPermissionPayload = hasPermissionPayload ? normalizeAdminPermissions(payload.permissions) : null
  if (hasPermissionPayload) {
    const operatorRole = normalizeAdminRole(operator && operator.role)
    if (!canManageRolePermissions(operatorRole) || !hasAdminPermission(operator, 'accounts', 'permission')) {
      fail(ctx, '仅系统管理员和老板可以编辑账号权限', 403)
      return
    }
    if (operator && operator.id === target.id) {
      fail(ctx, '不能修改当前登录账号自己的权限，避免误操作锁定账号', 403)
      return
    }
    if (operatorRole !== ADMIN_ROLES.SUPER && normalizeAdminRole(target.role) === ADMIN_ROLES.SUPER) {
      fail(ctx, '仅超级管理员可以修改超级管理员权限', 403)
      return
    }
    if (!canGrantAdminPermissions(operator, normalizedPermissionPayload)) {
      fail(ctx, '不能分配超过当前账号拥有范围的权限', 403)
      return
    }
  }
  if (target.username === DEFAULT_SUPER_ADMIN_USERNAME && payload.role && !isSuperEquivalentRole(normalizeAdminRole(payload.role))) {
    fail(ctx, '默认超级管理员账号角色不可修改')
    return
  }
  if (payload.role !== undefined) {
    const nextRole = normalizeAdminRole(payload.role)
    if (!nextRole) {
      fail(ctx, '角色不正确')
      return
    }
    if (nextRole === ADMIN_ROLES.SUPER && target.username !== DEFAULT_SUPER_ADMIN_USERNAME) {
      fail(ctx, '系统仅允许一个主系统管理员，不能将其他账号改为超级管理员', 403)
      return
    }
    target.role = nextRole
    if (!hasPermissionPayload) {
      target.permissions = resetAdminPermissionsForRole(nextRole)
    }
  }
  if (payload.scopeType !== undefined && String(payload.scopeType || '').trim() !== 'platform') {
    fail(ctx, '主系统账号 scopeType 仅支持 platform')
    return
  }
  if (payload.scopeTenantIds !== undefined) {
    if (!Array.isArray(payload.scopeTenantIds)) {
      fail(ctx, 'scopeTenantIds 必须为数组')
      return
    }
    target.scopeTenantIds = payload.scopeTenantIds
      .map(x => String(x || '').trim())
      .filter(Boolean)
      .map(x => (x === '*' ? '*' : normalizeTenantId(x)))
  }
  if (payload.status !== undefined) {
    const nextStatus = String(payload.status || '').trim()
    if (!ADMIN_ACCOUNT_STATUS_SET.has(nextStatus)) {
      fail(ctx, '账号状态不正确')
      return
    }
    if (target.username === DEFAULT_SUPER_ADMIN_USERNAME && nextStatus !== 'active') {
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
  if (hasPermissionPayload) {
    target.permissions = normalizedPermissionPayload
  }
  target.scopeType = 'platform'
  target.tenantId = DEFAULT_TENANT_ID
  target.updatedAt = new Date().toISOString()
  writeCoreDb(db)
  clearAdminAccountCaches()
  await platformAuditRecord(ctx, 'platform.accounts.update', { id: target.id, username: target.username })
  ctx.body = success(toAdminAccountView(target))
})

router.delete('/platform/accounts/:id', async (ctx) => {
  if (!(await requirePlatformScope(ctx, '删除主系统账号', { permissionKey: 'accounts', permissionAction: 'delete' }))) {
    return
  }
  const { id } = ctx.params
  const db = await readCoreDb()
  ensureAdminAccounts(db)
  const target = db.adminAccounts.find(item => item.id === id && String(item.scopeType || 'tenant') === 'platform')
  if (!target) {
    fail(ctx, '主系统账号不存在', 404)
    return
  }
  if (target.username === DEFAULT_SUPER_ADMIN_USERNAME) {
    fail(ctx, '默认超级管理员账号不可删除')
    return
  }
  db.adminAccounts = db.adminAccounts.filter(item => item.id !== id)
  writeCoreDb(db)
  clearAdminAccountCaches()
  await platformAuditRecord(ctx, 'platform.accounts.delete', { id, username: target.username })
  ctx.body = success({ id })
})

function normalizeTrafficChannelBody(body = {}) {
  const name = String(body.name != null ? body.name : '').trim()
  const remark = String(body.remark != null ? body.remark : '').trim()
  const disabled = normalizeBoolean(body.disabled, false)
  return { name, remark, disabled }
}

function toTrafficChannelView(ch, registerCount) {
  return {
    id: ch.id,
    code: ch.code,
    name: ch.name,
    remark: ch.remark || '',
    disabled: Boolean(ch.disabled),
    createdAt: ch.createdAt,
    updatedAt: ch.updatedAt,
    registerCount: Number(registerCount) || 0,
  }
}

/** 查找绑定了指定渠道标识的数据后台账号（admin-liuliang） */
function findTrafficPartnerForChannel(db, channelCode) {
  ensureTrafficPartners(db)
  const code = String(channelCode || '').trim()
  if (!code) {
    return null
  }
  return db.trafficPartners.find((p) => {
    if (!p || !Array.isArray(p.channelCodes)) {
      return false
    }
    return p.channelCodes.some(c => String(c || '').trim() === code)
  }) || null
}

/** 管理端列表/详情回显数据后台登录账号（明文密码，仅 super 管理接口使用） */
function attachPortalAccountToTrafficChannelView(db, view) {
  const partner = findTrafficPartnerForChannel(db, view.code)
  if (partner) {
    view.portalAccount = {
      partnerId: partner.id,
      username: partner.username,
      password: String(partner.password || ''),
    }
  }
  return view
}

/** 流量客户质量：与财务报表一致，仅计卡包已发放且非待审核的订单 */
function isTrafficQualityIssuedOrder(order) {
  return Boolean(order && order.status !== 'reviewing' && order.cardPackageIssued)
}

function trafficInstallmentOrderHasUnpaidOverdue(order, todayKey) {
  if (!order || order.payType !== 'installment') {
    return false
  }
  ensureOrderInstallmentPlan(order)
  const plan = Array.isArray(order.installmentPlan) ? order.installmentPlan : []
  for (const item of plan) {
    if (!item) {
      continue
    }
    const key = normalizeInstallmentDueDateKey(item.dueDate)
    if (!key || item.paid) {
      continue
    }
    if (key < todayKey) {
      return true
    }
  }
  return false
}

function buildTrafficChannelQualityRows(db) {
  ensureTrafficChannels(db)
  const todayKey = normalizeInstallmentDueDateKey(formatDate(new Date().toISOString()))
  const ordersByUserId = isAdminReadOptimizeEnabled() ? buildOrdersByMallUserIdIndex(db) : null
  const sorted = [...db.trafficChannels].sort((a, b) =>
    String(a.createdAt || '').localeCompare(String(b.createdAt || '')),
  )
  const out = []
  for (const ch of sorted) {
    if (!ch) {
      continue
    }
    const code = String(ch.code || '')
    const users = db.users.filter(
      u => u && String(u.registerChannelCode || '').trim() === code,
    )
    const registerCount = users.length
    let issuedOrderCount = 0
    let issuedOrderAmount = 0
    let installmentIssuedOrderCount = 0
    let fullPaymentIssuedOrderCount = 0
    let overdueInstallmentOrderCount = 0
    const orderCountByUserId = new Map()
    for (const u of users) {
      const allOrders = ordersForRegisteredMallUserIndexed(db, u, ordersByUserId)
      const issuedList = allOrders.filter(isTrafficQualityIssuedOrder)
      const uid = String(u.id || '')
      orderCountByUserId.set(uid, issuedList.length)
      const firstIssued = pickUserFirstOrder(issuedList)
      if (!firstIssued) {
        continue
      }
      issuedOrderCount += 1
      issuedOrderAmount += Number(firstIssued.totalAmount || 0)
      if (firstIssued.payType === 'installment') {
        installmentIssuedOrderCount += 1
        if (trafficInstallmentOrderHasUnpaidOverdue(firstIssued, todayKey)) {
          overdueInstallmentOrderCount += 1
        }
      }
      else if (firstIssued.payType === 'full') {
        fullPaymentIssuedOrderCount += 1
      }
    }
    issuedOrderAmount = Number(issuedOrderAmount.toFixed(2))
    let usersWithIssuedOrder = 0
    let repeatPurchaseUsers = 0
    for (const c of orderCountByUserId.values()) {
      if (c >= 1) {
        usersWithIssuedOrder += 1
      }
      if (c >= 2) {
        repeatPurchaseUsers += 1
      }
    }
    const registrationConversionRate = registerCount > 0
      ? Number(((usersWithIssuedOrder / registerCount) * 100).toFixed(2))
      : null
    const avgOrderAmount = issuedOrderCount > 0
      ? Number((issuedOrderAmount / issuedOrderCount).toFixed(2))
      : null
    const avgAmountPerRegistrant = registerCount > 0
      ? Number((issuedOrderAmount / registerCount).toFixed(2))
      : null
    const overdueRate = installmentIssuedOrderCount > 0
      ? Number(((overdueInstallmentOrderCount / installmentIssuedOrderCount) * 100).toFixed(2))
      : null
    const repeatPurchaseRate = usersWithIssuedOrder > 0
      ? Number(((repeatPurchaseUsers / usersWithIssuedOrder) * 100).toFixed(2))
      : null
    const installmentShareRate = issuedOrderCount > 0
      ? Number(((installmentIssuedOrderCount / issuedOrderCount) * 100).toFixed(2))
      : null
    out.push({
      id: ch.id,
      code,
      name: ch.name,
      disabled: Boolean(ch.disabled),
      registerCount,
      issuedOrderCount,
      issuedOrderAmount,
      usersWithIssuedOrder,
      registrationConversionRate,
      avgOrderAmount,
      avgAmountPerRegistrant,
      installmentIssuedOrderCount,
      fullPaymentIssuedOrderCount,
      installmentShareRate,
      overdueInstallmentOrderCount,
      overdueRate,
      repeatPurchaseUsers,
      repeatPurchaseRate,
    })
  }
  return out
}

router.get('/admin/traffic-channels', async (ctx) => {
  if (!await requireAdminTrafficChannelsRead(ctx)) {
    return
  }
  const list = withAdminReadCache(ctx, 'traffic-channels', () => {
    const db = readDb()
    return listAdminTrafficChannelsForPage(db)
  })
  ctx.body = success(list)
})

/** 流量管理页：一次请求返回渠道列表 + 引流统计（避免并行两次 GET 触发两次 Mongo refresh） */
router.get('/admin/traffic-channels/overview', async (ctx) => {
  if (!await requireAdminPermission(ctx, [ADMIN_ROLES.SUPER], '查看流量渠道', { permissionKey: 'traffic', permissionAction: 'view' })) {
    return
  }
  const payload = withAdminReadCache(ctx, 'traffic-overview', () => {
    const db = readDb()
    const todayKey = normalizeInstallmentDueDateKey(formatDate(new Date().toISOString()))
    return {
      channels: listAdminTrafficChannelsForPage(db),
      portalStats: buildTrafficChannelPortalStatsRows(db),
      oldCustomerSummary: buildOldCustomerTrafficSummary(db, todayKey),
    }
  })
  ctx.body = success(payload)
})

/** 卡包发放日（本地 YYYY-MM-DD）；无 cardPackageIssuedAt 时回退 createdAt */
function orderCardIssueDateKey(order) {
  ensureOrderCardPackage(order)
  if (!order.cardPackageIssued) {
    return ''
  }
  const raw = String(order.cardPackageIssuedAt || order.createdAt || '').trim()
  if (!raw) {
    return ''
  }
  return formatDate(raw)
}

/**
 * 指定日全平台放款汇总（按用户注册渠道归因；与财务报表一致仅计已发卡包且非待审核）。
 * 单次扫描 orders + users 索引，O(订单数)。
 */
function buildTrafficDailyDisbursementStats(db, dateKey) {
  ensureTrafficChannels(db)
  const channelByCode = new Map()
  for (const ch of db.trafficChannels || []) {
    if (!ch) {
      continue
    }
    const code = String(ch.code || '').trim()
    if (!code) {
      continue
    }
    channelByCode.set(code, {
      id: String(ch.id || ''),
      code,
      name: String(ch.name || code),
    })
  }

  const registerChannelByUserId = new Map()
  for (const u of db.users || []) {
    if (!u) {
      continue
    }
    const uid = String(u.id || '').trim()
    if (!uid) {
      continue
    }
    registerChannelByUserId.set(uid, String(u.registerChannelCode || '').trim())
  }

  const NONE_CODE = '__none__'
  const bucket = new Map()
  const ensureBucket = (code) => {
    let row = bucket.get(code)
    if (row) {
      return row
    }
    if (code === NONE_CODE) {
      row = {
        id: '',
        code: '',
        name: '商城注册',
        orderCount: 0,
        totalAmount: 0,
        principal: 0,
        profit: 0,
      }
    }
    else {
      const meta = channelByCode.get(code) || { id: '', code, name: code }
      row = {
        id: meta.id,
        code: meta.code,
        name: meta.name,
        orderCount: 0,
        totalAmount: 0,
        principal: 0,
        profit: 0,
      }
    }
    bucket.set(code, row)
    return row
  }

  let summaryOrderCount = 0
  let summaryTotalAmount = 0
  let summaryPrincipal = 0
  let summaryProfit = 0

  for (const order of db.orders || []) {
    if (!isTrafficQualityIssuedOrder(order)) {
      continue
    }
    if (orderCardIssueDateKey(order) !== dateKey) {
      continue
    }
    ensureOrderCardPackage(order)
    const amount = Number(order.totalAmount || 0)
    const principal = Math.max(0, Math.round(Number(order.cardPackageAmount) || 0))
    const profit = amount - principal

    const mid = String(order.mallUserId || '').trim()
    const channelCode = mid ? (registerChannelByUserId.get(mid) || '') : ''
    const aggKey = channelCode || NONE_CODE
    const row = ensureBucket(aggKey)
    row.orderCount += 1
    row.totalAmount += amount
    row.principal += principal
    row.profit += profit

    summaryOrderCount += 1
    summaryTotalAmount += amount
    summaryPrincipal += principal
    summaryProfit += profit
  }

  const roundMoney = n => Number(Number(n || 0).toFixed(2))
  const rows = [...bucket.values()]
    .map((row) => {
      const orderCount = row.orderCount
      return {
        id: row.id,
        code: row.code,
        name: row.name,
        orderCount,
        totalAmount: roundMoney(row.totalAmount),
        principal: roundMoney(row.principal),
        profit: roundMoney(row.profit),
        avgTicket: orderCount > 0 ? roundMoney(row.totalAmount / orderCount) : 0,
      }
    })
    .sort((a, b) => {
      if (b.orderCount !== a.orderCount) {
        return b.orderCount - a.orderCount
      }
      return String(a.name).localeCompare(String(b.name), 'zh-CN')
    })

  const summary = {
    orderCount: summaryOrderCount,
    totalAmount: roundMoney(summaryTotalAmount),
    principal: roundMoney(summaryPrincipal),
    profit: roundMoney(summaryProfit),
    avgTicket: summaryOrderCount > 0 ? roundMoney(summaryTotalAmount / summaryOrderCount) : 0,
  }

  return { date: dateKey, rows, summary }
}

router.get('/admin/traffic-channels/daily-disbursement', async (ctx) => {
  if (!await requireAdminPermission(ctx, [ADMIN_ROLES.SUPER], '查看流量渠道', { permissionKey: 'traffic', permissionAction: 'view' })) {
    return
  }
  const rawDate = String(ctx.query.date || '').trim()
  const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
    ? rawDate
    : formatDate(new Date().toISOString())
  const payload = withAdminReadCache(ctx, `traffic-daily-disbursement:${dateKey}`, () => {
    const db = readDb()
    return buildTrafficDailyDisbursementStats(db, dateKey)
  })
  ctx.body = success(payload)
})

router.get('/admin/traffic-channels/quality', async (ctx) => {
  if (!await requireAdminPermission(ctx, [ADMIN_ROLES.SUPER], '查看流量渠道', { permissionKey: 'traffic', permissionAction: 'view' })) {
    return
  }
  const rows = withAdminReadCache(ctx, 'traffic-quality', () => {
    const db = readDb()
    return buildTrafficChannelQualityRows(db)
  })
  ctx.body = success(rows)
})

router.get('/admin/traffic-channels/portal-stats', async (ctx) => {
  if (!await requireAdminPermission(ctx, [ADMIN_ROLES.SUPER], '查看流量渠道', { permissionKey: 'traffic', permissionAction: 'view' })) {
    return
  }
  const rows = withAdminReadCache(ctx, 'traffic-portal-stats', () => {
    const db = readDb()
    return buildTrafficChannelPortalStatsRows(db)
  })
  ctx.body = success(rows)
})

/**
 * 新建渠道时绑定流量商数据后台（admin-liuliang）登录账号。
 * 同 username 已存在则追加 channelCodes，并更新密码。
 */
function bindTrafficPartnerPortalAccount(db, opts) {
  const username = String(opts.username || '').trim()
  const password = String(opts.password || '').trim()
  const name = String(opts.name || username).trim()
  const code = String(opts.code || '').trim()
  const now = opts.now || new Date().toISOString()
  if (!username || !password || !code) {
    return { ok: false, reason: '请填写数据后台登录账号与密码' }
  }
  ensureTrafficPartners(db)
  const existing = db.trafficPartners.find(p => p && String(p.username) === username)
  if (existing) {
    const codes = Array.isArray(existing.channelCodes) ? [...existing.channelCodes] : []
    if (!codes.includes(code)) {
      codes.push(code)
    }
    existing.channelCodes = codes
    existing.password = password
    if (name) {
      existing.name = name
    }
    existing.status = 'active'
    existing.updatedAt = now
    return { ok: true, partner: existing, merged: true }
  }
  const row = {
    id: `TP${Date.now()}`,
    username,
    password,
    name: name || username,
    status: 'active',
    channelCodes: [code],
    createdAt: now,
    updatedAt: now,
  }
  db.trafficPartners.push(row)
  return { ok: true, partner: row, merged: false }
}

/** 删除流量渠道时，同步解除/删除数据后台登录账号（trafficPartners） */
function removeTrafficPartnerBindingsForChannel(db, code, now = new Date().toISOString()) {
  ensureTrafficPartners(db)
  const channelCode = String(code || '').trim()
  if (!channelCode) {
    return { removedPartnerIds: [] }
  }
  const removedPartnerIds = []
  for (let i = db.trafficPartners.length - 1; i >= 0; i--) {
    const p = db.trafficPartners[i]
    if (!p || !Array.isArray(p.channelCodes)) {
      continue
    }
    const codes = p.channelCodes.map(c => String(c || '').trim()).filter(Boolean)
    if (!codes.includes(channelCode)) {
      continue
    }
    const nextCodes = codes.filter(c => c !== channelCode)
    if (nextCodes.length === 0) {
      removedPartnerIds.push(String(p.id))
      db.trafficPartners.splice(i, 1)
    } else {
      p.channelCodes = nextCodes
      p.updatedAt = now
    }
  }
  return { removedPartnerIds }
}

function trafficPartnerHasActiveChannel(db, partner) {
  ensureTrafficChannels(db)
  const codes = Array.isArray(partner.channelCodes) ? partner.channelCodes : []
  return codes.some((code) => {
    const key = String(code || '').trim()
    if (!key) {
      return false
    }
    const ch = db.trafficChannels.find(c => c && String(c.code) === key)
    return Boolean(ch && !ch.disabled)
  })
}

router.post('/admin/traffic-channels', async (ctx) => {
  if (!await requireAdminPermission(ctx, [ADMIN_ROLES.SUPER], '新增流量渠道', { permissionKey: 'traffic', permissionAction: 'create' })) {
    return
  }
  const db = readDb()
  ensureTrafficChannels(db)
  const payload = ctx.request.body || {}
  const code = String(payload.code || '').trim()
  const norm = normalizeTrafficChannelBody(payload)
  const createPortalAccount = payload.createPortalAccount !== false
  if (createPortalAccount && !await requireTrafficActions(ctx, ['bindPortalAccount'], '绑定数据后台账号')) {
    return
  }
  if (!TRAFFIC_CHANNEL_CODE_RE.test(code)) {
    fail(ctx, '渠道标识须为 2～40 位字母、数字、下划线或中划线')
    return
  }
  if (!norm.name) {
    fail(ctx, '请填写渠道名称')
    return
  }
  if (db.trafficChannels.some(c => String(c.code) === code)) {
    fail(ctx, '该渠道标识已存在', 409)
    return
  }
  const portalUsername = String(
    payload.portalUsername != null ? payload.portalUsername : '',
  ).trim()
  const portalPassword = String(
    payload.portalPassword != null ? payload.portalPassword : '',
  ).trim()
  if (createPortalAccount) {
    if (!portalUsername) {
      fail(ctx, '请填写数据后台登录账号')
      return
    }
    if (portalPassword.length < 6) {
      fail(ctx, '数据后台登录密码至少 6 位')
      return
    }
  }
  const now = new Date().toISOString()
  const row = {
    id: `TC${Date.now()}`,
    code,
    name: norm.name,
    remark: norm.remark,
    disabled: norm.disabled,
    createdAt: now,
    updatedAt: now,
  }
  db.trafficChannels.push(row)
  let portalBind = null
  if (createPortalAccount) {
    portalBind = bindTrafficPartnerPortalAccount(db, {
      username: portalUsername,
      password: portalPassword,
      name: norm.name,
      code,
      now,
    })
    if (!portalBind.ok) {
      fail(ctx, portalBind.reason || '创建数据后台账号失败')
      return
    }
  }
  writeTrafficChannelsAndPartnersDb(db)
  const view = toTrafficChannelView(row, 0)
  if (portalBind && portalBind.partner) {
    view.portalAccount = {
      username: portalBind.partner.username,
      merged: Boolean(portalBind.merged),
    }
  }
  ctx.body = success(view)
})

router.patch('/admin/traffic-channels/:id', async (ctx) => {
  const body = ctx.request.body || {}
  if (!await requireTrafficActions(ctx, trafficChannelPatchPermissionActions(body), '编辑流量渠道')) {
    return
  }
  const db = readDb()
  ensureTrafficChannels(db)
  const { id } = ctx.params
  const idx = db.trafficChannels.findIndex(c => c.id === id)
  if (idx < 0) {
    fail(ctx, '渠道不存在', 404)
    return
  }
  const norm = normalizeTrafficChannelBody({ ...db.trafficChannels[idx], ...body })
  if (body.name != null && !norm.name) {
    fail(ctx, '请填写渠道名称')
    return
  }
  const now = new Date().toISOString()
  const prev = db.trafficChannels[idx]
  const merged = {
    ...prev,
    name: body.name != null ? norm.name : prev.name,
    remark: body.remark != null ? norm.remark : (prev.remark || ''),
    disabled: body.disabled != null ? norm.disabled : Boolean(prev.disabled),
    updatedAt: now,
  }
  db.trafficChannels[idx] = merged
  const portalUsername = body.portalUsername != null
    ? String(body.portalUsername).trim()
    : null
  const portalPassword = body.portalPassword != null
    ? String(body.portalPassword).trim()
    : null
  if (portalUsername != null || portalPassword != null) {
    if (portalUsername != null && !portalUsername) {
      fail(ctx, '请填写数据后台登录账号')
      return
    }
    if (portalPassword != null && portalPassword.length > 0 && portalPassword.length < 6) {
      fail(ctx, '数据后台登录密码至少 6 位')
      return
    }
    ensureTrafficPartners(db)
    const partner = findTrafficPartnerForChannel(db, merged.code)
    if (partner) {
      const nextUsername = portalUsername != null ? portalUsername : partner.username
      const nextPassword = portalPassword != null && portalPassword
        ? portalPassword
        : partner.password
      const usernameChanged = portalUsername != null
        && nextUsername !== String(partner.username || '')
      const passwordChanged = portalPassword != null && portalPassword
        && nextPassword !== String(partner.password || '')
      if (usernameChanged || passwordChanged) {
        if (
          usernameChanged
          && db.trafficPartners.some(p => p.id !== partner.id && String(p.username) === nextUsername)
        ) {
          fail(ctx, '该账号已存在', 409)
          return
        }
        if (!nextPassword || String(nextPassword).length < 6) {
          fail(ctx, '数据后台登录密码至少 6 位')
          return
        }
        if (usernameChanged) {
          partner.username = nextUsername
        }
        if (passwordChanged) {
          partner.password = String(nextPassword)
        }
        partner.updatedAt = now
      }
    }
    else if (portalUsername != null) {
      const bindPassword = portalPassword != null && portalPassword
        ? portalPassword
        : ''
      if (bindPassword.length < 6) {
        fail(ctx, '请填写数据后台登录密码（至少 6 位）')
        return
      }
      const portalBind = bindTrafficPartnerPortalAccount(db, {
        username: portalUsername,
        password: bindPassword,
        name: merged.name,
        code: merged.code,
        now,
      })
      if (!portalBind.ok) {
        fail(ctx, portalBind.reason || '绑定数据后台账号失败')
        return
      }
    }
  }
  writeTrafficChannelsAndPartnersDb(db)
  const reg = db.users.filter(u => u.registerChannelCode === merged.code).length
  const view = attachPortalAccountToTrafficChannelView(
    db,
    toTrafficChannelView(merged, reg),
  )
  ctx.body = success(view)
})

router.delete('/admin/traffic-channels/:id', async (ctx) => {
  if (!await requireAdminPermission(ctx, [ADMIN_ROLES.SUPER], '删除流量渠道', { permissionKey: 'traffic', permissionAction: 'delete' })) {
    return
  }
  const db = readDb()
  ensureTrafficChannels(db)
  const { id } = ctx.params
  const idx = db.trafficChannels.findIndex(c => c.id === id)
  if (idx < 0) {
    fail(ctx, '渠道不存在', 404)
    return
  }
  const ch = db.trafficChannels[idx]
  const reg = db.users.filter(u => u.registerChannelCode === ch.code).length
  if (reg > 0) {
    fail(ctx, '该渠道已有用户注册记录，无法删除', 400)
    return
  }
  const now = new Date().toISOString()
  const channelCode = String(ch.code || '').trim()
  db.trafficChannels.splice(idx, 1)
  const portalCleanup = removeTrafficPartnerBindingsForChannel(db, channelCode, now)
  writeTrafficChannelsAndPartnersDb(db)
  ctx.body = success({
    id,
    removedPortalAccountCount: portalCleanup.removedPartnerIds.length,
  })
})

function ensureTrafficPartners(db) {
  if (!Array.isArray(db.trafficPartners)) {
    db.trafficPartners = []
  }
}

function normalizeTrafficPartnerBody(body = {}) {
  const username = String(body.username != null ? body.username : '').trim()
  const password = String(body.password != null ? body.password : '').trim()
  const name = String(body.name != null ? body.name : '').trim()
  const status = String(body.status != null ? body.status : 'active').trim() || 'active'
  const channelCodes = Array.isArray(body.channelCodes)
    ? body.channelCodes.map(c => String(c || '').trim()).filter(c => TRAFFIC_CHANNEL_CODE_RE.test(c))
    : []
  return { username, password, name, status, channelCodes }
}

function toTrafficPartnerView(partner) {
  return {
    id: partner.id,
    username: partner.username,
    name: partner.name || partner.username,
    status: partner.status || 'active',
    channelCodes: Array.isArray(partner.channelCodes) ? [...partner.channelCodes] : [],
    createdAt: partner.createdAt,
    updatedAt: partner.updatedAt,
  }
}

function resolveTrafficPartnerFromAuthHeader(ctx) {
  const auth = String(ctx.headers.authorization || '').trim()
  const m = /^Bearer\s+traffic-partner-token-(.+)$/i.exec(auth)
  if (!m) {
    return null
  }
  const db = readDb()
  ensureTrafficPartners(db)
  const partner = db.trafficPartners.find(p => p && String(p.id) === m[1])
  if (!partner || String(partner.status || 'active') !== 'active') {
    return null
  }
  ensureTrafficChannels(db)
  if (!trafficPartnerHasActiveChannel(db, partner)) {
    return null
  }
  return partner
}

/** 流量商门户：渠道注册用户仅计首单；逾期率按该渠道首单集合截至昨日的每日未还率动态日均计算 */
function buildTrafficPartnerPortalStatsRow(db, ch, todayKey, ordersByUserId = null) {
  const code = String(ch.code || '')
  const clickCount = Math.max(0, Number(ch.clickCount) || 0)
  const endDate = adminDashboardYmdPlusDays(todayKey, -1)
  const users = db.users.filter(
    u => u && String(u.registerChannelCode || '').trim() === code,
  )
  const registerCount = users.length
  let applicationCount = 0
  let approvedCount = 0
  let overdueCount = 0
  const approvedOrders = []
  for (const u of users) {
    const orders = ordersForRegisteredMallUserIndexed(db, u, ordersByUserId)
    const firstOrder = pickUserFirstOrder(orders)
    if (!firstOrder) {
      continue
    }
    applicationCount += 1
    if (!isTrafficQualityIssuedOrder(firstOrder)) {
      continue
    }
    approvedCount += 1
    approvedOrders.push(firstOrder)
    if (
      firstOrder.payType === 'installment'
      && trafficInstallmentOrderHasUnpaidOverdue(firstOrder, todayKey)
    ) {
      overdueCount += 1
    }
  }
  const pct = (num, den) => (den > 0 ? Number(((num / den) * 100).toFixed(2)) : null)
  const dynamicOverdue = computeDynamicUnpaidRateThroughDate(approvedOrders, endDate)
  return {
    id: ch.id,
    code,
    name: String(ch.name || code),
    clickCount,
    registerCount,
    applicationCount,
    approvedCount,
    overdueCount,
    registerRate: pct(registerCount, clickCount),
    applicationRate: pct(applicationCount, registerCount),
    approvalRate: pct(approvedCount, applicationCount),
    overdueRate: approvedCount > 0 ? dynamicOverdue.dynamicUnpaidRate : null,
    registrationConversionRate: pct(approvedCount, registerCount),
    applicationConversionRate: pct(approvedCount, applicationCount),
  }
}

/**
 * 全平台老客户复购汇总（与渠道引流首单分开）。
 * 老客户口径与订单管理「新老客户」一致：下单时上一笔订单已发卡包且已全部还清。
 */
function buildOldCustomerTrafficSummary(db, todayKey) {
  const userOrdersCache = new Map()
  const repeatUserIds = new Set()
  let orderCount = 0
  let approvedCount = 0
  let overdueCount = 0
  let approvedAmount = 0
  for (const order of db.orders || []) {
    if (!order || !isOldCustomerAtOrder(db, order, userOrdersCache)) {
      continue
    }
    orderCount += 1
    const buyer = resolveMallBuyerFromOrder(db, order)
    if (buyer) {
      repeatUserIds.add(String(buyer.id || '').trim())
    }
    if (!isTrafficQualityIssuedOrder(order)) {
      continue
    }
    approvedCount += 1
    approvedAmount += Number(order.totalAmount || 0)
    if (
      order.payType === 'installment'
      && trafficInstallmentOrderHasUnpaidOverdue(order, todayKey)
    ) {
      overdueCount += 1
    }
  }
  const pct = (num, den) => (den > 0 ? Number(((num / den) * 100).toFixed(2)) : null)
  const userCount = repeatUserIds.size
  return {
    userCount,
    orderCount,
    approvedCount,
    overdueCount,
    approvedAmount: Number(approvedAmount.toFixed(2)),
    approvalRate: pct(approvedCount, orderCount),
    overdueRate: pct(overdueCount, approvedCount),
  }
}

/** 全部渠道引流统计（与 admin-liuliang / traffic-partner/stats 同口径） */
function buildTrafficChannelPortalStatsRows(db) {
  ensureTrafficChannels(db)
  const todayKey = normalizeInstallmentDueDateKey(formatDate(new Date().toISOString()))
  const ordersByUserId = isAdminReadOptimizeEnabled() ? buildOrdersByMallUserIdIndex(db) : null
  return [...db.trafficChannels]
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
    .map(ch => buildTrafficPartnerPortalStatsRow(db, ch, todayKey, ordersByUserId))
}

function listAdminTrafficChannelsForPage(db) {
  ensureTrafficChannels(db)
  const counts = buildRegisterChannelUserCounts(db)
  return db.trafficChannels
    .map((ch) => {
      const view = toTrafficChannelView(ch, counts.get(String(ch.code)) || 0)
      return attachPortalAccountToTrafficChannelView(db, view)
    })
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
}

/**
 * 流量商门户统计：与管理端 GET /admin/traffic-channels/overview 的 portalStats 同函数、同索引；
 * 仅过滤该账号绑定且未停用的渠道。
 */
function buildTrafficPartnerPortalStats(db, partner) {
  ensureTrafficChannels(db)
  const codes = new Set(
    (Array.isArray(partner.channelCodes) ? partner.channelCodes : [])
      .map(c => String(c || '').trim())
      .filter(Boolean),
  )
  return buildTrafficChannelPortalStatsRows(db)
    .filter((row) => {
      const code = String(row.code || '').trim()
      if (!codes.has(code)) {
        return false
      }
      const ch = db.trafficChannels.find(c => c && String(c.code || '').trim() === code)
      return Boolean(ch && !ch.disabled)
    })
    .map(row => ({
      ...row,
      approvedRows: buildTrafficPartnerApprovedRowsForChannel(db, row.code),
    }))
}

function incrementTrafficChannelClick(db, code) {
  ensureTrafficChannels(db)
  const ch = db.trafficChannels.find(
    c => c && String(c.code) === code && !c.disabled,
  )
  if (!ch) {
    return false
  }
  ch.clickCount = Math.max(0, Number(ch.clickCount) || 0) + 1
  ch.updatedAt = new Date().toISOString()
  return true
}

router.post('/traffic/channel-click', async (ctx) => {
  const code = String((ctx.request.body || {}).channel || '').trim()
  if (!TRAFFIC_CHANNEL_CODE_RE.test(code)) {
    fail(ctx, '渠道标识无效')
    return
  }
  const db = readDb()
  if (!incrementTrafficChannelClick(db, code)) {
    fail(ctx, '渠道不存在或已停用', 404)
    return
  }
  writeTrafficChannelsDb(db)
  ctx.body = success({ channel: code })
})

router.post('/traffic-partner/login', async (ctx) => {
  const db = readDb()
  ensureTrafficPartners(db)
  const payload = ctx.request.body || {}
  const username = String(payload.username || '').trim()
  const password = String(payload.password || '').trim()
  if (!username || !password) {
    fail(ctx, '请输入账号和密码')
    return
  }
  const partner = db.trafficPartners.find(
    p => p
      && String(p.username) === username
      && String(p.password) === password
      && String(p.status || 'active') === 'active',
  )
  if (!partner) {
    fail(ctx, '账号或密码错误', 401)
    return
  }
  ensureTrafficChannels(db)
  if (!trafficPartnerHasActiveChannel(db, partner)) {
    fail(ctx, '账号已失效，请联系管理员', 401)
    return
  }
  ctx.body = success({
    token: `traffic-partner-token-${partner.id}`,
    username: partner.username,
    name: String(partner.name || partner.username).trim(),
    partnerId: partner.id,
  })
})

router.get('/traffic-partner/stats', async (ctx) => {
  const partner = resolveTrafficPartnerFromAuthHeader(ctx)
  if (!partner) {
    fail(ctx, '未登录或登录已失效', 401)
    return
  }
  const db = readDb()
  ctx.body = success(buildTrafficPartnerPortalStats(db, partner))
})

router.get('/admin/traffic-partners', async (ctx) => {
  if (!await requireAdminPermission(ctx, [ADMIN_ROLES.SUPER], '查看流量商账号', { permissionKey: 'traffic', permissionAction: 'view' })) {
    return
  }
  const db = readDb()
  ensureTrafficPartners(db)
  const list = [...db.trafficPartners]
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
    .map(toTrafficPartnerView)
  ctx.body = success(list)
})

router.post('/admin/traffic-partners', async (ctx) => {
  if (!await requireAdminPermission(ctx, [ADMIN_ROLES.SUPER], '新增流量商账号', { permissionKey: 'traffic', permissionAction: 'create' })) {
    return
  }
  const db = readDb()
  ensureTrafficPartners(db)
  ensureTrafficChannels(db)
  const norm = normalizeTrafficPartnerBody(ctx.request.body || {})
  if (!norm.username || !norm.password) {
    fail(ctx, '请填写账号与密码')
    return
  }
  if (!norm.name) {
    fail(ctx, '请填写流量商名称')
    return
  }
  if (norm.channelCodes.length === 0) {
    fail(ctx, '请至少绑定一个渠道标识')
    return
  }
  if (db.trafficPartners.some(p => String(p.username) === norm.username)) {
    fail(ctx, '该账号已存在', 409)
    return
  }
  for (const code of norm.channelCodes) {
    if (!db.trafficChannels.some(c => c && String(c.code) === code)) {
      fail(ctx, `渠道 ${code} 不存在，请先在流量管理中创建`)
      return
    }
  }
  const now = new Date().toISOString()
  const row = {
    id: `TP${Date.now()}`,
    username: norm.username,
    password: norm.password,
    name: norm.name,
    status: norm.status === 'disabled' ? 'disabled' : 'active',
    channelCodes: norm.channelCodes,
    createdAt: now,
    updatedAt: now,
  }
  db.trafficPartners.push(row)
  writeTrafficPartnersDb(db)
  ctx.body = success(toTrafficPartnerView(row))
})

router.patch('/admin/traffic-partners/:id', async (ctx) => {
  const body = ctx.request.body || {}
  if (!await requireTrafficActions(ctx, trafficPartnerPatchPermissionActions(body), '编辑流量商账号')) {
    return
  }
  const db = readDb()
  ensureTrafficPartners(db)
  ensureTrafficChannels(db)
  const { id } = ctx.params
  const idx = db.trafficPartners.findIndex(p => p.id === id)
  if (idx < 0) {
    fail(ctx, '流量商账号不存在', 404)
    return
  }
  const norm = normalizeTrafficPartnerBody({ ...db.trafficPartners[idx], ...body })
  if (body.username != null && !norm.username) {
    fail(ctx, '账号不能为空')
    return
  }
  if (body.name != null && !norm.name) {
    fail(ctx, '名称不能为空')
    return
  }
  if (body.channelCodes != null && norm.channelCodes.length === 0) {
    fail(ctx, '请至少绑定一个渠道标识')
    return
  }
  const prev = db.trafficPartners[idx]
  if (
    body.username != null
    && norm.username !== prev.username
    && db.trafficPartners.some(p => p.id !== id && String(p.username) === norm.username)
  ) {
    fail(ctx, '该账号已存在', 409)
    return
  }
  const codes = body.channelCodes != null ? norm.channelCodes : (prev.channelCodes || [])
  for (const code of codes) {
    if (!db.trafficChannels.some(c => c && String(c.code) === code)) {
      fail(ctx, `渠道 ${code} 不存在`)
      return
    }
  }
  const now = new Date().toISOString()
  const merged = {
    ...prev,
    username: body.username != null ? norm.username : prev.username,
    password: body.password != null && norm.password ? norm.password : prev.password,
    name: body.name != null ? norm.name : prev.name,
    status: body.status != null
      ? (norm.status === 'disabled' ? 'disabled' : 'active')
      : (prev.status || 'active'),
    channelCodes: body.channelCodes != null ? norm.channelCodes : (prev.channelCodes || []),
    updatedAt: now,
  }
  db.trafficPartners[idx] = merged
  writeTrafficPartnersDb(db)
  ctx.body = success(toTrafficPartnerView(merged))
})

function userRegisterChannelDisplayKey(row) {
  const label = String(row && row.registerChannelLabel || '').trim()
  if (label) return label
  const name = String(row && row.registerChannelName || '').trim()
  if (name) return name
  return String(row && row.registerChannelCode || '').trim()
}

function localYmdFromIso(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) {
    return ''
  }
  const y = d.getFullYear()
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${y}-${m}-${day}`
}

function parseExportOrderDateYmd(raw) {
  const value = String(raw || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return ''
  }
  const parts = value.split('-').map(Number)
  const y = parts[0]
  const m = parts[1]
  const d = parts[2]
  const dt = new Date(y, m - 1, d)
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) {
    return ''
  }
  return value
}

function normalizeExportOrderDateRange(orderDateFrom, orderDateTo) {
  let from = parseExportOrderDateYmd(orderDateFrom)
  let to = parseExportOrderDateYmd(orderDateTo)
  if (from && to && from > to) {
    const swap = from
    from = to
    to = swap
  }
  return { from, to }
}

function exportYmdCompact(ymd) {
  return String(ymd || '').replace(/-/g, '')
}

/** 已通过客户导出文件名：已通过客户_日期或区间_渠道.csv */
function buildCardPackageIssuedExportFilename(orderDateFrom, orderDateTo, channelSafeName) {
  const { from, to } = normalizeExportOrderDateRange(orderDateFrom, orderDateTo)
  let datePart = exportFilenameDateYmd()
  if (from && to) {
    const fromCompact = exportYmdCompact(from)
    const toCompact = exportYmdCompact(to)
    datePart = fromCompact === toCompact ? fromCompact : `${fromCompact}-${toCompact}`
  }
  else if (from) {
    datePart = `${exportYmdCompact(from)}起`
  }
  else if (to) {
    datePart = `${exportYmdCompact(to)}止`
  }
  return `已通过客户_${datePart}_${channelSafeName}.csv`
}

function matchesAdminUserOrderDateFilter(lastOrderAt, query) {
  const { from, to } = normalizeExportOrderDateRange(query.orderDateFrom, query.orderDateTo)
  const orderDate = String(query.orderDate || '').trim()
  const hasRange = Boolean(from || to)
  const hasSingle = Boolean(orderDate)
  if (!hasRange && !hasSingle) {
    return true
  }
  const ymd = lastOrderAt ? localYmdFromIso(lastOrderAt) : ''
  if (!ymd) {
    return false
  }
  if (hasRange) {
    if (from && ymd < from) {
      return false
    }
    if (to && ymd > to) {
      return false
    }
    return true
  }
  return ymd === orderDate
}

router.get('/users/export', async (ctx) => {
  const view = normalizeAdminUsersListView(ctx.query.view || 'registered')
  const permissionKey = adminUsersPermissionKeyForView(view)
  const actionLabel = view === 'card-package-issued' ? '导出已发放卡包客户数据' : '导出注册用户数据'
  if (!await requireAdminPermission(ctx, [ADMIN_ROLES.SUPER, ADMIN_ROLES.BOSS], actionLabel, { permissionKey, permissionAction: 'export' })) {
    return
  }
  const registerChannel = String(ctx.query.registerChannel || '').trim() || '__all__'
  const fields = String(ctx.query.fields || '').trim()
  const maskPhone = ctx.query.maskPhone
  const orderDateFrom = String(ctx.query.orderDateFrom || '').trim()
  const orderDateTo = String(ctx.query.orderDateTo || '').trim()
  const db = readDb()
  const csv = buildRegisteredUsersExportCsv(db, {
    registerChannel,
    fields,
    view,
    maskPhone,
    orderDateFrom,
    orderDateTo,
  })
  const channelLabel = registerChannel === '__none__'
    ? '商城注册'
    : registerChannel === '__all__'
      ? '全部'
      : registerChannel
  const safeName = channelLabel.replace(/[\\/:*?"<>|]/g, '_')
  const filename = view === 'card-package-issued'
    ? buildCardPackageIssuedExportFilename(orderDateFrom, orderDateTo, safeName)
    : `注册用户_${safeName}_${exportFilenameDateStamp()}.csv`
  ctx.set('Content-Type', 'text/csv; charset=utf-8')
  ctx.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
  ctx.body = `\uFEFF${csv}`
})

router.get('/users', async (ctx) => {
  if (!await requireAdminUsersListView(ctx, '查看用户列表')) {
    return
  }
  const db = readDb()
  const key = String(ctx.query.keyword || '').trim()
  const viewRaw = String(ctx.query.view || 'registered').trim()
  const view = viewRaw === 'ordering'
    ? 'ordering'
    : viewRaw === 'no-order'
      ? 'no-order'
      : viewRaw === 'card-package-issued'
        ? 'card-package-issued'
        : 'registered'
  const registerChannel = String(ctx.query.registerChannel || '').trim()
  const orderDate = String(ctx.query.orderDate || '').trim()
  const page = Math.max(1, parseInt(String(ctx.query.page || '1'), 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(String(ctx.query.pageSize || '20'), 10) || 20))

  if (isAdminReadOptimizeEnabled()) {
    if (isMongoPersistenceEnabled()) {
      const tenantId = normalizeTenantId(ctx.state && ctx.state.tenantId ? ctx.state.tenantId : DEFAULT_TENANT_ID)
      const workspaceType = normalizeWorkspaceType(ctx.state && ctx.state.workspaceType ? ctx.state.workspaceType : 'tenant')
      const mongoPage = await adminMongoReadOptimize.readAdminUsersPageFromMongoScoped(
        name => getMongoScopedCollection(workspaceType, tenantId, name),
        {
          key,
          view,
          registerChannel,
          orderDate,
          page,
          pageSize,
        },
      )
      if (mongoPage) {
        const list = mongoPage.users.map(user => attachUserOrderStats(db, user, {
          includeAdminPasswordEcho: true,
        }))
        ctx.body = success({
          list,
          total: mongoPage.total,
          page: mongoPage.page,
          pageSize: mongoPage.pageSize,
        })
        return
      }
    }
    ctx.body = success(listAdminUsersPaginatedBeforeEnrich(db, {
      key,
      view,
      registerChannel,
      orderDate,
      page,
      pageSize,
    }))
    return
  }

  let rows = db.users
  if (key) {
    rows = rows.filter(item => item.id.includes(key) || item.name.includes(key) || item.phone.includes(key))
  }

  if (registerChannel === '__none__') {
    rows = rows.filter(item => !userRegisterChannelDisplayKeyFromUser(db, item))
  }
  else if (registerChannel && registerChannel !== '__all__') {
    rows = rows.filter(item => userRegisterChannelDisplayKeyFromUser(db, item) === registerChannel)
  }

  const cardPackageStatsOnly = view === 'card-package-issued'
  rows = rows.map(item => attachUserOrderStats(db, item, {
    includeAdminPasswordEcho: true,
    kpiCardPackageIssuedOnly: cardPackageStatsOnly,
  }))

  if (view === 'ordering' || view === 'card-package-issued') {
    rows = rows.filter(item => Number(item.orderCount || 0) > 0)
    if (orderDate) {
      rows = rows.filter((item) => {
        if (!item.lastOrderAt) return false
        return localYmdFromIso(item.lastOrderAt) === orderDate
      })
    }
    rows.sort((a, b) => {
      const ta = a.lastOrderAt ? new Date(a.lastOrderAt).getTime() : 0
      const tb = b.lastOrderAt ? new Date(b.lastOrderAt).getTime() : 0
      if (tb !== ta) return tb - ta
      return String(a.phone).localeCompare(String(b.phone))
    })
  }
  else {
    if (view === 'no-order') {
      rows = rows.filter(item => Number(item.orderCount || 0) === 0)
    }
    rows.sort((a, b) => {
      const ta = a.registerAt ? new Date(a.registerAt).getTime() : 0
      const tb = b.registerAt ? new Date(b.registerAt).getTime() : 0
      if (tb !== ta) return tb - ta
      return String(a.phone).localeCompare(String(b.phone))
    })
  }

  const total = rows.length
  const start = (page - 1) * pageSize
  const list = rows.slice(start, start + pageSize)
  ctx.body = success({ list, total, page, pageSize })
})

router.get('/users/by-phone', async (ctx) => {
  if (ctx.headers['x-admin-role']) {
    const canRead = await requireAdminPermissionOnAny(
      ctx,
      ['users.registered', 'users.noOrder', 'users.ordering', 'users.cardPackageIssued', 'orders.review', 'orders.approved', 'orders.cardData'],
      'view',
      '按手机号查询用户',
    )
    if (!canRead) {
      return
    }
  }
  const db = readDb()
  const phone = normalizePhone(ctx.query.phone)
  const user = db.users.find(item => item.phone === phone) || null
  ctx.body = success(user ? attachUserOrderStats(db, user, { mall: true }) : null)
})

/** 商城：已下单用户登记两位紧急联系人（姓名 + 手机号），用于领取等流程 */
router.post('/mall/me/emergency-contacts', async (ctx) => {
  const phone = getUserPhone(ctx)
  if (!phone) {
    fail(ctx, '手机号格式不正确')
    return
  }
  const db = readDb()
  const user = db.users.find(item => item.phone === phone)
  if (!user) {
    fail(ctx, '用户不存在', 404)
    return
  }
  if (countApprovedOrdersForUserPhone(db, phone) < 1) {
    fail(ctx, '当前账户无需登记紧急联系人', 400)
    return
  }
  const rawBody = ctx.request && ctx.request.body
  const body = rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody) ? rawBody : {}
  const arr = Array.isArray(body.contacts)
    ? body.contacts
    : (Array.isArray(body.emergencyContacts) ? body.emergencyContacts : [])
  const emergencyCheck = validateEmergencyContactsInput(arr, phone)
  if (!emergencyCheck.ok) {
    fail(ctx, emergencyCheck.msg, 400)
    return
  }
  user.emergencyContacts = emergencyCheck.list
  writeUsersDb(db)
  ctx.body = success({ user: attachUserOrderStats(db, user, { mall: true }) })
})

/** 商城：读取当前用户已生成的流水报告上传引导链接；只读，不触发上游生成，不写入数据 */
router.get('/mall/me/bill-risk', async (ctx) => {
  const phone = getUserPhone(ctx)
  if (!phone) {
    fail(ctx, '手机号格式不正确')
    return
  }
  const db = readDb()
  const user = resolveRegisteredMallUserByNormalizedPhone(db, phone)
  ctx.body = success(buildBillRiskCustomerView(user))
})

/** 先享后付下单：创建浏览器可分步调用的风控会话（后续 7 步由 /wave/:id/step/:key 完成） */
router.post('/mall/installment-risk/wave', async (ctx) => {
  const body = ctx.request.body || {}
  const db = readDb()
  const wavePhone = normalizePhone(body.phoneNumber || '')
  if (/^1\d{10}$/.test(wavePhone)) {
    const waveUser = db.users.find(item => item.phone === wavePhone)
    if (waveUser && waveUser.orderBlacklisted) {
      fail(ctx, '该账号已被限制下单，如有疑问请联系客服', 403)
      return
    }
  }
  try {
    const data = createInstallmentRiskWave({
      userName: body.userName,
      phoneNumber: body.phoneNumber,
      idNumber: body.idNumber,
    })
    ctx.body = success(data)
  }
  catch (err) {
    const code = err && err.statusCode ? Number(err.statusCode) : 400
    fail(ctx, err && err.message ? String(err.message) : '创建风控会话失败', Number.isFinite(code) ? code : 400)
  }
})

router.post('/mall/installment-risk/wave/:waveId/step/:stepKey', async (ctx) => {
  const waveId = String(ctx.params.waveId || '').trim()
  const stepKey = decodeURIComponent(String(ctx.params.stepKey || '').trim())
  let wave
  try {
    wave = getInstallmentRiskWave(waveId)
  }
  catch (err) {
    const code = err && err.statusCode ? Number(err.statusCode) : 400
    fail(ctx, err && err.message ? String(err.message) : '风控会话无效', Number.isFinite(code) ? code : 400)
    return
  }
  const label = ORDER_INSTALLMENT_RISK_STEP_LABELS[stepKey] || stepKey
  try {
    const result = await runOrderSubmitSingleRiskStep(stepKey, {
      userName: wave.userName,
      phoneNumber: wave.phoneNumber,
      idNumber: wave.idNumber,
    })
    recordInstallmentRiskWaveStep(waveId, stepKey, result.step)
    ctx.body = success({ ok: result.ok, step: result.step })
  }
  catch (err) {
    console.error('[mall-installment-risk-step]', err)
    const step = {
      key: stepKey,
      label,
      ok: false,
      error: err && err.message ? String(err.message) : '风控步骤调用异常',
    }
    try {
      recordInstallmentRiskWaveStep(waveId, stepKey, step)
    }
    catch (recErr) {
      console.error('[mall-installment-risk-step-record]', recErr)
    }
    ctx.body = success({ ok: false, step })
  }
})

/** 管理端：用户详情 + 风控档案占位（打开弹窗时不自动跑全量接口） */
router.patch('/users/:id/register-channel', async (ctx) => {
  if (!await requireAdminPermission(ctx, [ADMIN_ROLES.SUPER, ADMIN_ROLES.BOSS], '修改用户注册渠道', { strictRoles: true })) {
    return
  }
  const db = readDb()
  const { id } = ctx.params
  const target = db.users.find(item => item.id === id)
  if (!target) {
    fail(ctx, '用户不存在', 404)
    return
  }

  const body = ctx.request.body || {}
  try {
    applyUserRegisterChannel(db, target, body.registerChannelCode)
  }
  catch (err) {
    const raw = String(err && err.message ? err.message : '')
    const msg = raw === 'register_channel_not_found'
      ? '注册渠道不存在'
      : raw === 'register_channel_disabled'
        ? '注册渠道已停用'
        : raw === 'user_not_found'
          ? '用户不存在'
          : '修改注册渠道失败'
    fail(ctx, msg, Number(err && err.status) || 400)
    return
  }

  writeUsersDb(db)
  ctx.body = success(attachUserOrderStats(db, target, { includeAdminPasswordEcho: true }))
})

router.get('/users/:id', async (ctx) => {
  if (!await requireAdminUsersActionOnAny(ctx, 'view', '查看用户详情')) {
    return
  }
  const db = readDb()
  const { id } = ctx.params
  const target = db.users.find(item => item.id === id)
  if (!target) {
    fail(ctx, '用户不存在', 404)
    return
  }
  const snap = target.riskControlSnapshot && typeof target.riskControlSnapshot === 'object'
    ? target.riskControlSnapshot
    : null
  ctx.body = success({
    user: attachUserOrderStats(db, target, { includeAdminPasswordEcho: true }),
    riskView: {
      snapshot: snap,
      templateRows: normalizeFourteenProductRows([]),
      upstreamConfigured: isRiskUpstreamConfigured(),
    },
  })
})

router.get('/users/:id/mall-contacts', async (ctx) => {
  if (!await requireAdminUsersActionOnAny(ctx, 'view', 'view user contacts')) {
    return
  }
  const db = readDb()
  const { id } = ctx.params
  const target = db.users.find(item => item.id === id)
  if (!target) {
    fail(ctx, 'user_not_found', 404)
    return
  }
  const page = Math.max(1, parseInt(String(ctx.query.page || '1'), 10) || 1)
  const pageSize = Math.min(20, Math.max(1, parseInt(String(ctx.query.pageSize || '10'), 10) || 10))
  const contactsPreviewSize = Math.min(50, Math.max(1, parseInt(String(ctx.query.contactsPreviewSize || '20'), 10) || 20))
  const phone = normalizePhone(target.phone)
  ctx.body = success(await mallContactsStore.listCompletedContactUploads({ phone, page, pageSize, contactsPreviewSize }))
})

router.get('/users/:id/bill-risk', async (ctx) => {
  if (!await requireAdminUsersActionOnAny(ctx, 'view', '查看用户流水风控')) {
    return
  }
  const db = readDb()
  const { id } = ctx.params
  const target = db.users.find(item => item.id === id)
  if (!target) {
    fail(ctx, '用户不存在', 404)
    return
  }
  ctx.body = success(buildBillRiskView(target))
})

router.post('/users/:id/bill-risk/mail', async (ctx) => {
  if (!await requireAdminUsersActionOnAny(ctx, 'riskCheck', '生成流水风控动态邮箱')) {
    return
  }
  const db = readDb()
  const { id } = ctx.params
  const target = db.users.find(item => item.id === id)
  if (!target) {
    fail(ctx, '用户不存在', 404)
    return
  }
  try {
    const result = await generateBillRiskMailForUser(target)
    writeUsersDb(db)
    ctx.body = success(result.view)
  }
  catch (err) {
    fail(ctx, err && err.message ? String(err.message) : '生成流水风控动态邮箱失败', 400)
  }
})

router.post('/bill-risk/callback', async (ctx) => {
  const db = readDb()
  const result = applyBillRiskCallback(db, ctx.request.body || {})
  if (!result.ok) {
    ctx.status = result.status || 400
    ctx.body = { success: false }
    return
  }
  if (!result.ignored) {
    writeUsersDb(db)
  }
  ctx.body = { success: true }
})

/** 管理端：手动调用单条风控产品（按次计费） */
router.post('/users/:id/risk-slot/:slotKey', async (ctx) => {
  if (!await requireAdminUsersActionOnAny(ctx, 'riskCheck', '用户风控核查')) {
    return
  }
  const db = readDb()
  const { id } = ctx.params
  const slotKey = decodeURIComponent(String(ctx.params.slotKey || '').trim())
  const target = db.users.find(item => item.id === id)
  if (!target) {
    fail(ctx, '用户不存在', 404)
    return
  }
  const body = ctx.request.body || {}
  const merged = mergeAdminRiskCallParams(target, body)

  let row
  try {
    row = await runSingleRiskSlot(slotKey, {
      manualInvoke: true,
      enableSms: Boolean(body.allowSms),
      tryContract: Boolean(body.tryContract),
      params: {
        userName: merged.userName,
        phoneNumber: merged.phoneNumber,
        idNumber: merged.idNumber,
        idCardFront: merged.idCardFront,
        idCardBack: merged.idCardBack,
        totalAmount: merged.totalAmount,
      },
    })
  }
  catch (err) {
    fail(ctx, err && err.message ? String(err.message) : '单接口调用失败', 400)
    return
  }

  const prev = target.riskControlSnapshot && typeof target.riskControlSnapshot === 'object'
    ? { ...target.riskControlSnapshot }
    : {}
  let fourteenRows = Array.isArray(prev.fourteenRows) ? [...prev.fourteenRows] : null
  if (!fourteenRows || fourteenRows.length !== 14) {
    fourteenRows = normalizeFourteenProductRows([])
  }
  const idx = fourteenRows.findIndex(r => r.slotKey === slotKey)
  if (idx >= 0) {
    fourteenRows[idx] = row
  }

  const fetchedAt = new Date().toISOString()
  const anyFail = fourteenRows.some(r => r.state === 'fail')
  const nextSnapshot = {
    ...prev,
    fourteenRows,
    configured: isRiskUpstreamConfigured(),
    simulated: false,
    passed: !anyFail,
    checkedAt: fetchedAt,
    summaryMessage: prev.summaryMessage || '',
    userId: target.id,
  }
  if (slotKey === 'radar_v4_enc') {
    nextSnapshot.radarV4History = appendRadarV4ManualHistory(prev, row, fetchedAt)
  }
  target.riskControlSnapshot = nextSnapshot
  writeUsersDb(db)

  ctx.body = success({
    row,
    user: attachUserOrderStats(db, target, { includeAdminPasswordEcho: true }),
    snapshot: target.riskControlSnapshot,
  })
})

router.post('/users/:id/risk-check', async (ctx) => {
  if (!await requireAdminUsersActionOnAny(ctx, 'riskCheck', '用户风控核查')) {
    return
  }
  const db = readDb()
  const { id } = ctx.params
  const target = db.users.find(item => item.id === id)
  if (!target) {
    fail(ctx, '用户不存在', 404)
    return
  }
  const body = ctx.request.body || {}
  const opts = {
    enableSms: Boolean(body.enableSms),
    tryContract: Boolean(body.tryContract),
  }
  const merged = mergeAdminRiskCallParams(target, body)

  if (!isRiskUpstreamConfigured()) {
    fail(ctx, '未配置风控上游（RISK_UPSTREAM_*），无法进行全量核查。配置后可调用真实接口或使用单项手动查询。', 503)
    return
  }

  const pre = await runCreditPreliminaryReview({
    userName: merged.userName,
    phoneNumber: merged.phoneNumber,
    idNumber: merged.idNumber,
    idCardFront: merged.idCardFront,
    idCardBack: merged.idCardBack,
    totalAmount: merged.totalAmount,
    installmentPeriods: 1,
  }, { ...opts, adminManagedBatch: true })

  const prevSnap = target.riskControlSnapshot && typeof target.riskControlSnapshot === 'object'
    ? target.riskControlSnapshot
    : {}
  const snapshot = {
    configured: Boolean(pre.configured),
    simulated: Boolean(pre.simulated),
    passed: pre.passed,
    checkedAt: new Date().toISOString(),
    summaryMessage: pre.summaryMessage || '',
    fourteenRows: normalizeFourteenProductRows(pre.steps),
    rawSteps: pre.steps,
    stepsSummary: pre.stepsSummary,
  }

  target.riskControlSnapshot = {
    ...snapshot,
    userId: target.id,
    ...(Array.isArray(prevSnap.radarV4History) && prevSnap.radarV4History.length > 0
      ? { radarV4History: prevSnap.radarV4History }
      : {}),
  }
  writeUsersDb(db)

  ctx.body = success({
    user: attachUserOrderStats(db, target, { includeAdminPasswordEcho: true }),
    snapshot: target.riskControlSnapshot,
  })
})

router.post('/users', async (ctx) => {
  if (!await requireAdminPermission(ctx, [ADMIN_ROLES.SUPER], '新增用户', { permissionKey: 'users.registered', permissionAction: 'create' })) {
    return
  }
  const db = readDb()
  const payload = ctx.request.body || {}
  const phone = normalizePhone(payload.phone)
  const name = String(payload.name || '').trim()
  const locationText = String(payload.locationText || '').trim()
  if (!/^1\d{10}$/.test(phone)) {
    fail(ctx, '手机号格式不正确')
    return
  }
  if (!name) {
    fail(ctx, '姓名不能为空')
    return
  }

  const duplicated = db.users.find(item => item.phone === phone)
  if (duplicated) {
    fail(ctx, '该手机号已存在', 409)
    return
  }

  const initPwd = String(payload.initialPassword || payload.password || '').trim()
  if (initPwd.length > 0 && initPwd.length < 6) {
    fail(ctx, '密码需至少 6 位')
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
    creditStatus: '待风控',
    registerAt: now,
    quota: normalizeUserQuota(payload.quota),
    adminRemark: '',
    orderBlacklisted: false,
    emergencyContacts: [],
  }
  if (typeof payload.idNumber === 'string' && payload.idNumber.trim()) {
    nextUser.idNumber = payload.idNumber.trim().toUpperCase()
  }
  if (initPwd.length >= 6) {
    nextUser.passwordHash = hashMallUserPassword(initPwd)
    nextUser.adminPasswordPlain = initPwd
  }
  db.users.unshift(nextUser)
  writeUsersDb(db)
  ctx.body = success(attachUserOrderStats(db, nextUser, { includeAdminPasswordEcho: true }))
})

router.get('/my/summary', async (ctx) => {
  const db = readDb()
  const phone = getUserPhone(ctx)
  if (!phone) {
    fail(ctx, '手机号格式不正确')
    return
  }
  ctx.body = success(calcMySummary(db, phone))
})

/** 商城用户订单列表：仅返回当前登录账号 mallUserId 下的订单（只读，不对账写库） */
router.get('/my/orders', async (ctx) => {
  const db = readDb()
  const phone = getUserPhone(ctx)
  if (!phone) {
    fail(ctx, '手机号格式不正确')
    return
  }
  const mallUser = resolveRegisteredMallUserByNormalizedPhone(db, phone)
  if (!mallUser) {
    ctx.body = success([])
    return
  }
  const statusFilter = String(ctx.query.status || '').trim()
  const allowedStatus = new Set(['reviewing', 'shipping', 'receiving', 'enjoying'])
  let list = ordersForRegisteredMallUser(db, mallUser)
  if (statusFilter && allowedStatus.has(statusFilter)) {
    list = list.filter((item) => {
      ensureOrderCardPackage(item)
      return mallOrderRepaymentAwareStatus(item) === statusFilter
    })
  }
  const enriched = list
    .map((order) => {
      ensureOrderCardPackage(order)
      ensureOrderShipment(order)
      ensureOrderInstallmentPlan(order)
      return {
        ...enrichMallOrderWithBuyerFields(db, order),
        status: mallOrderRepaymentAwareStatus(order),
        installmentAllPaid: isInstallmentOrderFullyRepaid(order),
      }
    })
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
  ctx.body = success(enriched)
})

function mapEligibleOrderToCardPackageRow(order) {
  ensureOrderInstallmentPlan(order)
  ensureOrderCardPackage(order)
  return {
    orderId: order.id,
    title: order.name,
    spec: order.spec || '',
    totalAmount: Number(order.totalAmount || 0),
    packageAmount: Math.max(0, Math.round(Number(order.cardPackageAmount) || 0)),
    cardPackageIssued: order.cardPackageIssued,
    orderStatus: order.status,
    createdAt: order.createdAt,
  }
}

router.get('/card-packages', async (ctx) => {
  const db = readDb()
  const phone = getUserPhone(ctx)
  if (!phone) {
    fail(ctx, '手机号格式不正确')
    return
  }
  const mallUser = resolveRegisteredMallUserByNormalizedPhone(db, phone)
  if (!mallUser) {
    ctx.body = success([])
    return
  }
  const list = db.orders
    .filter(item => orderBelongsToRegisteredMallUser(db, item, mallUser) && isOrderCardPackageEligible(item))
    .map(order => mapEligibleOrderToCardPackageRow(order))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  ctx.body = success(list)
})

router.get('/card-packages/:orderId/contract-view', async (ctx) => {
  const phone = getUserPhone(ctx)
  if (!phone) {
    ctx.status = 400
    ctx.type = 'html; charset=utf-8'
    ctx.body = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>提示</title></head><body style="font-family:sans-serif;padding:1rem;">缺少有效查询参数 phone（登录手机号）</body></html>'
    return
  }
  const orderId = decodeURIComponent(String(ctx.params.orderId || ''))
  const db = readDb()
  const order = findMallCardPackageContractViewOrder(db, phone, orderId)
  if (!order) {
    ctx.status = 404
    ctx.type = 'html; charset=utf-8'
    ctx.body = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>提示</title></head><body style="font-family:sans-serif;padding:1rem;">订单不存在或当前不可查看合同</body></html>'
    return
  }
  if (!isMallCardPackageContractMock()) {
    ctx.status = 404
    ctx.type = 'html; charset=utf-8'
    ctx.body = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>提示</title></head><body style="font-family:sans-serif;padding:1rem;">当前未启用本地模拟合同（请设置 MALL_CARD_PACKAGE_CONTRACT_MOCK=1）。真实电子签请使用商城内「去签署」跳转签约平台。</body></html>'
    return
  }
  if (!String(order.cardPackageContractNo || '').trim()) {
    order.cardPackageContractNo = buildCardPackageContractNo(order)
    writeOrdersDb(db)
  }
  const user = db.users.find(item => item.phone === phone)
  ctx.type = 'html; charset=utf-8'
  ctx.body = buildCardPackageContractViewHtml({
    order,
    user: user || null,
    phone,
    contractNo: order.cardPackageContractNo,
    contractTitle: sanitizeCardPackageContractName(order),
    signedAt: order.cardPackageContractSignedAt || '',
    apiOrigin: mallCardPackagePublicOrigin(ctx),
    orderId: order.id,
    scopeTenantId: normalizeTenantId(ctx.state?.tenantId || DEFAULT_TENANT_ID),
  })
})

router.get('/card-packages/:orderId/contract-flow', async (ctx) => {
  const phone = getUserPhone(ctx)
  if (!phone) {
    fail(ctx, '手机号格式不正确')
    return
  }
  const orderId = decodeURIComponent(String(ctx.params.orderId || ''))
  const db = readDb()
  const order = findMallCardPackageContractViewOrder(db, phone, orderId)
  if (!order) {
    fail(ctx, '订单不存在或不可查看合同', 404)
    return
  }
  if (failMallContactsRequired(ctx, order)) {
    return
  }

  if (isMallCardPackageContractMock()) {
    try {
      let contractNo = String(order.cardPackageContractNo || '').trim()
      if (!contractNo) {
        contractNo = buildCardPackageContractNo(order)
        order.cardPackageContractNo = contractNo
        writeOrdersDb(db)
      }
      const getContract = buildMockGetContractJson(ctx, order, contractNo, phone)
      ctx.body = success({
        contractNo,
        getContract,
      })
    }
    catch (err) {
      console.error('[card-packages-contract-flow-mock]', err)
      if (err && String(err.message || '') === 'mock_contract_pdf_missing') {
        fail(ctx, '本地合同模板缺失：请将 PDF 置于 api/public/contracts/card-package-claim-template.pdf', 503)
        return
      }
      fail(ctx, err && err.message ? String(err.message) : '合同服务异常', 502)
    }
    return
  }

  if (!isRiskUpstreamConfigured()) {
    fail(ctx, '电子签章服务未配置，暂无法在线签署。请稍后再试或联系客服。', 503)
    return
  }

  let contractNo = String(order.cardPackageContractNo || '').trim()
  const firstTime = !contractNo

  try {
    if (firstTime) {
      contractNo = buildCardPackageContractNo(order)
      const contractFiles = resolveMallCardPackageContractFileUrls()
      if (!contractFiles.length) {
        fail(
          ctx,
          '服务器未配置卡包合同模板文件地址：请设置环境变量 MALL_CARD_PACKAGE_CONTRACT_FILE_URL（单个 PDF 的 HTTPS 直链）或 MALL_CARD_PACKAGE_CONTRACT_FILE_URLS（多个 URL 用逗号分隔），供电子签平台拉取创建合同。',
          503,
        )
        return
      }
      const createRes = await postCreateContract({
        contractNo,
        contractName: sanitizeCardPackageContractName(order),
        signOrder: 1,
        validityTime: 30,
        contractFiles,
      })
      let createdOk = mallUpstreamContractJsonOk(createRes.json)
      if (!createdOk) {
        const probe = await postGetContract({ contractNo })
        createdOk = mallUpstreamContractJsonOk(probe.json)
        if (!createdOk) {
          fail(ctx, `创建电子合同失败：${mallUpstreamContractErrorMessage(createRes.json)}`, 502)
          return
        }
      }

      await ensureEsignPersonalUserForCardPackage(db, phone)

      const addRes = await postAddSigner([{
        contractNo,
        account: phone,
        signType: 3,
        noticeMobile: phone,
        signOrder: '1',
      }])
      let addOk = mallUpstreamContractJsonOk(addRes.json)
      if (!addOk) {
        const after = await postGetContract({ contractNo })
        const d = after.json && after.json.data
        const hasSigner = d && typeof d === 'object' && Array.isArray(d.signUser) && d.signUser.length > 0
        addOk = mallUpstreamContractJsonOk(after.json) && hasSigner
        if (!addOk) {
          fail(
            ctx,
            `${mallUpstreamContractErrorMessage(addRes.json)} ${cardPackageAddSignerFailHint()}`,
            502,
          )
          return
        }
      }

      order.cardPackageContractNo = contractNo
      writeOrdersDb(db)
    }

    contractNo = String(order.cardPackageContractNo || contractNo || '').trim()
    if (!contractNo) {
      fail(ctx, '合同编号异常', 500)
      return
    }

    const getRes = await postGetContract({ contractNo })
    if (!mallUpstreamContractJsonOk(getRes.json)) {
      fail(ctx, `查询合同失败：${mallUpstreamContractErrorMessage(getRes.json)}`, 502)
      return
    }

    ctx.body = success({
      contractNo,
      getContract: getRes.json,
    })
  }
  catch (err) {
    console.error('[card-packages-contract-flow]', err)
    fail(ctx, err && err.message ? String(err.message) : '合同服务异常', 502)
  }
})

router.post('/card-packages/:orderId/contract-ack', async (ctx) => {
  const phone = getUserPhone(ctx)
  if (!phone) {
    fail(ctx, '手机号格式不正确')
    return
  }
  const orderId = decodeURIComponent(String(ctx.params.orderId || ''))
  const db = readDb()
  reconcileInstallmentCompletionAcrossDb(db)
  const order = findMallCardPackageClaimOrder(db, phone, orderId)
  if (!order) {
    fail(ctx, '订单不存在或不可领取卡包', 404)
    return
  }
  if (failMallContactsRequired(ctx, order)) {
    return
  }

  if (isMallCardPackageContractMock()) {
    let contractNo = String(order.cardPackageContractNo || '').trim()
    if (!contractNo) {
      contractNo = buildCardPackageContractNo(order)
      order.cardPackageContractNo = contractNo
    }
    if (!order.cardPackageContractSignedAt) {
      const rawBody = ctx.request && ctx.request.body
      const body = rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody) ? rawBody : {}
      const sig = typeof body.signaturePng === 'string' ? body.signaturePng.trim() : ''
      if (!/^data:image\/(png|jpeg|jpg|webp);base64,/.test(sig)) {
        fail(ctx, '请先完成手写签名后再提交', 400)
        return
      }
      if (sig.length > 2_500_000) {
        fail(ctx, '签名数据过大，请清除签名后重新书写', 400)
        return
      }
      order.cardPackageContractSignaturePng = sig
      order.cardPackageContractSignedAt = new Date().toISOString()
      writeOrdersDb(db)
      await flushMongoPersist()
    }
    const ackDb = readDb()
    const orderNow = findMallCardPackageClaimOrder(ackDb, phone, orderId) || order
    ctx.body = success({ signed: true, cardPackageRow: mapEligibleOrderToCardPackageRow(orderNow) })
    return
  }

  if (!isRiskUpstreamConfigured()) {
    fail(ctx, '电子签章服务未配置', 503)
    return
  }
  const contractNo = String(order.cardPackageContractNo || '').trim()
  if (!contractNo) {
    fail(ctx, '请先完成合同签署流程', 400)
    return
  }
  try {
    const getRes = await postGetContract({ contractNo })
    if (!mallUpstreamContractJsonOk(getRes.json)) {
      fail(ctx, '查询合同状态失败，请稍后重试', 502)
      return
    }
    const data = getRes.json && getRes.json.data
    if (!isCardPackageContractSignedInUpstreamData(data)) {
      fail(ctx, '系统检测到合同尚未签署完成，请在签署页完成后再点击确认', 400)
      return
    }
    if (!order.cardPackageContractSignedAt) {
      order.cardPackageContractSignedAt = new Date().toISOString()
      writeOrdersDb(db)
      await flushMongoPersist()
    }
    const upstreamAckDb = readDb()
    const orderUpstream = findMallCardPackageClaimOrder(upstreamAckDb, phone, orderId) || order
    ctx.body = success({ signed: true, cardPackageRow: mapEligibleOrderToCardPackageRow(orderUpstream) })
  }
  catch (err) {
    console.error('[card-packages-contract-ack]', err)
    fail(ctx, err && err.message ? String(err.message) : '确认签署异常', 502)
  }
})

/** 清除本站记录的卡包合同签署时间，便于用户重新走签署流程（本地模拟或上游回调后再认定） */
router.post('/card-packages/:orderId/contract-sign-reset', async (ctx) => {
  const db = readDb()
  const phone = getUserPhone(ctx)
  if (!/^1\d{10}$/.test(phone)) {
    fail(ctx, '手机号格式不正确')
    return
  }
  const orderId = decodeURIComponent(String(ctx.params.orderId || ''))
  const order = findMallCardPackageClaimOrder(db, phone, orderId)
  if (!order) {
    fail(ctx, '订单不存在')
    return
  }
  ensureOrderCardPackage(order)
  await unlinkMockCardPackagePdfCacheFile(order)
  order.cardPackageContractSignedAt = ''
  order.cardPackageContractSignaturePng = ''
  writeOrdersDb(db)
  ctx.body = success({ reset: true })
})

router.get('/addresses', async (ctx) => {
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

router.post('/addresses', async (ctx) => {
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
  writeAddressesDb(db)
  ctx.body = success(nextAddress)
})

router.patch('/addresses/:id', async (ctx) => {
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

  writeAddressesDb(db)
  const latest = db.addresses.find(item => String(item.id) === String(id)) || target
  ctx.body = success(latest)
})

router.patch('/addresses/:id/default', async (ctx) => {
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
  writeAddressesDb(db)
  const latest = db.addresses.find(item => String(item.id) === String(id))
  ctx.body = success(latest)
})

router.get('/bank-cards', async (ctx) => {
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

router.post('/bank-cards', async (ctx) => {
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
  writeBankCardsDb(db)
  ctx.body = success({
    ...nextCard,
    cardNoMasked: maskCardNo(nextCard.cardNo),
  })
})

router.delete('/bank-cards/:id', async (ctx) => {
  const db = readDb()
  const phone = getUserPhone(ctx)
  if (!phone) {
    fail(ctx, '手机号格式不正确')
    return
  }
  const { id } = ctx.params
  const idx = db.bankCards.findIndex(
    item => String(item.id) === String(id) && item.userPhone === phone,
  )
  if (idx === -1) {
    fail(ctx, '银行卡不存在', 404)
    return
  }
  db.bankCards.splice(idx, 1)
  writeBankCardsDb(db)
  ctx.body = success({ id: Number(id) })
})

/**
 * 与 GET /bills 一致：构建商城分期账单行并计算 shouldRepay（本月待还）、totalPending（全部待还）。
 * 含 status=reviewing 的先享后付单（行状态为「审核中」、不计入待还汇总），与订单列表一致；供 /bills 与 /my/summary 共用。
 */
function buildMallBillingListAndSummaries(db, phone) {
  const list = []
  const mallUser = resolveRegisteredMallUserByNormalizedPhone(db, phone)
  /** 含审核中的先享后付单，便于账单与「我的—订单」同步展示；待还汇总仅计 status 为「待还款」的行 */
  const loanOrders = db.orders
    .filter(item => mallUser && orderBelongsToRegisteredMallUser(db, item, mallUser))
    .filter(item => item.payType === 'installment')
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  loanOrders.forEach((order) => {
    ensureOrderInstallmentPlan(order)
    const reviewingOrder = order.status === 'reviewing'
    order.installmentPlan.forEach((planItem) => {
      const oid = String(order.id || '')
      const periodNum = Number(planItem.period) || 0
      const rowStatus = reviewingOrder
        ? '审核中'
        : (installmentItemIsPaid(planItem) ? '已还款' : '待还款')
      const installmentRow = {
        /** 稳定键：与 POST /bills/repay 入参一致 */
        id: `${oid}:${periodNum}`,
        billKind: 'installment',
        orderId: oid,
        period: periodNum,
        userPhone: phone,
        title: order.payType === 'installment'
          ? `${order.name} 第${planItem.period}期 #${order.id}`
          : `${order.name} #${order.id}`,
        amount: -Math.abs(Number(planItem.amount || 0)),
        time: `${planItem.dueDate} 00:00`,
        status: rowStatus,
        /** 与还款/预下单校验一致：卡包未发放前不可还款 */
        cardPackageIssued: Boolean(order.cardPackageIssued),
      }
      if (Array.isArray(planItem.negotiationHistory) && planItem.negotiationHistory.length > 0) {
        installmentRow.negotiationHistory = planItem.negotiationHistory.map((h) => ({
          negotiatedAmount: Number(Number(h.negotiatedAmount || 0).toFixed(2)),
          remainderAmount: resolveNegotiateRemainderAmountForDisplay(planItem, h.remainderAmount),
          remainderDueDate: String(h.remainderDueDate || '').trim(),
          createdAt: String(h.createdAt || '').trim(),
          userPaidAt: String(h.userPaidAt || '').trim(),
        }))
      }
      const pend = planItem.negotiationPayPending
      if (pend && Number(pend.negotiatedAmount || 0) > 0) {
        installmentRow.negotiationPayPending = {
          negotiatedAmount: Number(Number(pend.negotiatedAmount || 0).toFixed(2)),
          remainderAmount: resolveNegotiateRemainderAmountForDisplay(planItem, pend.remainderAmount),
          remainderDueDate: String(pend.remainderDueDate || '').trim(),
          createdAt: String(pend.createdAt || '').trim(),
        }
      }
      list.push(installmentRow)
    })
  })
  list.sort((a, b) => String(b.time).localeCompare(String(a.time)))

  const billAmountForTotals = (item) => {
    if (item && item.billKind === 'negotiation') {
      return 0
    }
    return Math.abs(Number(item.amount || 0))
  }

  const currentMonth = formatDate(new Date().toISOString()).slice(0, 7)
  const shouldRepay = Number(
    list
      .filter(item => item.status === '待还款' && String(item.time).startsWith(currentMonth))
      .reduce((sum, item) => sum + billAmountForTotals(item), 0)
      .toFixed(2),
  )
  const totalPending = Number(
    list
      .filter(item => item.status === '待还款')
      .reduce((sum, item) => sum + billAmountForTotals(item), 0)
      .toFixed(2),
  )

  return { list, shouldRepay, totalPending, loanOrders }
}

function buildMallBillsSuccessData(db, phone) {
  const { list, shouldRepay, totalPending, loanOrders } = buildMallBillingListAndSummaries(db, phone)
  const baseQuota = 10000
  const availableQuota = Number(
    Math.max(0, baseQuota - totalPending).toFixed(2),
  )
  const latestLoanOrder = loanOrders[0]
  const latestLoanDate = latestLoanOrder ? new Date(latestLoanOrder.createdAt) : null
  const billDateDay = latestLoanDate && !Number.isNaN(latestLoanDate.getTime())
    ? `${latestLoanDate.getDate()}`.padStart(2, '0')
    : '08'
  return {
    summary: {
      shouldRepay,
      totalPending,
      availableQuota,
      billDate: `每月 ${billDateDay} 日`,
      minRepayment: Number((shouldRepay * 0.1).toFixed(2)),
    },
    list,
  }
}

router.get('/bills', async (ctx) => {
  const db = readDb()
  const phone = getUserPhone(ctx)
  if (!phone) {
    fail(ctx, '手机号格式不正确')
    return
  }
  ctx.body = success(buildMallBillsSuccessData(db, phone))
})

/** 拉卡拉支付成功：全款订单标记已付（与 PATCH /orders/:id/pay 一致） */
function markOrderPaidInDb(target, payChannel) {
  target.paid = true
  ensureOrderInstallmentPlan(target)
  if (target.payType === 'installment') {
    const firstPending = target.installmentPlan.find(item => !installmentItemIsPaid(item))
    if (firstPending) {
      firstPending.paid = true
    }
  }
  else {
    target.installmentPlan = target.installmentPlan.map(item => ({ ...item, paid: true }))
  }
  applyInstallmentCompletionOrderStatus(target, { ignoreAdminSkip: true })
  if (payChannel) {
    target.payChannel = payChannel
  }
  if (target.status === 'reviewing' && target.payType === 'full') {
    target.status = 'shipping'
  }
}

function assertBillRepayTargetOrder(db, mallUser, orderId) {
  const target = db.orders.find(item => String(item.id) === orderId && orderBelongsToRegisteredMallUser(db, item, mallUser))
  if (!target) {
    const err = new Error('订单不存在')
    err.statusCode = 404
    throw err
  }
  if (target.status === 'reviewing') {
    const err = new Error('订单未审核通过，暂无法还款')
    err.statusCode = 400
    throw err
  }
  if (target.payType !== 'installment') {
    const err = new Error('该订单不支持账单还款')
    err.statusCode = 400
    throw err
  }
  if (!target.cardPackageIssued) {
    const err = new Error('卡包未发放，暂无法还款')
    err.statusCode = 400
    throw err
  }
  return target
}

function calcBillRepayAmount(db, mallUser, { orderId, period }) {
  const target = assertBillRepayTargetOrder(db, mallUser, orderId)
  ensureOrderInstallmentPlan(target)
  const planItem = findInstallmentPlanItemByPeriod(target.installmentPlan, period)
  if (!planItem) {
    const err = new Error('账单期次不存在')
    err.statusCode = 404
    throw err
  }
  if (installmentItemIsPaid(planItem)) {
    const err = new Error('该期已还款')
    err.statusCode = 400
    throw err
  }
  if (planItem.negotiationPayPending && Number(planItem.negotiationPayPending.negotiatedAmount || 0) > 0) {
    const err = new Error('本期存在待协商支付款项，请使用协商支付')
    err.statusCode = 400
    throw err
  }
  const amountYuan = Number(Number(planItem.amount || target.totalAmount || 0).toFixed(2))
  return { amountYuan, subject: `账单还款 ${orderId} 第${period}期` }
}

function calcBillNegotiatedPayAmount(db, mallUser, { orderId, period }) {
  const target = assertBillRepayTargetOrder(db, mallUser, orderId)
  ensureOrderInstallmentPlan(target)
  const planItem = findInstallmentPlanItemByPeriod(target.installmentPlan, period)
  if (!planItem) {
    const err = new Error('账单期次不存在')
    err.statusCode = 404
    throw err
  }
  if (installmentItemIsPaid(planItem)) {
    const err = new Error('该期已还款')
    err.statusCode = 400
    throw err
  }
  const pend = planItem.negotiationPayPending
  if (!pend || !Number.isFinite(Number(pend.negotiatedAmount)) || Number(pend.negotiatedAmount) <= 0) {
    const err = new Error('暂无待支付的协商款项')
    err.statusCode = 400
    throw err
  }
  const amountYuan = Number(Number(pend.negotiatedAmount).toFixed(2))
  return { amountYuan, subject: `协商还款 ${orderId} 第${period}期` }
}

function calcBillRepayAllAmount(db, mallUser) {
  const loanOrders = db.orders
    .filter(item => orderBelongsToRegisteredMallUser(db, item, mallUser))
    .filter(item => item.payType === 'installment')
    .filter(item => item.status !== 'reviewing')
  let total = 0
  for (const order of loanOrders) {
    ensureOrderInstallmentPlan(order)
    for (const planItem of order.installmentPlan) {
      if (planItem && !installmentItemIsPaid(planItem)) {
        if (planItem.negotiationPayPending && Number(planItem.negotiationPayPending.negotiatedAmount || 0) > 0) {
          const err = new Error(`订单 ${order.id} 存在待协商支付，无法一键还清`)
          err.statusCode = 400
          throw err
        }
        total += Number(planItem.amount || order.totalAmount || 0)
      }
    }
    if (!order.cardPackageIssued) {
      const err = new Error(`订单 ${order.id} 的卡包尚未发放，暂无法还款`)
      err.statusCode = 400
      throw err
    }
  }
  const amountYuan = Number(total.toFixed(2))
  if (amountYuan <= 0) {
    const err = new Error('暂无待还账单')
    err.statusCode = 400
    throw err
  }
  return { amountYuan, subject: '账单一键还款' }
}

function applyBillRepayInDb(db, mallUser, { orderId, period }) {
  const target = assertBillRepayTargetOrder(db, mallUser, orderId)
  ensureOrderInstallmentPlan(target)
  const planItem = findInstallmentPlanItemByPeriod(target.installmentPlan, period)
  if (!planItem || installmentItemIsPaid(planItem)) {
    return
  }
  if (planItem.negotiationPayPending && Number(planItem.negotiationPayPending.negotiatedAmount || 0) > 0) {
    planItem.negotiationPayPending = null
  }
  planItem.paid = true
  target.installmentScheduleExplicit = true
  applyInstallmentCompletionOrderStatus(target, { ignoreAdminSkip: true })
}

function applyBillNegotiatedPayInDb(db, mallUser, { orderId, period }) {
  const target = assertBillRepayTargetOrder(db, mallUser, orderId)
  ensureOrderInstallmentPlan(target)
  const planItem = findInstallmentPlanItemByPeriod(target.installmentPlan, period)
  if (!planItem) {
    return
  }
  const applied = applyInstallmentNegotiationPayCompleted(planItem)
  if (!applied.ok) {
    throw new Error(applied.msg || '协商支付落库失败')
  }
  target.installmentScheduleExplicit = true
  applyInstallmentCompletionOrderStatus(target, { ignoreAdminSkip: true })
}

function applyBillRepayAllInDb(db, mallUser) {
  const loanOrders = db.orders
    .filter(item => orderBelongsToRegisteredMallUser(db, item, mallUser))
    .filter(item => item.payType === 'installment')
    .filter(item => item.status !== 'reviewing')
  for (const order of loanOrders) {
    ensureOrderInstallmentPlan(order)
    let touched = false
    for (const planItem of order.installmentPlan) {
      if (planItem && !installmentItemIsPaid(planItem)) {
        if (planItem.negotiationPayPending && Number(planItem.negotiationPayPending.negotiatedAmount || 0) > 0) {
          planItem.negotiationPayPending = null
        }
        planItem.paid = true
        touched = true
      }
    }
    if (touched) {
      order.installmentScheduleExplicit = true
      applyInstallmentCompletionOrderStatus(order, { ignoreAdminSkip: true })
    }
  }
}

lakalaPayment.initLakalaPayment({
  readDb,
  writeDb,
  writeDbPartial,
  flushMongoPersist,
  reconcileInstallmentCompletionAcrossDb,
  orderBelongsToRegisteredMallUser,
  resolveRegisteredMallUserByNormalizedPhone,
  normalizePhone,
  buildMallBillsSuccessData,
  markOrderPaidInDb,
  calcBillRepayAmount,
  calcBillNegotiatedPayAmount,
  calcBillRepayAllAmount,
  applyBillRepayInDb,
  applyBillNegotiatedPayInDb,
  applyBillRepayAllInDb,
})

registerLakalaRoutes(router, {
  fail,
  success,
  readDb,
  resolvePlacingMallUserFromBearer,
})

registerMallContactsRoutes(router, {
  contactsStore: mallContactsStore,
  fail,
  flushMongoPersist,
  normalizePhone,
  readDb,
  success,
  writeDbPartial,
})

registerDuodiandianGatewayRoutes(router, {
  readDb,
  writeDb,
  writeDbPartial,
  flushMongoPersist,
  runApplyRiskPack: runOrderSubmitUpstreamRiskPack,
})

registerDuodiandianGatewayRoutes(duodiandianPublicRouter, {
  readDb,
  writeDb,
  writeDbPartial,
  flushMongoPersist,
  runApplyRiskPack: runOrderSubmitUpstreamRiskPack,
})

function queueDuodiandianOrderNotify(event, order, db) {
  if (!event || !order || !db) {
    return
  }
  void notifyDuodiandianOrderEvent({ event, order, db })
    .then((result) => {
      if (result && result.sent) {
        console.log('[duodiandian-notify] sent:', event, order.id || '')
      }
      else if (result && result.reason && result.reason !== 'application_not_found' && result.reason !== 'notify_url_missing') {
        console.warn('[duodiandian-notify] skipped:', event, order.id || '', result.reason)
      }
    })
    .catch((err) => {
      console.warn('[duodiandian-notify] unexpected:', event, order.id || '', err && err.message ? err.message : err)
    })
}

/**
 * 商城用户还款：与后台 PATCH /orders/:id/installments/:period/pay 写入同一套 installmentPlan，
 * 需校验下单注册账号与订单 mallUserId；与 OrdersPage 一致，卡包未发放前不允许记为已还。
 * body: { orderId: string, period: number } 或 { all: true } 一键归还当前用户全部待还期次
 */
router.post('/bills/repay', async (ctx) => {
  const db = readDb()
  reconcileInstallmentCompletionAcrossDb(db)
  const phone = getUserPhone(ctx)
  if (!phone) {
    fail(ctx, '手机号格式不正确')
    return
  }
  const payload = ctx.request.body || {}
  const repayAll = payload.all === true || payload.all === 'true' || payload.all === 1

  const mallUser = resolveRegisteredMallUserByNormalizedPhone(db, phone)
  if (!mallUser) {
    fail(ctx, '用户不存在或未注册商城账号', 404)
    return
  }

  const loanOrders = db.orders
    .filter(item => orderBelongsToRegisteredMallUser(db, item, mallUser))
    .filter(item => item.payType === 'installment')
    .filter(item => item.status !== 'reviewing')

  if (repayAll) {
    for (const order of loanOrders) {
      ensureOrderInstallmentPlan(order)
      const hasUnpaid = order.installmentPlan.some(p => p && !installmentItemIsPaid(p))
      if (!hasUnpaid) {
        continue
      }
      if (!order.cardPackageIssued) {
        fail(ctx, `订单 ${order.id} 的卡包尚未发放，暂无法还款。请联系客服。`)
        return
      }
    }
    let repaidPeriods = 0
    const repaidNotifyOrders = []
    for (const order of loanOrders) {
      ensureOrderInstallmentPlan(order)
      const wasSettled = isMallOrderRepaymentSettled(order)
      let touched = false
      for (const planItem of order.installmentPlan) {
        if (planItem && !installmentItemIsPaid(planItem)) {
          if (planItem.negotiationPayPending && Number(planItem.negotiationPayPending.negotiatedAmount || 0) > 0) {
            planItem.negotiationPayPending = null
          }
          planItem.paid = true
          repaidPeriods += 1
          touched = true
        }
      }
      if (touched) {
        order.installmentScheduleExplicit = true
        applyInstallmentCompletionOrderStatus(order, { ignoreAdminSkip: true })
        if (!wasSettled && isMallOrderRepaymentSettled(order)) {
          repaidNotifyOrders.push(order)
        }
      }
    }
    writeOrdersDb(db)
    await flushMongoPersist()
    const dbAfter = readDb()
    repaidNotifyOrders.forEach(order => queueDuodiandianOrderNotify('repaid', order, dbAfter))
    ctx.body = success({ all: true, repaidPeriods, billing: buildMallBillsSuccessData(dbAfter, phone) })
    return
  }

  const orderId = String(payload.orderId || '').trim()
  const periodNumber = Number(payload.period)
  if (!orderId || !Number.isInteger(periodNumber) || periodNumber <= 0) {
    fail(ctx, '请提供正确的 orderId 与 period')
    return
  }

  const target = db.orders.find(item => String(item.id) === orderId && orderBelongsToRegisteredMallUser(db, item, mallUser))
  if (!target) {
    fail(ctx, '订单不存在', 404)
    return
  }
  if (target.status === 'reviewing') {
    fail(ctx, '订单未审核通过，暂无法还款')
    return
  }
  if (target.payType !== 'installment') {
    fail(ctx, '该订单不支持账单还款')
    return
  }
  if (!target.cardPackageIssued) {
    fail(ctx, '卡包未发放，暂无法还款')
    return
  }
  ensureOrderInstallmentPlan(target)
  const planItem = findInstallmentPlanItemByPeriod(target.installmentPlan, periodNumber)
  if (!planItem) {
    fail(ctx, '账单期次不存在', 404)
    return
  }
  if (installmentItemIsPaid(planItem)) {
    fail(ctx, '该期已还款')
    return
  }
  if (planItem.negotiationPayPending && Number(planItem.negotiationPayPending.negotiatedAmount || 0) > 0) {
    /** 用户可选择「协商支付」分步还，也可「全部支付」一次性还清本期应还并放弃待协商首段 */
    planItem.negotiationPayPending = null
  }
  const wasSettled = isMallOrderRepaymentSettled(target)
  planItem.paid = true
  target.installmentScheduleExplicit = true
  applyInstallmentCompletionOrderStatus(target, { ignoreAdminSkip: true })
  writeOrdersDb(db)
  await flushMongoPersist()
  const dbAfterSingle = readDb()
  if (!wasSettled && isMallOrderRepaymentSettled(target)) {
    queueDuodiandianOrderNotify('repaid', target, dbAfterSingle)
  }
  ctx.body = success({
    orderId: target.id,
    period: periodNumber,
    paid: true,
    billing: buildMallBillsSuccessData(dbAfterSingle, phone),
  })
})

/**
 * 商城用户：支付后台协商登记的本期「协商还款金额」，成功后再落库剩余应还本金与还款日（与 PATCH negotiate 配套）
 * body: { orderId: string, period: number }
 */
router.post('/bills/repay-negotiated', async (ctx) => {
  const db = readDb()
  reconcileInstallmentCompletionAcrossDb(db)
  const phone = getUserPhone(ctx)
  if (!phone) {
    fail(ctx, '手机号格式不正确')
    return
  }
  const payload = ctx.request.body || {}
  const orderId = String(payload.orderId || '').trim()
  const periodNumber = Number(payload.period)
  if (!orderId || !Number.isInteger(periodNumber) || periodNumber <= 0) {
    fail(ctx, '请提供正确的 orderId 与 period')
    return
  }
  const mallUserNegotiate = resolveRegisteredMallUserByNormalizedPhone(db, phone)
  if (!mallUserNegotiate) {
    fail(ctx, '用户不存在或未注册商城账号', 404)
    return
  }
  const target = db.orders.find(item => String(item.id) === orderId && orderBelongsToRegisteredMallUser(db, item, mallUserNegotiate))
  if (!target) {
    fail(ctx, '订单不存在', 404)
    return
  }
  if (target.status === 'reviewing') {
    fail(ctx, '订单未审核通过，暂无法支付')
    return
  }
  if (target.payType !== 'installment') {
    fail(ctx, '该订单不支持协商支付')
    return
  }
  if (!target.cardPackageIssued) {
    fail(ctx, '卡包未发放，暂无法支付')
    return
  }
  ensureOrderInstallmentPlan(target)
  const planItem = findInstallmentPlanItemByPeriod(target.installmentPlan, periodNumber)
  if (!planItem) {
    fail(ctx, '账单期次不存在', 404)
    return
  }
  if (installmentItemIsPaid(planItem)) {
    fail(ctx, '该期已还款')
    return
  }
  const pend = planItem.negotiationPayPending
  if (!pend || !Number.isFinite(Number(pend.negotiatedAmount)) || Number(pend.negotiatedAmount) <= 0) {
    fail(ctx, '暂无待支付的协商款项', 400)
    return
  }
  const remainderDue = normalizeNegotiateRemainderDueDate(pend.remainderDueDate)
  if (!remainderDue || !/^\d{4}-\d{2}-\d{2}$/.test(remainderDue)) {
    fail(ctx, '协商待支付数据异常，请联系客服', 400)
    return
  }
  const wasSettled = isMallOrderRepaymentSettled(target)
  const applied = applyInstallmentNegotiationPayCompleted(planItem)
  if (!applied.ok) {
    fail(ctx, applied.msg, 400)
    return
  }
  target.installmentScheduleExplicit = true
  applyInstallmentCompletionOrderStatus(target, { ignoreAdminSkip: true })
  writeOrdersDb(db)
  await flushMongoPersist()
  const dbNegotiateAfter = readDb()
  if (!wasSettled && isMallOrderRepaymentSettled(target)) {
    queueDuodiandianOrderNotify('repaid', target, dbNegotiateAfter)
  }
  ctx.body = success({
    orderId: target.id,
    period: periodNumber,
    negotiatedPaid: true,
    billing: buildMallBillsSuccessData(dbNegotiateAfter, phone),
  })
})

router.patch('/users/:id', async (ctx) => {
  const db = readDb()
  const { id } = ctx.params
  const payload = ctx.request.body || {}
  const requiredActions = new Set()
  const profileFields = ['phone', 'name', 'locationText', 'idCardFront', 'idCardBack', 'idCardHandheld', 'idNumber', 'latitude', 'longitude', 'signAuthSerialNo', 'emergencyContacts']
  if (profileFields.some(field => Object.prototype.hasOwnProperty.call(payload, field))) requiredActions.add('update')
  if (Object.prototype.hasOwnProperty.call(payload, 'quota')) requiredActions.add('setQuota')
  if (Object.prototype.hasOwnProperty.call(payload, 'newPassword')) requiredActions.add('resetPassword')
  if (Object.prototype.hasOwnProperty.call(payload, 'adminRemark')) requiredActions.add('remark')
  if (Object.prototype.hasOwnProperty.call(payload, 'orderBlacklisted')) requiredActions.add('blacklist')
  if (!requiredActions.size) requiredActions.add('update')
  for (const action of requiredActions) {
    if (!await requireAdminUsersActionOnAny(ctx, action, 'admin action')) {
      return
    }
  }
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
  if (typeof payload.idCardFront === 'string' && payload.idCardFront) {
    target.idCardFront = payload.idCardFront
  }
  if (typeof payload.idCardBack === 'string' && payload.idCardBack) {
    target.idCardBack = payload.idCardBack
  }
  if (typeof payload.idCardHandheld === 'string' && payload.idCardHandheld) {
    target.idCardHandheld = payload.idCardHandheld
  }
  if (typeof payload.idNumber === 'string') {
    target.idNumber = payload.idNumber.trim()
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
  if (typeof payload.newPassword === 'string') {
    const pwd = payload.newPassword.trim()
    if (pwd.length > 0) {
      if (pwd.length < 6) {
        fail(ctx, '密码需至少 6 位')
        return
      }
      target.passwordHash = hashMallUserPassword(pwd)
      target.adminPasswordPlain = pwd
    }
  }
  if (typeof payload.adminRemark === 'string') {
    target.adminRemark = payload.adminRemark.trim()
  }
  if (typeof payload.orderBlacklisted === 'boolean') {
    target.orderBlacklisted = payload.orderBlacklisted
    /** 人工操作与逾期自动拉黑解耦：永不自动解黑；人工解黑后本逾期周期内不再自动拉黑 */
    target.orderBlacklistedByOverdue = false
    target.overdueAutoBlacklistSuppressed = payload.orderBlacklisted === false
  }
  if (typeof payload.signAuthSerialNo === 'string') {
    const s = payload.signAuthSerialNo.trim()
    target.signAuthSerialNo = s
  }
  if (Array.isArray(payload.emergencyContacts)) {
    const emergencyCheck = validateEmergencyContactsInput(payload.emergencyContacts, target.phone)
    if (!emergencyCheck.ok) {
      fail(ctx, emergencyCheck.msg, 400)
      return
    }
    target.emergencyContacts = emergencyCheck.list
  }

  writeUsersDb(db)
  ctx.body = success(attachUserOrderStats(db, target, { includeAdminPasswordEcho: true }))
})

router.delete('/users/:id', async (ctx) => {
  if (!await requireAdminUsersActionOnAny(ctx, 'delete', '删除用户')) {
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
  writeUsersAddressesBankCardsDb(db)
  ctx.body = success({ id, phone: target.phone })
})

/** 与 admin 侧栏角标、GET /orders?adminStatus= 展示口径一致 */
function resolveAdminOrderDisplayStatus(item) {
  ensureOrderRiskState(item)
  const status = mallOrderRepaymentAwareStatus(item)
  if (item.status === 'reviewing' && item.payType === 'installment') {
    return item.riskStatus === 'failed' ? '风控未通过' : '待审核'
  }
  if (item.status === 'reviewing' && !item.paid) {
    return '待付款'
  }
  if (status === 'reviewing' || status === 'shipping') {
    return '待发货'
  }
  if (status === 'receiving') {
    ensureOrderShipment(item)
    return '待收货'
  }
  return '已完成'
}

function adminDashboardYmdPlusDays(baseYmd, delta) {
  const m = String(baseYmd || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) {
    return baseYmd
  }
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + delta)
  const yyyy = dt.getFullYear()
  const mm = `${dt.getMonth() + 1}`.padStart(2, '0')
  const dd = `${dt.getDate()}`.padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

/** admin 财务报表 KPI（与 DashboardPage.vue kpis computed 一致，只读内存聚合） */
function computeAdminDashboardKpisFromDb(db) {
  const basis = (db.orders || []).filter(o => {
    ensureOrderCardPackage(o)
    return Boolean(o.cardPackageIssued)
  })
  const orderCount = basis.length

  let totalSales = 0
  let totalPrincipal = 0
  let totalPeriodSum = 0
  let installmentPayOrderCount = 0
  let receivableAmount = 0
  let receivablePrincipal = 0
  let collectedAmount = 0
  let overdueOrderCount = 0
  let settledOrderCount = 0
  let dueTodayAmount = 0
  let dueTomorrowAmount = 0
  let dueIn7DaysAmount = 0
  let extensionRepaymentAmount = 0
  let extensionRepaymentPendingAmount = 0

  const t = formatDate(new Date().toISOString())
  const tYesterday = adminDashboardYmdPlusDays(t, -1)
  const tTomorrow = adminDashboardYmdPlusDays(t, 1)
  const tWeekEnd = adminDashboardYmdPlusDays(t, 6)

  for (const order of basis) {
    ensureOrderInstallmentPlan(order)
    const orderTotal = Number(order.totalAmount) || 0
    totalSales += orderTotal

    const pkg = Math.max(0, Math.round(Number(order.cardPackageAmount) || 0))
    const plan = Array.isArray(order.installmentPlan) ? order.installmentPlan : []
    const hasUnpaid = plan.some(item => item && !installmentItemIsPaid(item))
    totalPrincipal += pkg
    if (hasUnpaid) {
      receivablePrincipal += pkg
    }

    if (order.payType === '先享后付') {
      installmentPayOrderCount += 1
      const p = Number(order.periods)
      totalPeriodSum += Number.isFinite(p) && p > 0 ? Math.round(p) : plan.length || 0
    }

    if (plan.length > 0 && plan.every(item => item && installmentItemIsPaid(item))) {
      settledOrderCount += 1
    }

    let orderHasOverdue = false
    for (const item of plan) {
      if (!item) {
        continue
      }
      const a = Number(item.amount) || 0
      const dk = normalizeInstallmentDueDateKey(item.dueDate)

      if (installmentItemIsPaid(item)) {
        collectedAmount += a
        continue
      }

      receivableAmount += a

      if (dk && dk < t) {
        orderHasOverdue = true
      }
      if (dk === t) {
        dueTodayAmount += a
      }
      else if (dk === tTomorrow) {
        dueTomorrowAmount += a
      }
      if (dk && dk >= t && dk <= tWeekEnd) {
        dueIn7DaysAmount += a
      }
      const hist = item.negotiationHistory
      if (Array.isArray(hist)) {
        for (const row of hist) {
          if (String(row.userPaidAt || '').trim()) {
            extensionRepaymentAmount += Number(row.negotiatedAmount || 0)
          }
        }
      }
      const pend = item.negotiationPayPending
      if (pend && Number(pend.negotiatedAmount || 0) > 0 && !installmentItemIsPaid(item)) {
        extensionRepaymentPendingAmount += Number(pend.negotiatedAmount || 0)
      }
    }

    if (orderHasOverdue) {
      overdueOrderCount += 1
    }
  }

  const contractCashTotal = collectedAmount + receivableAmount
  const collectionRateByAmount = contractCashTotal > 0 ? (collectedAmount / contractCashTotal) * 100 : 0
  const avgTicket = orderCount > 0 ? totalSales / orderCount : 0
  const premiumToPrincipal = totalSales - totalPrincipal
  const avgPeriods = installmentPayOrderCount > 0 ? totalPeriodSum / installmentPayOrderCount : 0
  // 订单结清率：不含当日，截至昨日各应还日「已到期订单全额结清率」的累计日均
  const dynamicSettlement = computeDynamicOrderSettlementRate(basis, tYesterday)
  const settledRate = dynamicSettlement.dynamicSettledRate
  // 逾期率/占待收：不含当日（仍在催收），动态累计日均截至昨日
  const dynamicReceivable = computeDynamicPendingReceivableAverages(basis, tYesterday)
  const overdueRate = dynamicReceivable.dynamicUnpaidRate
  const overdueShareOfReceivable = dynamicReceivable.dynamicUnpaidShareOfDue
  // 逾期金额：截至昨日全部逾期未还分期金额合计（非日均）
  const overdueAmount = computeTotalOverdueAmount(basis, t)

  return {
    orderCount,
    totalSales,
    totalPrincipal,
    premiumToPrincipal,
    receivableAmount,
    receivablePrincipal,
    collectedAmount,
    overdueAmount,
    overdueOrderCount,
    overdueRate,
    overdueShareOfReceivable,
    settledOrderCount,
    settledRate,
    settlementGapCount: Math.max(0, orderCount - settledOrderCount),
    collectionRateByAmount,
    avgTicket,
    avgPeriods,
    dueTodayAmount,
    dueTomorrowAmount,
    dueIn7DaysAmount,
    installmentPayOrderCount,
    extensionRepaymentAmount,
    extensionRepaymentPendingAmount,
  }
}

/** admin 侧栏：未审核（默认列表，不含风控未通过）/ 已审核列表角标 */
function computeAdminOrderSidebarCountsFromDb(db) {
  let pendingReview = 0
  let reviewedOrdersList = 0
  for (const item of db.orders || []) {
    ensureOrderInstallmentPlan(item)
    ensureOrderCardPackage(item)
    ensureOrderShipment(item)
    const adminStatus = resolveAdminOrderDisplayStatus(item)
    if (adminStatus === '待审核') {
      pendingReview += 1
    }
    if (adminStatus !== '待审核' && adminStatus !== '风控未通过' && !item.cardPackageIssued) {
      reviewedOrdersList += 1
    }
  }
  return { pendingReview, reviewedOrdersList }
}

function orderRepayBucketForAdmin(order) {
  return computeOrderRepayBucket(order, formatDate(new Date().toISOString()))
}

function matchesAdminOrderListScope(item, listScope) {
  ensureOrderInstallmentPlan(item)
  ensureOrderCardPackage(item)
  ensureOrderShipment(item)
  const adminStatus = resolveAdminOrderDisplayStatus(item)
  const isPending = adminStatus === '待审核' || adminStatus === '风控未通过'
  if (!listScope) {
    return true
  }
  if (listScope === 'pending') {
    return isPending
  }
  if (listScope === 'reviewed') {
    return !isPending && !item.cardPackageIssued
  }
  if (listScope === 'card-data') {
    return Boolean(item.cardPackageIssued)
  }
  return true
}

router.get('/admin/orders/sidebar-counts', async (ctx) => {
  if (!await requireAdminPermissionOnAny(ctx, ['orders.review', 'orders.approved'], 'view', '查看订单侧栏角标')) {
    return
  }
  const tenantId = normalizeTenantId(ctx.state && ctx.state.tenantId ? ctx.state.tenantId : DEFAULT_TENANT_ID)
  const workspaceType = normalizeWorkspaceType(ctx.state && ctx.state.workspaceType ? ctx.state.workspaceType : 'tenant')
  const data = await withAdminReadCacheAsync(ctx, 'sidebar-counts', async () => {
    if (isAdminReadOptimizeEnabled() && isMongoPersistenceEnabled()) {
      const counted = await adminMongoReadOptimize.countAdminOrderSidebarCountsFromMongoScoped(
        name => getMongoScopedCollection(workspaceType, tenantId, name),
      )
      if (counted) {
        return counted
      }
    }
    return computeAdminOrderSidebarCountsFromDb(readDb())
  })
  ctx.body = success(data)
})

router.get('/admin/dashboard/kpis', async (ctx) => {
  if (!await requireAdminPermission(ctx, [ADMIN_ROLES.SUPER], '查看财务报表', { permissionKey: 'dashboard', permissionAction: 'view' })) {
    return
  }
  const data = withAdminReadCache(ctx, 'dashboard-kpis', () => {
    const db = readDb()
    return computeAdminDashboardKpisFromDb(db)
  })
  ctx.body = success(data)
})

router.get('/orders', async (ctx) => {
  const {
    keyword = '',
    status = '',
    adminStatus = '',
    payType = '',
    date = '',
    listScope = '',
    repayFilter = '',
    riskStatus = '',
    registerChannel = '',
    page: pageRaw,
    pageSize: pageSizeRaw,
  } = ctx.query

  const scope = String(listScope || '').trim()
  const permissionKey = adminOrderPermissionKeyForListScope(scope)
  if (!await requireAdminPermission(ctx, [ADMIN_ROLES.SUPER, ADMIN_ROLES.REVIEWER, ADMIN_ROLES.COLLECTOR], '查看订单列表', { permissionKey, permissionAction: 'view' })) {
    return
  }
  const db = readDb()
  if (scope === 'card-data') {
    const todayKey = formatDate(new Date().toISOString())
    if (reconcileOverdueUserBlacklistAcrossDb(db, todayKey)) {
      writeUsersDb(db)
    }
  }
  const repay = String(repayFilter || '').trim()
  const risk = String(riskStatus || '').trim()
  const registerChannelFilter = String(registerChannel || '').trim()
  const usePagination = pageRaw != null && String(pageRaw).trim() !== ''

  if (usePagination && isAdminReadOptimizeEnabled()) {
    const page = Math.max(1, parseInt(String(pageRaw), 10) || 1)
    const pageSize = Math.min(100, Math.max(1, parseInt(String(pageSizeRaw || '20'), 10) || 20))
    if (isMongoPersistenceEnabled()) {
      const tenantId = normalizeTenantId(ctx.state && ctx.state.tenantId ? ctx.state.tenantId : DEFAULT_TENANT_ID)
      const workspaceType = normalizeWorkspaceType(ctx.state && ctx.state.workspaceType ? ctx.state.workspaceType : 'tenant')
      const mongoPage = await adminMongoReadOptimize.readAdminOrdersPageFromMongoScoped(
        name => getMongoScopedCollection(workspaceType, tenantId, name),
        {
          keyword,
          status,
          adminStatus,
          payType,
          date,
          scope,
          repay,
          risk,
          registerChannel: registerChannelFilter,
        },
        page,
        pageSize,
      )
      if (mongoPage) {
        const enrichDb = await buildAdminOrderMongoEnrichDb(workspaceType, tenantId, db, mongoPage.orders)
        const userOrdersCache = new Map()
        const list = mongoPage.orders.map((order) => {
          prepareAdminOrderListItem(order)
          const row = enrichMallOrderWithBuyerFields(enrichDb, order)
          return {
            ...row,
            isOldCustomer: isOldCustomerAtOrder(enrichDb, order, userOrdersCache),
          }
        })
        ctx.body = success({
          list,
          total: mongoPage.total,
          page: mongoPage.page,
          pageSize: mongoPage.pageSize,
        })
        return
      }
    }
    ctx.body = success(listAdminOrdersPaginatedBeforeEnrich(db, {
      keyword,
      status,
      adminStatus,
      payType,
      date,
      scope,
      repay,
      risk,
      registerChannel: registerChannelFilter,
    }, page, pageSize))
    return
  }

  const list = db.orders.filter((item) => {
    ensureOrderInstallmentPlan(item)
    ensureOrderCardPackage(item)
    ensureOrderShipment(item)
    // 仅全款：离开待审核/待付款后可视为整单已付。先享后付订单禁止在此处改 paid——否则会污染内存库并触发
    // persistLegacyInstallmentFirstPaidIfOrderPaid + applyInstallmentCompletionOrderStatus，把单期先享后付误判为已全部还清（enjoying），
    // 管理端展示成「已完成」而非「待发货」。
    if (item.payType === 'full' && item.status !== 'reviewing' && !item.paid) {
      item.paid = true
    }
    if (scope && !matchesAdminOrderListScope(item, scope)) {
      return false
    }
    if (scope === 'pending' && !adminPendingListMatchesRiskFilter(item, risk)) {
      return false
    }
    if (scope === 'card-data' && repay && repay !== '全部') {
      if (orderRepayBucketForAdmin(item) !== repay) {
        return false
      }
    }
    if (!adminOrderMatchesRegisterChannel(db, item, registerChannelFilter)) {
      return false
    }
    const byKeyword = orderMatchesAdminKeyword(db, item, keyword)
    const byStatus = !status || item.status === status
    const byAdminStatus = !adminStatus || resolveAdminOrderDisplayStatus(item) === adminStatus
    const byPayType = !payType || item.payType === payType
    const byDate = !date || formatDateTime(item.createdAt).startsWith(String(date))
    return byKeyword && byStatus && byAdminStatus && byPayType && byDate
  })

  list.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))

  const userOrdersCache = new Map()
  const enriched = list.map((order) => {
    const row = enrichMallOrderWithBuyerFields(db, order)
    return {
      ...row,
      isOldCustomer: isOldCustomerAtOrder(db, order, userOrdersCache),
    }
  })

  if (usePagination) {
    const page = Math.max(1, parseInt(String(pageRaw), 10) || 1)
    const pageSize = Math.min(100, Math.max(1, parseInt(String(pageSizeRaw || '20'), 10) || 20))
    const total = enriched.length
    const start = (page - 1) * pageSize
    ctx.body = success({
      list: enriched.slice(start, start + pageSize),
      total,
      page,
      pageSize,
    })
    return
  }

  ctx.body = success(enriched)
})

/** 还款详情中未还且应还日等于指定日期的明细（用于后台待收列表） */
function normalizeInstallmentDueDateKey(dueDate) {
  if (dueDate == null || dueDate === '') {
    return ''
  }
  const s = String(dueDate).trim()
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/)
  if (m) {
    return m[1]
  }
  return formatDate(s).slice(0, 10)
}

function readInstallmentCollectionRemark(planItem) {
  if (!planItem || typeof planItem.collectionRemark !== 'string') {
    return ''
  }
  return planItem.collectionRemark.trim()
}

function normalizeInstallmentCollectionRemark(raw) {
  if (raw == null) {
    return ''
  }
  return String(raw).trim().slice(0, 500)
}

function parsePendingReceivableRepaymentStatus(raw) {
  const value = String(raw || 'unpaid').trim().toLowerCase()
  if (value === 'paid' || value === 'all') {
    return value
  }
  return 'unpaid'
}

function mapPendingReceivableRow(db, ref) {
  const { order, item, key } = ref
  const buyer = resolveMallBuyerFromOrder(db, order)
  const registerChannelView = resolveOrderRegisterChannelView(db, buyer)
  const buyerName = buyer ? String(buyer.name || '').trim() : ''
  let buyerPhoneDigits = buyer ? normalizePhone(buyer.phone || '') : ''
  if (buyerPhoneDigits.startsWith('86') && buyerPhoneDigits.length === 13) {
    buyerPhoneDigits = buyerPhoneDigits.slice(2)
  }
  const buyerPhone = /^1\d{10}$/.test(buyerPhoneDigits) ? buyerPhoneDigits : ''
  const rawRemark = buyer && typeof buyer.adminRemark === 'string' ? buyer.adminRemark.trim() : ''
  return {
    orderId: order.id,
    receiverName: String(order.receiverName || '').trim() || '商城用户',
    buyerName,
    buyerPhone,
    buyerAdminRemark: rawRemark,
    ...registerChannelView,
    receiverPhone: String(order.receiverPhone || '').trim(),
    productName: String(order.name || '').trim(),
    period: Number(item.period),
    dueDate: key,
    amount: Number(Number(item.amount || 0).toFixed(2)),
    collectionRemark: readInstallmentCollectionRemark(item),
    isPaid: installmentItemIsPaid(item),
    repaymentDisplayStatus: ref.repaymentDisplayStatus || (installmentItemIsPaid(item) ? 'paid' : 'unpaid'),
    deferredAsCollected: Boolean(ref.deferredAsCollected),
  }
}

router.get('/orders/pending-receivable', async (ctx) => {
  const dueDate = String(ctx.query.dueDate || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    fail(ctx, '参数 dueDate 须为 YYYY-MM-DD', 400)
    return
  }
  const permissionKey = adminReceivablePermissionKeyForDueDate(dueDate, formatDate(new Date().toISOString()))
  const receivablePermissionKeys = Array.from(new Set([permissionKey, 'orders.receivable.data']))
  if (!await requireAdminPermissionOnAny(ctx, receivablePermissionKeys, 'view', 'view detail')) {
    return
  }
  const db = readDb()

  for (const order of db.orders) {
    ensureOrderInstallmentPlan(order)
    ensureOrderCardPackage(order)
    ensureOrderShipment(order)
    if (order.payType === 'full' && order.status !== 'reviewing' && !order.paid) {
      order.paid = true
    }
  }
  const receivableStats = computePendingReceivableStats(db.orders, dueDate)
  const repaymentStatus = parsePendingReceivableRepaymentStatus(ctx.query.repaymentStatus)
  const listRefs = filterDueOnDateRowRefs(receivableStats.allDueOnDateRowRefs, repaymentStatus)
  const pagination = parseOptionalListPagination(ctx.query, { defaultPageSize: 20, maxPageSize: 200 })
  const pagedRefs = pagination.enabled
    ? paginateRows(listRefs, pagination.page, pagination.pageSize)
    : null
  const rows = (pagedRefs ? pagedRefs.list : listRefs).map(ref => mapPendingReceivableRow(db, ref))
  ctx.body = success({
    dueDate,
    repaymentStatus,
    rows,
    ...(pagedRefs ? {
      total: pagedRefs.total,
      page: pagedRefs.page,
      pageSize: pagedRefs.pageSize,
    } : {}),
    totalAmount: receivableStats.totalAmount,
    totalDueOnDate: receivableStats.totalDueOnDate,
    paidDueOnDate: receivableStats.paidDueOnDate,
    unpaidDueOnDate: receivableStats.unpaidDueOnDate,
    totalDueOnDateCount: receivableStats.totalDueOnDateCount,
    paidDueOnDateCount: receivableStats.paidDueOnDateCount,
    unpaidDueOnDateCount: receivableStats.unpaidDueOnDateCount,
    deferredAsCollectedAmount: receivableStats.deferredAsCollectedAmount,
    deferredAsCollectedCount: receivableStats.deferredAsCollectedCount,
    collectionRateOnDate: receivableStats.collectionRateOnDate,
    unpaidRateOnDate: receivableStats.unpaidRateOnDate,
    overdueRateAsOfDate: receivableStats.overdueRateAsOfDate,
    overdueBeforeDateCount: receivableStats.overdueBeforeDateCount,
    unpaidDueOnOrBeforeDateCount: receivableStats.unpaidDueOnOrBeforeDateCount,
  })
})

const ADMIN_RECEIVABLE_PERMISSION_KEYS = [
  'orders.receivable.today',
  'orders.receivable.tomorrow',
  'orders.receivable.data',
]

async function requireAdminReceivableCollectionRemarkPermission(ctx, actionLabel = '编辑还款备注') {
  if (await requireAdminPermissionOnAny(ctx, ADMIN_RECEIVABLE_PERMISSION_KEYS, 'remark', actionLabel)) {
    return true
  }
  return requireAdminPermissionOnAny(ctx, ADMIN_RECEIVABLE_PERMISSION_KEYS, 'view', actionLabel)
}

/** 管理端：编辑待收期次的还款备注（存于 installmentPlan 期次项，与用户 adminRemark 无关） */
router.patch('/orders/:id/installments/:period/collection-remark', async (ctx) => {
  if (!await requireAdminReceivableCollectionRemarkPermission(ctx)) {
    return
  }
  const db = readDb()
  const { id, period } = ctx.params
  const payload = ctx.request.body || {}
  const target = db.orders.find(item => String(item.id) === String(id))
  if (!target) {
    fail(ctx, '订单不存在', 404)
    return
  }
  const periodNumber = Number(period)
  if (!Number.isInteger(periodNumber) || periodNumber <= 0) {
    fail(ctx, '期数参数不正确', 400)
    return
  }
  if (!Object.prototype.hasOwnProperty.call(payload, 'collectionRemark')) {
    fail(ctx, '请提供 collectionRemark 字段', 400)
    return
  }
  ensureOrderInstallmentPlan(target)
  const planItem = findInstallmentPlanItemByPeriod(target.installmentPlan, periodNumber)
  if (!planItem) {
    fail(ctx, '先享后付记录不存在', 404)
    return
  }
  const nextRemark = normalizeInstallmentCollectionRemark(payload.collectionRemark)
  if (nextRemark) {
    planItem.collectionRemark = nextRemark
  }
  else {
    delete planItem.collectionRemark
  }
  writeOrdersDb(db)
  await flushMongoPersist()
  ctx.body = success({
    orderId: target.id,
    period: periodNumber,
    collectionRemark: nextRemark,
  })
})

/** 单条订单详情（含最新 installmentPlan），供管理端「查看还款」等弹窗拉数 */
router.get('/orders/:id', async (ctx) => {
  if (!await requireAdminPermissionOnAny(ctx, ['orders.review', 'orders.approved', 'orders.cardData'], 'view', 'view detail')) {
    return
  }
  const db = readDb()
  const { id } = ctx.params
  const target = db.orders.find(item => String(item.id) === String(id))
  if (!target) {
    fail(ctx, '订单不存在', 404)
    return
  }
  ensureOrderInstallmentPlan(target)
  ensureOrderCardPackage(target)
  ensureOrderShipment(target)
  if (target.payType === 'full' && target.status !== 'reviewing' && !target.paid) {
    target.paid = true
  }
  const buyer = resolveMallBuyerFromOrder(db, target)
  const registerChannelView = resolveOrderRegisterChannelView(db, buyer)
  const rawRemark = buyer && typeof buyer.adminRemark === 'string' ? buyer.adminRemark.trim() : ''
  const emergencyContactsComplete = buyer
    ? isEmergencyContactsComplete(normalizeEmergencyContactsList(buyer.emergencyContacts))
    : null
  const buyerName = buyer ? String(buyer.name || '').trim() : ''
  let buyerPhoneDigits = buyer ? normalizePhone(buyer.phone || '') : ''
  if (buyerPhoneDigits.startsWith('86') && buyerPhoneDigits.length === 13) {
    buyerPhoneDigits = buyerPhoneDigits.slice(2)
  }
  const buyerPhone = /^1\d{10}$/.test(buyerPhoneDigits) ? buyerPhoneDigits : ''
  ctx.body = success({
    ...target,
    buyerName: buyerName || '',
    buyerPhone,
    buyerAdminRemark: rawRemark,
    emergencyContactsComplete,
    ...registerChannelView,
    isOldCustomer: isOldCustomerAtOrder(db, target),
  })
})

router.get('/orders/:id/risk-detail', async (ctx) => {
  if (!await requireAdminPermissionOnAny(ctx, ['orders.review', 'orders.approved', 'orders.cardData'], 'view', 'order risk detail')) {
    return
  }
  const db = readDb()
  const { id } = ctx.params
  const target = db.orders.find(item => item.id === id)
  if (!target) {
    fail(ctx, '订单不存在', 404)
    return
  }
  // 模拟本地风控服务调用耗时。
  await sleep(120)
  ctx.body = success(buildOrderRiskDetail(target, db))
})

router.post('/orders', async (ctx) => {
  const db = readDb()
  const payload = ctx.request.body || {}
  let orderSubmitUserSnapshotMerged = false
  const placingUser = resolvePlacingMallUserFromBearer(ctx, db)
  if (!placingUser) {
    fail(ctx, '请先登录商城账号后再下单（缺少有效 Bearer 登录态）', 401)
    return
  }
  const pid = payload.productId
  const productRow = db.products.map(normalizeProductRecord).find(p => String(p.id) === String(pid))
  if (!productRow) {
    fail(ctx, '商品不存在', 404)
    return
  }
  if (!productRow.onSale) {
    fail(ctx, '商品已下架', 400)
    return
  }
  if (placingUser.orderBlacklisted) {
    fail(ctx, '该账号已被限制下单，如有疑问请联系客服', 403)
    return
  }
  const hasOpenOrderForAccount = db.orders.some(
    item => orderBelongsToRegisteredMallUser(db, item, placingUser) && !isMallOrderRepaymentSettled(item),
  )
  if (hasOpenOrderForAccount) {
    fail(ctx, '您尚有未还清的订单，请结清后再下单', 400)
    return
  }
  const rawQty = Number(payload.quantity)
  const quantity = Number.isFinite(rawQty) && rawQty >= 1 ? Math.min(99, Math.floor(rawQty)) : 1
  const itemSubtotal = Number((Number(productRow.price) * quantity).toFixed(2))

  const payType = payload.payType || 'full'
  let totalAmount = Number(payload.totalAmount)
  if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
    totalAmount = itemSubtotal
  }
  if (payType === 'installment') {
    const buyer = placingUser
    const creditLimit = normalizeUserQuota(buyer.quota)
    if (itemSubtotal > creditLimit) {
      fail(ctx, `商品总额（￥${itemSubtotal}）已超过您的授信额度（￥${creditLimit}）`, 400)
      return
    }
    totalAmount = itemSubtotal
  }

  const cardPackageUnit = Math.max(0, Math.round(Number(productRow.cardPackageAmount) || 0))
  const nextOrder = {
    id: `OD${Date.now()}`,
    productId: payload.productId,
    name: payload.name,
    spec: payload.spec,
    totalAmount,
    quantity,
    cardPackageAmount: cardPackageUnit * quantity,
    createdAt: new Date().toISOString(),
    status: payload.status || 'reviewing',
    paid: Boolean(payload.paid),
    payType,
    installmentPeriods: payType === 'installment' ? 1 : Number(payload.installmentPeriods) || 1,
    payChannel: payload.payChannel || 'wechat',
    receiverName: payload.receiverName || '匿名用户',
    receiverPhone: payload.receiverPhone || '',
    receiverAddress: payload.receiverAddress || '',
    riskStatus: 'passed',
    riskReason: '',
    riskCheckedAt: '',
    cardPackageIssued: false,
    trackingNumber: '',
    mallUserId: placingUser.id,
  }
  if (nextOrder.payType === 'installment') {
    const riskBypassReason = String(payload.riskBypassReason || '').trim()
    const isReturningCustomerBypass = riskBypassReason === 'returning_customer'
    if (isReturningCustomerBypass) {
      if (!isMallUserReturningCustomer(db, placingUser)) {
        fail(ctx, '当前账号不满足老客户免风控条件，请按正常流程提交', 400)
        return
      }
      if (nextOrder.status === 'reviewing') {
        nextOrder.status = 'shipping'
      }
      nextOrder.riskStatus = 'passed'
      nextOrder.riskReason = ''
      nextOrder.riskCheckedAt = new Date().toISOString()
      nextOrder.riskBypassReason = 'returning_customer'
      nextOrder.riskOrderSubmitPack = false
    }
    else {
    const idForRisk = String(payload.idNumber || '').trim()
    const idPlaceholder = String(process.env.RISK_PRELIMINARY_PLACEHOLDER_ID || '').trim()
    /** 先享后付风控身份以注册资料为准（收货人可为他人）；按身份证号在库中解析账号主档 */
    const idUpperForRisk = String(idForRisk || '').trim().toUpperCase()
    const riskSubject = idUpperForRisk
      ? db.users.find(u => String(u.idNumber || '').trim().toUpperCase() === idUpperForRisk)
      : null
    /** 风控身份仅以注册资料为准：身份证号命中则用该行用户；否则用当前 Bearer 下单账号（绝不回落收货人） */
    const riskIdentityUser = riskSubject || placingUser
    const riskUserNameForWave = String(riskIdentityUser.name || '').trim()
    let riskPhoneForWave = normalizePhone(riskIdentityUser.phone || '')
    if (riskPhoneForWave.startsWith('86') && riskPhoneForWave.length === 13) {
      riskPhoneForWave = riskPhoneForWave.slice(2)
    }
    if (!/^1\d{10}$/.test(riskPhoneForWave)) {
      riskPhoneForWave = ''
    }
    if (!riskPhoneForWave) {
      let p = normalizePhone(placingUser.phone || '')
      if (p.startsWith('86') && p.length === 13) {
        p = p.slice(2)
      }
      if (/^1\d{10}$/.test(p)) {
        riskPhoneForWave = p
      }
    }
    if (isRiskUpstreamConfigured() && !idForRisk && !idPlaceholder) {
      fail(ctx, '先享后付下单需提交身份证号以便系统风控核验，请先完成注册资料', 400)
      return
    }
    const installmentRiskWaveId = String(payload.installmentRiskWaveId || '').trim()
    let riskResult
    let orderSubmitRiskStepsFull = []
    if (installmentRiskWaveId && idUpperForRisk && !riskSubject) {
      fail(ctx, '未找到与身份证号对应的注册账号，无法完成先享后付风控核验', 400)
      return
    }
    if (installmentRiskWaveId) {
      const consumed = consumeInstallmentRiskWaveForOrder(installmentRiskWaveId, {
        userName: riskUserNameForWave,
        phoneNumber: riskPhoneForWave,
        idNumber: idForRisk,
      })
      if (!consumed.ok) {
        fail(ctx, consumed.reason || '先享后付风控校验未通过', 400)
        return
      }
      orderSubmitRiskStepsFull = Array.isArray(consumed.steps) ? consumed.steps : []
      riskResult = {
        status: 'passed',
        reason: '',
        checkedAt: new Date().toISOString(),
        preliminaryStepsSummary: orderSubmitRiskStepsFull.map(s => ({
          key: s.key,
          state: s.skipped ? 'skipped' : (s.ok ? 'ok' : 'fail'),
          label: s.label,
          error: s.error,
        })),
      }
    }
    else {
      const reusableApplyRisk = findReusableDuodiandianApplyRiskReview(db, {
        userName: riskUserNameForWave,
        phoneNumber: riskPhoneForWave || normalizePhone(placingUser.phone),
        idNumber: idForRisk,
      })
      if (reusableApplyRisk) {
        orderSubmitRiskStepsFull = []
        riskResult = {
          status: reusableApplyRisk.status === 'PASS' ? 'passed' : 'failed',
          reason: reusableApplyRisk.status === 'PASS' ? '' : (reusableApplyRisk.reason || '点多多进件预风控未通过'),
          checkedAt: reusableApplyRisk.checkedAt || new Date().toISOString(),
          preliminaryStepsSummary: Array.isArray(reusableApplyRisk.stepsSummary) ? reusableApplyRisk.stepsSummary : [],
        }
        nextOrder.riskReviewSource = 'duodiandian_apply'
        nextOrder.riskReviewApplyNo = reusableApplyRisk.app && reusableApplyRisk.app.applyNo
        nextOrder.riskReviewPartnerOrderNo = reusableApplyRisk.app && reusableApplyRisk.app.partnerOrderNo
      }
      else {
      try {
        const pack = await runOrderSubmitUpstreamRiskPack({
          userName: riskUserNameForWave,
          phoneNumber: riskPhoneForWave || normalizePhone(placingUser.phone),
          idNumber: idForRisk,
        })
        orderSubmitRiskStepsFull = Array.isArray(pack.steps) ? pack.steps : []
        riskResult = {
          status: pack.allPassed ? 'passed' : 'failed',
          reason: pack.allPassed ? '' : (pack.message || '系统审核不通过'),
          checkedAt: new Date().toISOString(),
          preliminaryStepsSummary: orderSubmitRiskStepsFull.map(s => ({
            key: s.key,
            state: s.skipped ? 'skipped' : (s.ok ? 'ok' : 'fail'),
            label: s.label,
            error: s.error,
          })),
        }
      }
      catch (err) {
        console.error('[order-submit-risk-pack]', err)
        orderSubmitRiskStepsFull = []
        riskResult = {
          status: 'failed',
          reason: err && err.message ? String(err.message) : '系统审核调用异常',
          checkedAt: new Date().toISOString(),
          preliminaryStepsSummary: [],
        }
      }
      }
    }
    nextOrder.riskStatus = riskResult.status
    nextOrder.riskReason = riskResult.reason
    nextOrder.riskCheckedAt = riskResult.checkedAt
    if (Array.isArray(riskResult.preliminaryStepsSummary)) {
      nextOrder.riskPreliminaryStepsSummary = riskResult.preliminaryStepsSummary
    }
    nextOrder.riskOrderSubmitPack = nextOrder.riskReviewSource === 'duodiandian_apply' ? false : true
    const buyerForRiskSnap = riskSubject || placingUser
    if (buyerForRiskSnap && orderSubmitRiskStepsFull.length > 0) {
      mergeInstallmentOrderRiskStepsIntoUserSnapshot(
        buyerForRiskSnap,
        orderSubmitRiskStepsFull,
        riskResult.checkedAt,
      )
      orderSubmitUserSnapshotMerged = true
    }
    }
  }
  nextOrder.installmentPlan = buildInstallmentPlan(
    nextOrder.totalAmount,
    nextOrder.payType,
    '',
    nextOrder.paid,
    nextOrder.installmentPeriods,
  )
  db.orders.unshift(nextOrder)
  if (orderSubmitUserSnapshotMerged) {
    writeOrdersAndUsersDb(db)
  }
  else {
    writeOrdersDb(db)
  }
  await flushMongoPersist()
  if (nextOrder.payType === 'installment') {
    if (nextOrder.riskStatus === 'passed') {
      queueDuodiandianOrderNotify('risk_pass', nextOrder, readDb())
    }
    else if (nextOrder.riskStatus === 'failed') {
      queueDuodiandianOrderNotify('risk_reject', nextOrder, readDb())
    }
  }
  const phoneSync = normalizePhone(placingUser.phone)
  let mallRefresh
  if (/^1\d{10}$/.test(phoneSync)) {
    const syncedDb = readDb()
    mallRefresh = {
      billing: buildMallBillsSuccessData(syncedDb, phoneSync),
      mySummary: calcMySummary(syncedDb, phoneSync),
    }
  }
  ctx.body = success(Object.assign({}, nextOrder, mallRefresh ? { mallRefresh } : {}))
})

router.patch('/orders/:id/pay', async (ctx) => {
  if (!await requireAdminPermission(ctx, [ADMIN_ROLES.SUPER, ADMIN_ROLES.REVIEWER], '标记全款订单已支付', { permissionKey: 'orders.approved', permissionAction: 'updateStatus' })) {
    return
  }
  const db = readDb()
  const { id } = ctx.params
  const payload = ctx.request.body || {}
  const target = db.orders.find(item => String(item.id) === String(id))

  if (!target) {
    ctx.status = 404
    ctx.body = { success: false, code: 404, msg: '订单不存在', data: null }
    return
  }

  markOrderPaidInDb(target, payload.payChannel)
  writeOrdersDb(db)
  await flushMongoPersist()
  ctx.body = success(target)
})

router.patch('/orders/:id/installments/:period/pay', async (ctx) => {
  if (!await requireAdminMarkPaidPermission(ctx, '标记还款状态')) {
    return
  }
  const db = readDb()
  const { id, period } = ctx.params
  const payload = ctx.request.body || {}
  const target = db.orders.find(item => String(item.id) === String(id))
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
  const planItem = findInstallmentPlanItemByPeriod(target.installmentPlan, periodNumber)
  if (!planItem) {
    fail(ctx, '先享后付记录不存在', 404)
    return
  }

  const wasSettled = isMallOrderRepaymentSettled(target)
  planItem.paid = Boolean(payload.paid)
  if (planItem.paid && planItem.negotiationPayPending) {
    planItem.negotiationPayPending = null
  }
  if (!planItem.paid) {
    restoreNegotiationPayPendingFromLastHistoryIfNeeded(planItem)
  }

  target.installmentScheduleExplicit = true

  applyInstallmentCompletionOrderStatus(target, { ignoreAdminSkip: true })

  writeOrdersDb(db)
  await flushMongoPersist()
  if (!wasSettled && isMallOrderRepaymentSettled(target)) {
    queueDuodiandianOrderNotify('repaid', target, readDb())
  }
  ctx.body = success(target)
})

/** 管理端：修改指定期次还款日——支持顺延若干天（addDays）或直接指定协商还款日（dueDate） */
router.patch('/orders/:id/installments/:period/due-date', async (ctx) => {
  const db = readDb()
  const { id, period } = ctx.params
  const payload = ctx.request.body || {}
  const dueDateRaw = String(payload.dueDate || '').trim()
  const addDaysRaw = payload.addDays
  const isSetDueDate = dueDateRaw !== ''
  const isDeferByDays = addDaysRaw != null && addDaysRaw !== ''

  if (isSetDueDate && isDeferByDays) {
    fail(ctx, 'addDays 与 dueDate 不可同时提交')
    return
  }
  if (!isSetDueDate && !isDeferByDays) {
    fail(ctx, '请提供 addDays 或 dueDate')
    return
  }

  if (isSetDueDate) {
    if (!await requireAdminMarkPaidPermission(ctx, '修改还款日', 'delayRepayment')) {
      return
    }
  }
  else if (!await requireAdminMarkPaidPermission(ctx, '延期还款', 'delayRepayment')) {
    return
  }

  const target = db.orders.find(item => String(item.id) === String(id))
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
  const planItem = findInstallmentPlanItemByPeriod(target.installmentPlan, periodNumber)
  if (!planItem) {
    fail(ctx, '先享后付记录不存在', 404)
    return
  }

  if (installmentItemIsPaid(planItem)) {
    fail(ctx, isSetDueDate ? '已还款期次不可修改还款日' : '已还款期次不可延期')
    return
  }

  if (isSetDueDate) {
    const todayKey = formatDate(new Date().toISOString())
    if (!isDueDateOnOrAfterToday(dueDateRaw, todayKey)) {
      fail(ctx, '还款日须为今天或之后的日期')
      return
    }
    if (!hasNegotiatedRepaymentDueDateTarget(planItem)) {
      fail(ctx, '当前期无协商记录，无法修改协商还款日')
      return
    }
    const applied = applyNegotiatedRepaymentDueDate(planItem, dueDateRaw)
    if (!applied.ok) {
      fail(ctx, applied.error || '还款日无效')
      return
    }
    target.installmentScheduleExplicit = true
    writeOrdersDb(db)
    await flushMongoPersist()
    ctx.body = success(target)
    return
  }

  const addDaysNum = Number(addDaysRaw)
  if (!Number.isInteger(addDaysNum) || addDaysNum < 1 || addDaysNum > 3650) {
    fail(ctx, 'addDays 须为 1～3650 的整数')
    return
  }

  const key = resolveDeferRepaymentBaseDueDateKey(planItem)
  if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    fail(ctx, '当前期还款日无效，无法延期')
    return
  }

  const nextYmd = addDays(`${key}T12:00:00`, addDaysNum)
  if (!nextYmd || !/^\d{4}-\d{2}-\d{2}$/.test(nextYmd)) {
    fail(ctx, '计算新还款日失败')
    return
  }

  const todayKeyForDisplay = formatDate(new Date().toISOString())
  if (key === todayKeyForDisplay) {
    recordDeferRepaymentDisplayEvent(planItem, {
      orderId: target.id,
      period: periodNumber,
      fromDueDate: key,
      toDueDate: nextYmd,
    })
  }
  applyDeferRepaymentDueDate(planItem, nextYmd)
  target.installmentScheduleExplicit = true
  applyInstallmentCompletionOrderStatus(target, { ignoreAdminSkip: true })

  writeOrdersDb(db)
  await flushMongoPersist()
  ctx.body = success(target)
})

/** 管理端：协商结清金额——将本期应还总额与本金直接改为指定值（无协商记录且待协商支付为空时可用） */
router.patch('/orders/:id/installments/:period/settle-amount', async (ctx) => {
  if (!await requireAdminMarkPaidPermission(ctx, '协商结清金额', 'settleAmount')) {
    return
  }
  const db = readDb()
  const { id, period } = ctx.params
  const payload = ctx.request.body || {}
  const target = db.orders.find(item => String(item.id) === String(id))
  if (!target) {
    fail(ctx, '订单不存在', 404)
    return
  }
  if (target.payType !== 'installment') {
    fail(ctx, '仅先享后付订单可修改应还金额', 400)
    return
  }
  if (!target.cardPackageIssued) {
    fail(ctx, '卡包未发放，暂不可修改应还金额', 400)
    return
  }
  const periodNumber = Number(period)
  if (!Number.isInteger(periodNumber) || periodNumber <= 0) {
    fail(ctx, '期数参数不正确')
    return
  }
  ensureOrderInstallmentPlan(target)
  const planItem = findInstallmentPlanItemByPeriod(target.installmentPlan, periodNumber)
  if (!planItem) {
    fail(ctx, '先享后付记录不存在', 404)
    return
  }
  if (installmentItemIsPaid(planItem)) {
    fail(ctx, '已还款期次不可修改应还金额', 400)
    return
  }
  if (Array.isArray(planItem.negotiationHistory) && planItem.negotiationHistory.length > 0) {
    fail(ctx, '该期已有协商记录，请使用「协商还款」或协商记录调整，不可直接修改应还金额', 400)
    return
  }
  if (planItem.negotiationPayPending && Number(planItem.negotiationPayPending.negotiatedAmount || 0) > 0) {
    fail(ctx, '本期尚有协商款项待用户完成支付，请先完成后再修改', 400)
    return
  }
  const nextRaw = Number(payload.amount)
  if (!Number.isFinite(nextRaw) || nextRaw < 0.01) {
    fail(ctx, '应还金额须为不小于 0.01 的数字')
    return
  }
  const nextAmount = Number(nextRaw.toFixed(2))
  if (nextAmount > 99_999_999) {
    fail(ctx, '应还金额过大')
    return
  }
  planItem.amount = nextAmount
  planItem.principal = nextAmount
  if (planItem.fee != null) {
    planItem.fee = 0
  }
  target.installmentScheduleExplicit = true
  applyInstallmentCompletionOrderStatus(target, { ignoreAdminSkip: true })
  writeOrdersDb(db)
  await flushMongoPersist()
  ctx.body = success(target)
})

/** 管理端：协商还款——登记延期费与协商还款日，写入协商历史（不扣减本期应还金额） */
router.patch('/orders/:id/installments/:period/negotiate', async (ctx) => {
  if (!await requireAdminMarkPaidPermission(ctx, '协商还款', 'negotiateRepayment')) {
    return
  }
  const db = readDb()
  const { id, period } = ctx.params
  const payload = ctx.request.body || {}
  const target = db.orders.find(item => String(item.id) === String(id))
  if (!target) {
    fail(ctx, '订单不存在', 404)
    return
  }
  if (target.payType !== 'installment') {
    fail(ctx, '仅先享后付订单可协商还款', 400)
    return
  }
  if (!target.cardPackageIssued) {
    fail(ctx, '卡包未发放，暂不可协商还款', 400)
    return
  }
  const periodNumber = Number(period)
  if (!Number.isInteger(periodNumber) || periodNumber <= 0) {
    fail(ctx, '期数参数不正确')
    return
  }
  ensureOrderInstallmentPlan(target)
  const planItem = findInstallmentPlanItemByPeriod(target.installmentPlan, periodNumber)
  if (!planItem) {
    fail(ctx, '先享后付记录不存在', 404)
    return
  }
  if (installmentItemIsPaid(planItem)) {
    fail(ctx, '已还款期次不可协商', 400)
    return
  }
  if (planItem.negotiationPayPending && Number(planItem.negotiationPayPending.negotiatedAmount || 0) > 0) {
    fail(ctx, '本期尚有协商款项待用户在前台完成支付，暂不可再次协商', 400)
    return
  }
  const negotiatedAmountRaw = Number(payload.negotiatedAmount)
  if (!Number.isFinite(negotiatedAmountRaw) || negotiatedAmountRaw <= 0) {
    fail(ctx, '协商还款金额须为大于 0 的数字')
    return
  }
  const curAmount = Number(Number(planItem.amount || 0).toFixed(2))
  const nAmt = Number(negotiatedAmountRaw.toFixed(2))
  if (nAmt > 99_999_999) {
    fail(ctx, '协商还款金额过大')
    return
  }
  const remainder = negotiateExtensionFeeRemainderAmount(planItem)
  if (remainder <= 0) {
    fail(ctx, '当前应还金额无效，无法协商')
    return
  }
  const remainderDue = normalizeNegotiateRemainderDueDate(payload.remainderDueDate)
  if (!remainderDue || !/^\d{4}-\d{2}-\d{2}$/.test(remainderDue)) {
    fail(ctx, '请提供有效的协商还款日（YYYY-MM-DD）')
    return
  }
  const originalEffectiveDue = resolveDeferRepaymentBaseDueDateKey(planItem)
  if (!Array.isArray(planItem.negotiationHistory)) {
    planItem.negotiationHistory = []
  }
  planItem.negotiationHistory.push({
    negotiatedAmount: nAmt,
    remainderAmount: remainder,
    remainderDueDate: remainderDue,
    originalDueDate: String(planItem.dueDate || '').trim(),
    createdAt: new Date().toISOString(),
  })
  /** 待用户在前台完成「协商支付」后再更新还款日；此前本期应还总额保持不变 */
  planItem.negotiationPayPending = {
    negotiatedAmount: nAmt,
    remainderAmount: remainder,
    remainderDueDate: remainderDue,
    createdAt: new Date().toISOString(),
  }
  recordNegotiationDeferAsCollectedEvent(planItem, {
    orderId: target.id,
    period: periodNumber,
    fromDueDate: originalEffectiveDue,
    toDueDate: remainderDue,
  })
  target.installmentScheduleExplicit = true
  applyInstallmentCompletionOrderStatus(target, { ignoreAdminSkip: true })
  writeOrdersDb(db)
  await flushMongoPersist()
  ctx.body = success(target)
})

/** 管理端：协商记录中单条「协商金额还款状态」标记已还 / 未还（与商城协商支付落库一致，可撤销末条已应用状态） */
router.patch('/orders/:id/installments/:period/negotiation/history/:historyIndex/paid', async (ctx) => {
  const historyAction = ctx.request.body && ctx.request.body.paid === false ? 'revokePaid' : 'markPaid'
  if (!await requireAdminMarkPaidPermission(ctx, 'admin action', historyAction)) {
    return
  }
  const db = readDb()
  const { id, period, historyIndex: historyIndexRaw } = ctx.params
  const payload = ctx.request.body || {}
  const target = db.orders.find(item => String(item.id) === String(id))
  if (!target) {
    fail(ctx, '订单不存在', 404)
    return
  }
  if (target.payType !== 'installment') {
    fail(ctx, '仅先享后付订单可操作', 400)
    return
  }
  if (!target.cardPackageIssued) {
    fail(ctx, '卡包未发放，暂不可操作', 400)
    return
  }
  const periodNumber = Number(period)
  if (!Number.isInteger(periodNumber) || periodNumber <= 0) {
    fail(ctx, '期数参数不正确')
    return
  }
  const historyIndex = Number(historyIndexRaw)
  if (!Number.isInteger(historyIndex) || historyIndex < 0) {
    fail(ctx, '协商记录序号不正确')
    return
  }
  ensureOrderInstallmentPlan(target)
  const planItem = findInstallmentPlanItemByPeriod(target.installmentPlan, periodNumber)
  if (!planItem) {
    fail(ctx, '先享后付记录不存在', 404)
    return
  }
  if (installmentItemIsPaid(planItem)) {
    fail(ctx, '该期已结清，不可再改协商记录', 400)
    return
  }
  const hist = planItem.negotiationHistory
  if (!Array.isArray(hist) || !hist[historyIndex]) {
    fail(ctx, '协商记录不存在', 404)
    return
  }
  const row = hist[historyIndex]
  const isLast = historyIndex === hist.length - 1
  const paid = Boolean(payload.paid)
  const wasSettled = isMallOrderRepaymentSettled(target)

  if (paid) {
    if (isLast && planItem.negotiationPayPending && Number(planItem.negotiationPayPending.negotiatedAmount || 0) > 0) {
      const applied = applyInstallmentNegotiationPayCompleted(planItem)
      if (!applied.ok) {
        fail(ctx, applied.msg, 400)
        return
      }
    }
    else {
      row.userPaidAt = new Date().toISOString()
    }
  }
  else {
    if (isLast && !planItem.negotiationPayPending) {
      const rev = revertLastNegotiationPayCompletion(planItem)
      if (!rev.ok) {
        delete row.userPaidAt
      }
    }
    else {
      delete row.userPaidAt
    }
  }

  target.installmentScheduleExplicit = true
  applyInstallmentCompletionOrderStatus(target, { ignoreAdminSkip: true })
  writeOrdersDb(db)
  await flushMongoPersist()
  if (!wasSettled && isMallOrderRepaymentSettled(target)) {
    queueDuodiandianOrderNotify('repaid', target, readDb())
  }
  ctx.body = success(target)
})

router.patch('/orders/:id/status', async (ctx) => {
  const marks = { start: reviewPerfNowMs() }
  const logExtra = { orderId: String(ctx.params.id || ''), operation: 'status_update' }
  try {
    const db = readDb()
    const { id } = ctx.params
    const body = ctx.request.body || {}
    const { status } = body
    const target = db.orders.find(item => item.id === id)
    marks.readDbEnd = reviewPerfNowMs()

    if (!target) {
      ctx.status = 404
      ctx.body = { success: false, code: 404, msg: '订单不存在', data: null }
      return
    }
    const previousStatus = target.status
    const previousRiskStatus = target.riskStatus
    const isReviewOperation = target.status === 'reviewing' || body.riskStatus === 'failed'
    marks.authStart = reviewPerfNowMs()
    const role = isReviewOperation
      ? await requireAdminPermission(ctx, [ADMIN_ROLES.SUPER, ADMIN_ROLES.REVIEWER], 'admin action', { permissionKey: 'orders.review', permissionAction: 'review' })
      : await requireAdminPermission(ctx, [ADMIN_ROLES.SUPER, ADMIN_ROLES.REVIEWER], '修改订单状态', { permissionKey: 'orders.approved', permissionAction: 'updateStatus' })
    marks.authEnd = reviewPerfNowMs()
    if (!role) {
      return
    }

    marks.businessStart = reviewPerfNowMs()
    /** 人工审核不通过：保持 reviewing，仅将先享后付风控标为未通过（与系统风控失败同列展示逻辑） */
    if (body.riskStatus === 'failed') {
      logExtra.operation = 'risk_reject'
      ensureOrderRiskState(target)
      if (target.payType !== 'installment') {
        fail(ctx, '仅先享后付订单可操作审核不通过', 400)
        return
      }
      if (target.status !== 'reviewing') {
        fail(ctx, '仅待审核中的订单可标记审核不通过', 400)
        return
      }
      const customReason = typeof body.riskReason === 'string' ? body.riskReason.trim() : ''
      target.riskStatus = 'failed'
      target.riskReason = customReason || '人工审核不通过'
      target.riskCheckedAt = new Date().toISOString()
      ensureOrderCardPackage(target)
      const buyer = resolveMallBuyerFromOrder(db, target)
      if (buyer) {
        buyer.manualRejectReason = target.riskReason
      }
      marks.businessEnd = reviewPerfNowMs()
      marks.persistScheduleStart = reviewPerfNowMs()
      writeOrderDb(db, target)
      if (buyer) {
        writeUserDb(db, buyer)
      }
      marks.persistScheduleEnd = reviewPerfNowMs()
      marks.flushStart = reviewPerfNowMs()
      await flushMongoPersist()
      ctx.state.mongoPersistFlushed = true
      marks.flushEnd = reviewPerfNowMs()
      if (previousRiskStatus !== 'failed') {
        queueDuodiandianOrderNotify('risk_reject', target, readDb())
      }
      ctx.body = success({
        ...target,
        manualRejectReason: buyer ? String(buyer.manualRejectReason || '').trim() : '',
      })
      return
    }

    /** 风控未通过订单重新审核：恢复为待审核（riskStatus=passed），可再次审核通过/不通过 */
    if (body.riskStatus === 'passed') {
      logExtra.operation = 'risk_rereview'
      ensureOrderRiskState(target)
      if (target.payType !== 'installment') {
        fail(ctx, '仅先享后付订单可操作重新审核', 400)
        return
      }
      if (target.status !== 'reviewing') {
        fail(ctx, '仅待审核中的订单可重新审核', 400)
        return
      }
      if (target.riskStatus !== 'failed') {
        fail(ctx, '仅风控未通过的订单可重新审核', 400)
        return
      }
      target.riskStatus = 'passed'
      target.riskReason = ''
      target.riskCheckedAt = new Date().toISOString()
      ensureOrderCardPackage(target)
      marks.businessEnd = reviewPerfNowMs()
      marks.persistScheduleStart = reviewPerfNowMs()
      writeOrderDb(db, target)
      marks.persistScheduleEnd = reviewPerfNowMs()
      marks.flushStart = reviewPerfNowMs()
      await flushMongoPersist()
      ctx.state.mongoPersistFlushed = true
      marks.flushEnd = reviewPerfNowMs()
      ctx.body = success(target)
      return
    }

    if (status) {
      logExtra.operation = status === 'shipping' ? 'risk_pass' : 'status_update'
      if (role === ADMIN_ROLES.REVIEWER && status !== 'shipping') {
        fail(ctx, '审核员仅允许执行“审核通过（状态改为 shipping）”操作', 403)
        return
      }
      ensureOrderRiskState(target)
      if (status === 'shipping' && target.payType === 'installment' && target.riskStatus !== 'passed') {
        fail(ctx, '该订单风控未通过，不能审核通过')
        return
      }
      if (status === 'shipping') {
        ensureOrderShipment(target)
        const tn = String(target.trackingNumber || '').trim()
        if (tn) {
          fail(ctx, '已填写快递单号时不可将订单改回待发货，请先在「快递单号」中清空单号', 400)
          return
        }
      }
      if (status === 'receiving') {
        const tnRecv = String(target.trackingNumber || '').trim()
        if (!tnRecv) {
          fail(ctx, '请填写快递单号后再将订单改为待收货', 400)
          return
        }
      }
      if (status === 'enjoying' && !target.cardPackageIssued) {
        fail(ctx, '卡包未发放时不可将订单标记为已完成，请先在「卡包发放」中标记已发放', 400)
        return
      }
      target.status = status
      if (status === 'reviewing') {
        target.trackingNumber = ''
      }
      // 避免后续 GET /orders 对账时因「先享后付已全部还清」再次把状态写回 enjoying，导致管理端改状态后列表仍显示「已完成」
      if (target.payType === 'installment') {
        target.skipInstallmentAutoEnjoying = status !== 'enjoying'
      }
    }
    ensureOrderCardPackage(target)
    if (status === 'shipping' && previousStatus !== 'shipping' && target.payType === 'installment') {
      markMallContactsRequiredForOrder(target)
    }
    marks.businessEnd = reviewPerfNowMs()
    marks.persistScheduleStart = reviewPerfNowMs()
    writeOrderDb(db, target)
    marks.persistScheduleEnd = reviewPerfNowMs()
    marks.flushStart = reviewPerfNowMs()
    await flushMongoPersist()
    ctx.state.mongoPersistFlushed = true
    marks.flushEnd = reviewPerfNowMs()
    if (status === 'shipping' && previousStatus !== 'shipping' && target.payType === 'installment') {
      queueDuodiandianOrderNotify('risk_pass', target, readDb())
    }
    ctx.body = success(target)
  }
  finally {
    const now = reviewPerfNowMs()
    if (marks.businessStart && !marks.businessEnd) {
      marks.businessEnd = now
    }
    if (marks.flushStart && !marks.flushEnd) {
      marks.flushEnd = now
    }
    marks.end = now
    maybeLogReviewPerf(ctx, marks, logExtra)
  }
})

router.patch('/orders/:id/shipment', async (ctx) => {
  if (!await requireAdminShipmentTrackingPermission(ctx, '登记快递单号')) {
    return
  }
  const db = readDb()
  const { id } = ctx.params
  const payload = ctx.request.body || {}
  const target = db.orders.find(item => item.id === id)
  if (!target) {
    fail(ctx, '订单不存在', 404)
    return
  }
  ensureOrderShipment(target)
  if (payload.trackingNumber === undefined || payload.trackingNumber === null) {
    fail(ctx, '请传 trackingNumber（可为空字符串以清空）')
    return
  }
  const trackingNumber = String(payload.trackingNumber).trim()
  const shipmentLockedToTrackingOnly = target.status === 'enjoying' || Boolean(target.cardPackageIssued)
  if (target.status !== 'shipping' && target.status !== 'receiving' && !shipmentLockedToTrackingOnly) {
    fail(ctx, '当前订单状态不可登记快递单号')
    return
  }

  if (!trackingNumber) {
    const hadTracking = String(target.trackingNumber || '').trim().length > 0
    target.trackingNumber = ''
    if (hadTracking && target.status === 'receiving') {
      target.status = 'shipping'
    }
  }
  else {
    if (target.status === 'shipping') {
      target.status = 'receiving'
    }
    target.trackingNumber = trackingNumber
  }
  ensureOrderInstallmentPlan(target)
  ensureOrderCardPackage(target)
  writeOrdersDb(db)
  ctx.body = success(target)
})

router.patch('/orders/:id/card-package', async (ctx) => {
  const role = await requireAdminPermissionOnAny(ctx, ['orders.approved', 'orders.cardData'], 'issueCard', '维护卡包发放状态')
  if (!role) {
    return
  }
  const db = readDb()
  const { id } = ctx.params
  const payload = ctx.request.body || {}
  const target = db.orders.find(item => item.id === id)
  if (!target) {
    fail(ctx, '订单不存在', 404)
    return
  }
  ensureOrderInstallmentPlan(target)
  ensureOrderCardPackage(target)
  if (!isOrderCardPackageEligible(target)) {
    fail(ctx, '仅审核通过后的订单可维护卡包发放状态', 400)
    return
  }
  if (typeof payload.cardPackageIssued !== 'boolean') {
    fail(ctx, 'cardPackageIssued 必须为布尔值')
    return
  }
  if (payload.cardPackageIssued === true && target.payType === 'installment') {
    if (!String(target.cardPackageContractSignedAt || '').trim()) {
      fail(ctx, '合同未签署前不可标记卡包已发放', 400)
      return
    }
  }
  const wasIssued = Boolean(target.cardPackageIssued)
  target.cardPackageIssued = payload.cardPackageIssued
  /** 管理端规则：卡包发放不再等于已完成，只有还清后才进入 enjoying */
  if (payload.cardPackageIssued === true) {
    if (!wasIssued) {
      target.cardPackageIssuedAt = new Date().toISOString()
      applyInstallmentDueDatesOnCardPackageIssue(target, target.cardPackageIssuedAt)
    }
    applyInstallmentCompletionOrderStatus(target, { ignoreAdminSkip: true })
  }
  else if (wasIssued) {
    target.cardPackageIssuedAt = ''
    clearInstallmentDueDatesBeforeCardIssue(target)
  }
  writeOrdersDb(db)
  if (!wasIssued && payload.cardPackageIssued === true) {
    queueDuodiandianOrderNotify('loan_pass', target, readDb())
  }
  ctx.body = success(target)
})

/** 管理端：维护卡包领取电子合同签署状态（与商城 contract-ack 语义一致） */
router.patch('/orders/:id/card-package-contract', async (ctx) => {
  const role = await requireAdminPermission(ctx, [ADMIN_ROLES.SUPER, ADMIN_ROLES.REVIEWER], '修改合同签署状态', { permissionKey: 'orders.approved', permissionAction: 'updateContract' })
  if (!role) {
    return
  }
  const db = readDb()
  const { id } = ctx.params
  const payload = ctx.request.body || {}
  const target = db.orders.find(item => item.id === id)
  if (!target) {
    fail(ctx, '订单不存在', 404)
    return
  }
  ensureOrderInstallmentPlan(target)
  ensureOrderCardPackage(target)
  if (!isOrderCardPackageEligible(target)) {
    fail(ctx, '仅审核通过且进入发货/收货/完成阶段的订单可维护合同签署状态', 400)
    return
  }
  if (typeof payload.signed !== 'boolean') {
    fail(ctx, 'signed 必须为布尔值')
    return
  }
  if (payload.signed === true) {
    if (!String(target.cardPackageContractNo || '').trim()) {
      target.cardPackageContractNo = buildCardPackageContractNo(target)
    }
    if (!target.cardPackageContractSignedAt) {
      target.cardPackageContractSignedAt = new Date().toISOString()
    }
  }
  else {
    if (target.cardPackageIssued) {
      fail(ctx, '卡包已发放时不可将合同改为未签署，请先将卡包改为未发放', 400)
      return
    }
    target.cardPackageContractSignedAt = ''
  }
  writeOrdersDb(db)
  ctx.body = success(target)
})

router.delete('/orders/:id', async (ctx) => {
  if (!await requireAdminOrderDeletePermission(ctx)) {
    return
  }
  const cached = ctx.state._orderDeleteCtx
  const db = cached?.db || readDb()
  const id = cached?.id || ctx.params.id
  const idx = typeof cached?.idx === 'number'
    ? cached.idx
    : db.orders.findIndex(item => item.id === id)
  if (idx < 0) {
    fail(ctx, '订单不存在', 404)
    return
  }
  db.orders.splice(idx, 1)
  writeOrdersDb(db)
  ctx.body = success({ id })
})

/** ---------- 商城 / 管理端：在线客服（持久化 csSessions，轮询拉取） ---------- */

router.post('/mall/cs/session/open', async (ctx) => {
  const db = readDb()
  ensureCsSessions(db)
  const body = ctx.request.body || {}
  const visitorKeyBody = String(body.visitorKey || '').trim()
  const phone = normalizePhone(parsePhoneFromToken(ctx.headers.authorization))
  const mallUser = phone && /^1\d{10}$/.test(phone) ? db.users.find(u => u.phone === phone) : null

  if (mallUser) {
    let s = findCsSessionForMall(db, mallUser.id)
    if (!s) {
      s = createCsSessionRecord({ mallUser })
      db.csSessions.push(s)
    }
    const resolvedName = resolveCsSessionDisplayName(db, s)
    if (resolvedName && s.displayName !== resolvedName) {
      s.displayName = resolvedName
    }
    s.userOnlineAt = new Date().toISOString()
    writeCsSessionsDb(db)
    ctx.body = success({
      sessionId: s.id,
      visitorKey: s.visitorKey || '',
      displayName: resolveCsSessionDisplayName(db, s),
      messages: Array.isArray(s.messages) ? s.messages : [],
      auth: 'mall_token',
    })
    return
  }

  let s = visitorKeyBody ? findCsSessionByVisitorKey(db, visitorKeyBody) : null
  const isNew = !s
  if (!s) {
    s = createCsSessionRecord({ mallUser: null, visitorKey: visitorKeyBody || undefined })
    db.csSessions.push(s)
  }
  s.userOnlineAt = new Date().toISOString()
  writeCsSessionsDb(db)
  const payload = {
    sessionId: s.id,
    visitorKey: s.visitorKey,
    displayName: s.displayName,
    messages: Array.isArray(s.messages) ? s.messages : [],
    auth: 'visitor_headers',
  }
  if (isNew) {
    payload.secret = s.authSecret
  }
  ctx.body = success(payload)
})

router.get('/mall/cs/session', async (ctx) => {
  const db = readDb()
  const r = resolveCsMallSession(ctx, db, { requireExisting: true })
  if (r.error) {
    fail(ctx, r.error, 401)
    return
  }
  const s = r.session
  const resolvedName = resolveCsSessionDisplayName(db, s)
  const needsPersist = touchCsMallSessionPollState(s, { resolvedDisplayName: resolvedName })
  if (needsPersist) {
    writeCsSessionsDb(db)
  }
  ctx.body = success({
    sessionId: s.id,
    visitorKey: s.visitorKey || '',
    displayName: resolvedName,
    messages: Array.isArray(s.messages) ? s.messages : [],
  })
})

router.post('/mall/cs/messages', async (ctx) => {
  const db = readDb()
  const r = resolveCsMallSession(ctx, db, { requireExisting: true })
  if (r.error) {
    fail(ctx, r.error, 401)
    return
  }
  const body = ctx.request.body || {}
  const text = String(body.text || '').trim()
  if (!text) {
    fail(ctx, '消息内容不能为空')
    return
  }
  const s = r.session
  csAppendMessage(s, 'user', text)
  s.userOnlineAt = new Date().toISOString()
  writeCsSessionsDb(db)
  ctx.body = success({
    ok: true,
    messages: Array.isArray(s.messages) ? s.messages : [],
  })
})

router.post('/mall/cs/messages/image', async (ctx) => {
  try {
    await mallPublicImageUpload.single('image')(ctx, async () => {
      const db = readDb()
      const r = resolveCsMallSession(ctx, db, { requireExisting: true })
      const file = ctx.file
      if (r.error) {
        fail(ctx, r.error, 401)
        return
      }
      if (!file || !file.buffer || !file.originalname) {
        fail(ctx, '请选择图片文件')
        return
      }
      if (!isOssConfigured()) {
        fail(ctx, 'OSS 未配置，请先配置 OSS_*')
        return
      }
      const imageCheck = validatePublicImageBuffer(file)
      if (!imageCheck.ok) {
        fail(ctx, imageCheck.msg)
        return
      }
      const uploaded = await uploadPublicImage({
        buffer: file.buffer,
        contentType: file.mimetype || 'image/jpeg',
        originalName: file.originalname || `cs${detectImageExtFromMime(file.mimetype)}`,
        scene: 'message',
        phone: r.session?.mallUserId || '',
        biz: 'cs',
      })
      const imageUrl = uploaded.url
      const s = r.session
      csAppendMessage(s, 'user', '', { type: 'image', imageUrl })
      s.userOnlineAt = new Date().toISOString()
      writeCsSessionsDb(db)
      ctx.body = success({
        ok: true,
        messages: Array.isArray(s.messages) ? s.messages : [],
      })
    })
  }
  catch (err) {
    const code = err && typeof err === 'object' ? err.code : ''
    const raw = String(err?.message || err || '')
    let msg = '上传失败'
    if (code === 'LIMIT_FILE_SIZE' || raw.includes('LIMIT_FILE_SIZE') || raw.includes('too large')) {
      msg = '图片不能超过 5MB'
    }
    else if (raw.includes('仅支持')) {
      msg = raw
    }
    else if (raw && raw !== 'Error') {
      msg = raw
    }
    fail(ctx, msg, 400)
  }
})

router.get('/admin/cs/badge', async (ctx) => {
  if (!await requireAdminPermission(ctx, [ADMIN_ROLES.SUPER, ADMIN_ROLES.REVIEWER], '查看客服未读', { permissionKey: 'cs.messages', permissionAction: 'view' })) {
    return
  }
  const db = readDb()
  ctx.body = success(computeCsAdminBadge(db))
})

router.get('/admin/cs/unread-sum', async (ctx) => {
  if (!await requireAdminPermission(ctx, [ADMIN_ROLES.SUPER, ADMIN_ROLES.REVIEWER], '查看客服未读', { permissionKey: 'cs.messages', permissionAction: 'view' })) {
    return
  }
  const db = readDb()
  ensureCsSessions(db)
  const total = (db.csSessions || []).reduce(
    (sum, s) => sum + Math.max(0, Number(s?.unreadAgent || 0)),
    0,
  )
  ctx.body = success({ total })
})

router.get('/admin/cs/sessions', async (ctx) => {
  if (!await requireAdminPermission(ctx, [ADMIN_ROLES.SUPER, ADMIN_ROLES.REVIEWER], '查看客服会话', { permissionKey: 'cs.messages', permissionAction: 'view' })) {
    return
  }
  const db = readDb()
  ensureCsSessions(db)
  const list = [...db.csSessions]
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .map(s => ({
      id: s.id,
      userName: resolveCsSessionDisplayName(db, s),
      lastMessage: String(s.lastMessagePreview || (Array.isArray(s.messages) && s.messages.length
        ? (() => {
            const lm = s.messages[s.messages.length - 1]
            if (!lm) {
              return ''
            }
            if (lm.type === 'image' || lm.imageUrl) {
              return '[图片]'
            }
            return lm.text || ''
          })()
        : '') || ''),
      lastAt: s.updatedAt || '',
      online: csUserOnline(s),
      unread: Number(s.unreadAgent || 0),
      mallUserId: s.mallUserId || '',
      visitorKey: s.visitorKey || '',
    }))
  const pagination = parseOptionalListPagination(ctx.query, { defaultPageSize: 30, maxPageSize: 100 })
  if (pagination.enabled) {
    ctx.body = success(paginateRows(list, pagination.page, pagination.pageSize))
    return
  }
  ctx.body = success(list)
})

router.get('/admin/cs/sessions/:sessionId', async (ctx) => {
  if (!await requireAdminPermission(ctx, [ADMIN_ROLES.SUPER, ADMIN_ROLES.REVIEWER], '查看客服会话详情', { permissionKey: 'cs.messages', permissionAction: 'view' })) {
    return
  }
  const db = readDb()
  const s = findCsSessionById(db, ctx.params.sessionId)
  if (!s) {
    fail(ctx, '会话不存在', 404)
    return
  }
  const markRead = !['0', 'false', 'no'].includes(String(ctx.query.read || '1').toLowerCase())
  if (markRead && Number(s.unreadAgent || 0) > 0) {
    s.unreadAgent = 0
    writeCsSessionsDb(db)
  }
  const allMessages = Array.isArray(s.messages) ? s.messages : []
  const afterMessageId = String(ctx.query.afterMessageId || ctx.query.after || '').trim()
  const messagePagination = parseOptionalListPagination(ctx.query, { defaultPageSize: 50, maxPageSize: 200 })
  let messages = allMessages
  if (afterMessageId) {
    const afterIndex = allMessages.findIndex(item => String(item && item.id || '') === afterMessageId)
    messages = afterIndex >= 0 ? allMessages.slice(afterIndex + 1) : []
  }
  if (messagePagination.enabled) {
    messages = paginateRows(messages, messagePagination.page, messagePagination.pageSize).list
  }
  ctx.body = success({
    id: s.id,
    displayName: resolveCsSessionDisplayName(db, s),
    online: csUserOnline(s),
    messages,
    mallUserId: s.mallUserId || '',
    ...(afterMessageId || messagePagination.enabled ? {
      messageTotal: allMessages.length,
      messageReturned: messages.length,
      latestMessageId: allMessages.length ? String(allMessages[allMessages.length - 1]?.id || '') : '',
    } : {}),
  })
})

router.post('/admin/cs/sessions/:sessionId/messages', async (ctx) => {
  if (!await requireAdminPermission(ctx, [ADMIN_ROLES.SUPER, ADMIN_ROLES.REVIEWER], '回复客服会话', { permissionKey: 'cs.messages', permissionAction: 'reply' })) {
    return
  }
  const db = readDb()
  const s = findCsSessionById(db, ctx.params.sessionId)
  if (!s) {
    fail(ctx, '会话不存在', 404)
    return
  }
  const body = ctx.request.body || {}
  const text = String(body.text || '').trim()
  if (!text) {
    fail(ctx, '消息内容不能为空')
    return
  }
  const agentName = resolveCsAgentName(ctx, db)
  csAppendMessage(s, 'agent', text, { agentName })
  writeCsSessionsDb(db)
  ctx.body = success({
    ok: true,
    messages: Array.isArray(s.messages) ? s.messages : [],
  })
})

router.post('/admin/cs/sessions/:sessionId/messages/image', async (ctx) => {
  if (!await requireAdminPermission(ctx, [ADMIN_ROLES.SUPER, ADMIN_ROLES.REVIEWER], '回复客服会话', { permissionKey: 'cs.messages', permissionAction: 'reply' })) {
    return
  }
  try {
    await mallPublicImageUpload.single('image')(ctx, async () => {
      const db = readDb()
      const s = findCsSessionById(db, ctx.params.sessionId)
      const file = ctx.file
      if (!s) {
        fail(ctx, '会话不存在', 404)
        return
      }
      if (!file || !file.buffer || !file.originalname) {
        fail(ctx, '请选择图片文件')
        return
      }
      if (!isOssConfigured()) {
        fail(ctx, 'OSS 未配置，请先配置 OSS_*')
        return
      }
      const imageCheck = validatePublicImageBuffer(file)
      if (!imageCheck.ok) {
        fail(ctx, imageCheck.msg)
        return
      }
      const uploaded = await uploadPublicImage({
        buffer: file.buffer,
        contentType: file.mimetype || 'image/jpeg',
        originalName: file.originalname || `cs${detectImageExtFromMime(file.mimetype)}`,
        scene: 'message',
        phone: s.mallUserId || '',
        biz: 'cs',
      })
      const imageUrl = uploaded.url
      const agentName = resolveCsAgentName(ctx, db)
      csAppendMessage(s, 'agent', '', { type: 'image', imageUrl, agentName })
      writeCsSessionsDb(db)
      ctx.body = success({
        ok: true,
        messages: Array.isArray(s.messages) ? s.messages : [],
      })
    })
  }
  catch (err) {
    const code = err && typeof err === 'object' ? err.code : ''
    const raw = String(err?.message || err || '')
    let msg = '上传失败'
    if (code === 'LIMIT_FILE_SIZE' || raw.includes('LIMIT_FILE_SIZE') || raw.includes('too large')) {
      msg = '图片不能超过 5MB'
    }
    else if (raw.includes('仅支持')) {
      msg = raw
    }
    else if (raw && raw !== 'Error') {
      msg = raw
    }
    fail(ctx, msg, 400)
  }
})

router.post('/uploads/id-card', async (ctx) => {
  try {
    await mallIdCardUpload.single('image')(ctx, async () => {
      if (!isOssConfigured()) {
        fail(ctx, 'OSS 未配置，请在 api/.env.development 或 api/.env.production 设置 OSS_* 变量', 503)
        return
      }
      const file = ctx.file
      if (!file || !file.buffer || !file.originalname) {
        fail(ctx, '请选择图片文件')
        return
      }
      const imageCheck = validateIdCardImageBuffer(file)
      if (!imageCheck.ok) {
        fail(ctx, imageCheck.msg)
        return
      }
      const body = ctx.request.body || {}
      const scene = String(body.scene || '').trim().toLowerCase()
      if (!['front', 'back', 'handheld'].includes(scene)) {
        fail(ctx, 'scene 必须是 front / back / handheld')
        return
      }
      const phone = normalizePhone(body.phone || '')
      const uploaded = await uploadIdCardImage({
        buffer: file.buffer,
        contentType: file.mimetype || 'image/jpeg',
        originalName: file.originalname,
        scene,
        phone,
      })
      ctx.body = success(uploaded)
    })
  }
  catch (err) {
    const code = err && typeof err === 'object' ? err.code : ''
    const raw = String(err?.message || err || '')
    let msg = '上传失败'
    if (code === 'LIMIT_FILE_SIZE' || raw.includes('LIMIT_FILE_SIZE') || raw.includes('too large')) {
      msg = '图片不能超过 5MB'
    }
    else if (raw.includes('仅支持')) {
      msg = raw
    }
    else if (raw === 'oss_not_configured') {
      msg = 'OSS 未配置，请先完善 OSS_* 环境变量'
    }
    else if (raw && raw !== 'Error') {
      msg = raw
    }
    fail(ctx, msg, 400)
  }
})

router.post('/uploads/public-image', async (ctx) => {
  try {
    await mallPublicImageUpload.single('image')(ctx, async () => {
      if (!isOssConfigured()) {
        fail(ctx, 'OSS 未配置，请在 api/.env.development 或 api/.env.production 设置 OSS_* 变量', 503)
        return
      }
      const file = ctx.file
      if (!file || !file.buffer || !file.originalname) {
        fail(ctx, '请选择图片文件')
        return
      }
      const body = ctx.request.body || {}
      const biz = String(body.biz || '').trim().toLowerCase()
      if (!['product', 'cs', 'common'].includes(biz)) {
        fail(ctx, 'biz 必须是 product / cs / common')
        return
      }
      if (biz === 'product' && (ctx.headers.authorization || ctx.headers['x-admin-role'])) {
        const permissionKey = adminProductPermissionKeyForSalesMode(body.salesMode)
        if (!await requireAdminPermission(ctx, [ADMIN_ROLES.SUPER], '上传商品图片', { permissionKey, permissionAction: 'uploadImage' })) {
          return
        }
      }
      const imageCheck = validatePublicImageBuffer(file)
      if (!imageCheck.ok) {
        fail(ctx, imageCheck.msg)
        return
      }
      const scene = String(body.scene || '').trim().toLowerCase() || 'image'
      const phone = normalizePhone(body.phone || '')
      const uploaded = await uploadPublicImage({
        buffer: file.buffer,
        contentType: file.mimetype || 'image/jpeg',
        originalName: file.originalname,
        scene,
        phone,
        biz,
      })
      ctx.body = success(uploaded)
    })
  }
  catch (err) {
    const code = err && typeof err === 'object' ? err.code : ''
    const raw = String(err?.message || err || '')
    let msg = '上传失败'
    if (code === 'LIMIT_FILE_SIZE' || raw.includes('LIMIT_FILE_SIZE') || raw.includes('too large')) {
      msg = '图片不能超过 8MB'
    }
    else if (raw.includes('仅支持')) {
      msg = raw
    }
    else if (raw === 'oss_not_configured') {
      msg = 'OSS 未配置，请先完善 OSS_* 环境变量'
    }
    else if (raw && raw !== 'Error') {
      msg = raw
    }
    fail(ctx, msg, 400)
  }
})

app.use(cors())
app.use(mount('/static', serve(API_PUBLIC_DIR)))
/** 与 /api 同一网关反代时，上传图走 /api/static/...，避免单独配置 /static */
app.use(mount('/api/static', serve(API_PUBLIC_DIR)))
/** 注册等接口含证件 base64，默认 json 1mb 易 413；放宽（前有 Nginx 时仍需调 client_max_body_size） */
app.use(bodyParser({
  jsonLimit: '12mb',
  formLimit: '12mb',
  textLimit: '12mb',
}))

function isManagedApiPath(pathValue) {
  const pathRaw = String(pathValue || '')
  return pathRaw.startsWith('/api/') || isDuodiandianPublicPath(pathRaw)
}

app.use(async (ctx, next) => {
  const tenantId = resolveTenantIdFromRequest(ctx)
  const rawWorkspace = resolveWorkspaceTypeFromRequest(ctx)
  const workspaceType = await clampIncomingWorkspaceType(ctx, tenantId, rawWorkspace)
  ctx.state.tenantId = tenantId
  ctx.state.workspaceType = workspaceType
  ctx.set('x-tenant-id', tenantId)
  ctx.set('x-workspace-type', workspaceType)
  const runNested = async () => {
    await runWithWorkspace(workspaceType, tenantId, async () => {
      await next()
    })
  }
  if (isManagedApiPath(ctx.path) && isMongoPersistenceEnabled()) {
    await runWithMongoRequestDedup(runNested)
  }
  else {
    await runNested()
  }
})
/**
 * Mongo 模式：每个 /api 请求执行业务前检查是否需要 refresh 内存快照。
 * 默认 MONGO_REFRESH_MODE=version：仅 app_meta.updatedAt 变化时才全量读 Mongo；非 every_request 全量读。
 */
app.use(async (ctx, next) => {
  if (isManagedApiPath(ctx.path) && isMongoPersistenceEnabled()) {
    try {
      const tenantId = normalizeTenantId(ctx.state && ctx.state.tenantId ? ctx.state.tenantId : DEFAULT_TENANT_ID)
      const workspaceType = normalizeWorkspaceType(ctx.state && ctx.state.workspaceType ? ctx.state.workspaceType : 'tenant')
      const plan = resolveApiMongoRefreshPlan(ctx)
      if (plan.mode === 'skip') {
        // handler 内直连 Mongo 单集合
      }
      else if (plan.mode === 'partial') {
        await refreshScopePartialFromMongo(workspaceType, tenantId, plan.keys, { allowColdPartial: plan.allowColdPartial })
      }
      else {
        await refreshScopeCacheFromMongo(workspaceType, tenantId)
      }
    }
    catch (err) {
      if (shouldBlockRequestOnMongoRefreshError(ctx.method)) {
        console.error('[mongo] refresh failed before mutation; request blocked:', err?.message || err)
        fail(ctx, '数据库刷新失败，为保护线上数据，本次写入已拦截，请稍后重试', 503)
        return
      }
      // Reads may fall back to the in-memory snapshot; writes must not.
    }
  }
  await next()
})
app.use(async (ctx, next) => {
  if (isManagedApiPath(ctx.path)) {
    try {
      const workspaceType = normalizeWorkspaceType(ctx.state && ctx.state.workspaceType ? ctx.state.workspaceType : 'tenant')
      const headerTenantId = normalizeTenantId(ctx.state && ctx.state.tenantId ? ctx.state.tenantId : DEFAULT_TENANT_ID)
      /**
       * readDb() 随 workspace 指向 mall / mall__core / mall__tenant_x；
       * 若此处始终用请求头 x-tenant-id，则在 core 总部上下文中会把 boss1 等写进 mall__core._meta.knownTenantIds，
       * 全量重置后仍出现「幽灵子系统」行（无任何老板账号、计数为 0）。
       * 仅在实际命中租户业务库（workspace=tenant）时，才把该租户记入当前库的登记元数据。
       */
      const tenantForRegistry = workspaceType === 'tenant' && headerTenantId !== DEFAULT_TENANT_ID
        ? headerTenantId
        : DEFAULT_TENANT_ID
      const db = readDb()
      ensureTenantRegistered(db, tenantForRegistry)
    }
    catch {
      // ignore tenant meta register errors
    }
  }
  await next()
})
/**
 * Mongo 一致性：
 * - 默认：POST/PUT/PATCH/DELETE 在响应结束前 await 当前 workspace 的异步落库，避免下一请求的
 *   refreshScopeCacheFromMongo 读到陈旧快照（线上「要刷新才对齐」）。
 * - MONGO_SKIP_MUTATION_FLUSH=true：关闭上述「仅写请求」等待（追求极限吞吐）。
 * - MONGO_AWAIT_PERSIST=true：所有 /api（含 GET）结束后都等待落库。
 */
app.use(async (ctx, next) => {
  await next()
  if (!isMongoPersistenceEnabled()) {
    return
  }
  const pathRaw = String(ctx.path || '')
  if (!isManagedApiPath(pathRaw)) {
    return
  }
  const awaitAll = mongoConfig.isMongoAwaitPersistEnabled()
  let shouldFlush = awaitAll
  if (!awaitAll && !mongoConfig.isMongoMutationPersistFlushSkipped()) {
    const method = String(ctx.method || 'GET').toUpperCase()
    shouldFlush = method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE'
  }
  if (!shouldFlush) {
    return
  }
  if (ctx.state && ctx.state.mongoPersistFlushed) {
    return
  }
  try {
    await flushMongoPersist()
  }
  catch (err) {
    console.error('[store] Mongo 落库等待失败:', err?.message || err)
  }
})
app.use(router.routes())
app.use(router.allowedMethods())
app.use(duodiandianPublicRouter.routes())
app.use(duodiandianPublicRouter.allowedMethods())
app.use(riskControlRouter.routes())
app.use(riskControlRouter.allowedMethods())

;(async () => {
  let mongoPersistenceActive = false
  try {
    await mongo.connectMongo()
    mongoPersistenceActive = await hydrateFromMongoAfterConnect()
    if (mongoPersistenceActive) {
      console.log(`[mongo] 已启用 MongoDB 持久化（分集合: ${mongo.SHARDED_ENTITY_KEYS.join(', ')}；元数据: ${mongo.APP_META}）`)
      const refreshMode = mongoConfig.getMongoRefreshMode()
      if (refreshMode === 'every_request') {
        console.log('[mongo] MONGO_REFRESH_MODE=every_request：每个 /api 请求全量读 Mongo（默认，可随时回滚）')
      }
      else if (refreshMode === 'version') {
        console.log('[mongo] MONGO_REFRESH_MODE=version：仅 app_meta.updatedAt 变化时全量读 Mongo')
      }
      else if (refreshMode === 'single_instance') {
        console.log('[mongo] MONGO_REFRESH_MODE=single_instance：单进程内跳过跨请求 refresh（勿用于多实例）')
      }
      if (!mongoConfig.isMongoMutationPersistFlushSkipped()) {
        if (mongoConfig.isMongoAwaitPersistEnabled()) {
          console.log('[mongo] MONGO_AWAIT_PERSIST=true：任意 /api 请求结束后等待落库（含 GET）')
        }
        else {
          console.log('[mongo] 写接口（POST/PUT/PATCH/DELETE）结束前等待 Mongo 落库，避免快照读旧；设 MONGO_SKIP_MUTATION_FLUSH=true 仅关闭该项')
        }
      }
      else if (!mongoConfig.isMongoAwaitPersistEnabled()) {
        console.log('[mongo] MONGO_SKIP_MUTATION_FLUSH=true：已跳过写接口结束前的落库等待（可能再现「紧随其后 GET 读旧」）')
      }
    }
  }
  catch (err) {
    if (mongoConfig.isJsonFallbackAllowed()) {
      console.warn('[mongo] 连接或加载失败，将使用本地 data/db.json（ALLOW_JSON_FALLBACK=true）:', err?.message || err)
    }
    else {
      console.error('[mongo] 连接或加载失败:', err?.message || err)
    }
  }

  if (mongoConfig.isMongoRequired()) {
    if (!mongoConfig.isMongoConfigured()) {
      console.error('[mongo] MONGODB_REQUIRED=true 但未配置 MONGODB_URI（可写在 api/.env 或项目根 .env）')
      process.exit(1)
    }
    if (!mongoPersistenceActive || !isMongoPersistenceEnabled()) {
      console.error('[mongo] MONGODB_REQUIRED=true 但未能启用 Mongo 持久化，请检查 URI、白名单与网络')
      process.exit(1)
    }
  }

  if (!mongoPersistenceActive && !mongoConfig.isJsonFallbackAllowed()) {
    console.error(
      '[api] 默认仅使用 MongoDB：未连通或未初始化持久化，且 ALLOW_JSON_FALLBACK≠true。\n'
        + '    请配置 MONGODB_URI 并确保可访问，或在纯本地调试时设置 ALLOW_JSON_FALLBACK=true（将使用 api/data/db.json）。',
    )
    process.exit(1)
  }

  if (!mongoPersistenceActive && mongoConfig.isJsonFallbackAllowed()) {
    console.warn('[api] 已启用 ALLOW_JSON_FALLBACK：使用本地 data/db.json，生产环境请勿开启')
  }

  try {
    const db = readDb()
    ensureProductCatalog(db)
    ensureDuodiandianChannel(db)
    ensureDuodiandianPortalPartner(db)
    reconcileInstallmentCompletionAcrossDb(db)
    writeTrafficChannelsAndPartnersDb(db)
  }
  catch (err) {
    console.warn('[api] 启动时先享后付/订单状态对账失败:', err?.message || err)
  }

  app.listen(PORT, () => {
    console.log(`Mall API listening on http://localhost:${PORT}/api`)
    console.log(`Risk control API prefix http://localhost:${PORT}${RISK_CONTROL_PREFIX}`)
    console.log(`Static files http://localhost:${PORT}/static/ (→ ${API_PUBLIC_DIR})`)
  })
})()
