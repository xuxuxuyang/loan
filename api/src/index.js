const { loadDotenvExports } = require('./loadEnv')
loadDotenvExports(__dirname)

const cloudConfig = require('./cloudConfig')
const mongoConfig = require('./mongoConfig')
const mongo = require('./mongo')

const Koa = require('koa')
const Router = require('@koa/router')
const bodyParser = require('koa-bodyparser')
const cors = require('@koa/cors')
const {
  readDb,
  writeDb,
  resetDb,
  hydrateFromMongoAfterConnect,
  hydrateTenantDbFromMongo,
  hasScopeCache,
  isMongoPersistenceEnabled,
  flushMongoPersist,
  evictTenantMemoryCache,
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
  runOrderSubmitUpstreamRiskPack,
  runOrderSubmitSingleRiskStep,
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

const app = new Koa()
const router = new Router({ prefix: '/api' })
const PORT = Number(process.env.PORT || 3110)
/** GET /static/* → api/public/*（卡包合同模板 PDF 等，供电子签上游按 URL 拉取；本地 mock 下载 PDF 由程序按订单动态生成，不读该目录） */
const API_PUBLIC_DIR = path.join(__dirname, '..', 'public')

const mallIdCardUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
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
  limits: { fileSize: 8 * 1024 * 1024 },
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
const MALL_PASSWORD_PEPPER = 'mall-local-pepper-v1'
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
/** 商城用户注册及未填写额度时的默认先享后付可用额度（元） */
const DEFAULT_USER_QUOTA = 2750

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

function countApprovedOrdersForUserPhone(db, phone) {
  const userOrders = db.orders.filter(item => orderReceiverPhoneMatches(phone, item.receiverPhone))
  return userOrders.filter(item => item.status !== 'reviewing').length
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

function readRawAdminAccountsByWorkspace(workspaceType, tenantId) {
  return runWithWorkspace(workspaceType, tenantId, () => {
    const db = readDb()
    const rows = Array.isArray(db.adminAccounts) ? db.adminAccounts : []
    return rows
      .map(normalizeAdminAccount)
      .filter(item => item && item.username)
  })
}

function migrateLegacyMainAccountsToCore() {
  return runWithWorkspace('core', DEFAULT_TENANT_ID, () => {
    const coreDb = readDb()
    ensureAdminAccounts(coreDb)
    const existingByUsername = new Set(coreDb.adminAccounts.map(item => String(item.username || '').trim()))
    const existingByPhone = new Set(coreDb.adminAccounts.map(item => normalizePhone(item.phone)).filter(Boolean))

    const legacyTenantDefaultAccounts = readRawAdminAccountsByWorkspace('tenant', DEFAULT_TENANT_ID)
    const legacySelfAccounts = readRawAdminAccountsByWorkspace('self', DEFAULT_TENANT_ID)
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
      writeDb(coreDb)
    }
    return appended
  })
}

function readDbByTenantId(tenantId) {
  return runWithTenant(normalizeTenantId(tenantId || DEFAULT_TENANT_ID), () => {
    const db = readDb()
    ensureAdminAccounts(db)
    return db
  })
}

function deleteTenantScopedAdminAccountInTenantDbById(tenantId, accountId) {
  return runWithTenant(normalizeTenantId(tenantId || DEFAULT_TENANT_ID), () => {
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
    writeDb(db)
    return { found: true, deleted: true, target }
  })
}

function readCoreDb() {
  return runWithWorkspace('core', DEFAULT_TENANT_ID, () => {
    const db = readDb()
    ensureAdminAccounts(db)
    return db
  })
}

function writeCoreDb(db) {
  runWithWorkspace('core', DEFAULT_TENANT_ID, () => {
    writeDb(db)
  })
}

function getAdminAccountByPhoneAcrossTenants(phone, preferredTenantId) {
  const preferred = normalizeTenantId(preferredTenantId || DEFAULT_TENANT_ID)
  const dbPreferred = readDbByTenantId(preferred)
  const foundPreferred = getAdminAccountByPhone(dbPreferred, phone)
  if (foundPreferred) {
    return foundPreferred
  }
  const searched = new Set([preferred])
  const dbCore = readCoreDb()
  const foundCore = getAdminAccountByPhone(dbCore, phone)
  if (foundCore) {
    return foundCore
  }
  const known = collectKnownTenantIds()
  for (const tenantId of known) {
    if (searched.has(tenantId)) {
      continue
    }
    const db = readDbByTenantId(tenantId)
    const found = getAdminAccountByPhone(db, phone)
    if (found) {
      return found
    }
  }
  return null
}

function getAdminAccountByUsernameAcrossTenants(username, preferredTenantId) {
  const preferred = normalizeTenantId(preferredTenantId || DEFAULT_TENANT_ID)
  const dbPreferred = readDbByTenantId(preferred)
  const foundPreferred = getAdminAccountByUsername(dbPreferred, username)
  if (foundPreferred) {
    return foundPreferred
  }
  const searched = new Set([preferred])
  const dbCore = readCoreDb()
  const foundCore = getAdminAccountByUsername(dbCore, username)
  if (foundCore) {
    return foundCore
  }
  const known = collectKnownTenantIds()
  for (const tenantId of known) {
    if (searched.has(tenantId)) {
      continue
    }
    const db = readDbByTenantId(tenantId)
    const found = getAdminAccountByUsername(db, username)
    if (found) {
      return found
    }
  }
  return null
}

/**
 * core/self 映射到独立 MongoDB，仅信任 Authorization 中 Bearer 对应「平台 scope」且状态为 active 的后台账号；
 * 子系统后台、商城会话或伪造 x-workspace-type 时一律回落到 tenant 库，避免未授权读平台库。
 */
function isPlatformAdminBearerForWorkspace(ctx, preferredTenantId) {
  const phone = normalizePhone(parsePhoneFromToken(ctx.headers && ctx.headers.authorization))
  if (!phone) {
    return false
  }
  const account = getAdminAccountByPhoneAcrossTenants(
    phone,
    normalizeTenantId(preferredTenantId || DEFAULT_TENANT_ID),
  )
  return Boolean(account && account.scopeType === 'platform' && account.status === 'active')
}

function clampIncomingWorkspaceType(ctx, tenantId, workspaceType) {
  const ws = normalizeWorkspaceType(workspaceType)
  if (ws !== 'core' && ws !== 'self') {
    return ws
  }
  return isPlatformAdminBearerForWorkspace(ctx, tenantId) ? ws : 'tenant'
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

function resolveAdminRole(ctx) {
  if (ctx.state && ctx.state._resolvedAdminRole) {
    return ctx.state.adminRole || ''
  }
  const requestTenantId = normalizeTenantId(ctx.state && ctx.state.tenantId ? ctx.state.tenantId : DEFAULT_TENANT_ID)
  const tokenPhone = normalizePhone(parsePhoneFromToken(ctx.headers.authorization))
  const tokenAccount = tokenPhone ? getAdminAccountByPhoneAcrossTenants(tokenPhone, requestTenantId) : null
  const tokenPhoneRole = tokenAccount ? tokenAccount.role : ''
  if (tokenPhoneRole) {
    ctx.state.adminRole = tokenPhoneRole
    ctx.state.adminAccount = tokenAccount
    ctx.state._resolvedAdminRole = true
    return ctx.state.adminRole
  }

  const headerPhone = normalizePhone(ctx.headers['x-admin-phone'] || ctx.headers['x-user-phone'])
  const headerPhoneAccount = headerPhone ? getAdminAccountByPhoneAcrossTenants(headerPhone, requestTenantId) : null
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

function resolveAdminAccount(ctx) {
  if (ctx.state && ctx.state._resolvedAdminAccount) {
    return ctx.state.adminAccount || null
  }
  resolveAdminRole(ctx)
  ctx.state._resolvedAdminAccount = true
  return ctx.state.adminAccount || null
}

function roleMatchesAllowedRoles(role, allowedRoles) {
  if (!role || !Array.isArray(allowedRoles)) return false
  if (allowedRoles.includes(role)) return true
  if (isSuperEquivalentRole(role) && allowedRoles.some(a => isSuperEquivalentRole(a))) return true
  return false
}

function enforcePlatformReadonlyForTenantWrite(ctx, actionLabel) {
  const account = resolveAdminAccount(ctx)
  if (!account || account.scopeType !== 'platform') {
    return true
  }
  // 新策略：主系统平台账号拥有子系统完整权限（读/写/删）。
  void actionLabel
  return true
}

function requireAdminPermission(ctx, allowedRoles, actionLabel) {
  const role = resolveAdminRole(ctx)
  if (!role) {
    fail(
      ctx,
      `未提供后台角色信息，无法执行${actionLabel}。请在请求头传 x-admin-role: super_admin / boss / reviewer / collector`,
      401,
    )
    return ''
  }
  if (!ADMIN_ROLE_SET.has(role) || !roleMatchesAllowedRoles(role, allowedRoles)) {
    fail(ctx, `当前角色【${getRoleLabel(role)}】无权限执行${actionLabel}`, 403)
    return ''
  }
  const account = resolveAdminAccount(ctx)
  if (!account) {
    fail(ctx, '未识别到有效后台账号，请重新登录', 401)
    return ''
  }
  if (account.scopeType === 'platform') {
    if (!resolveEffectiveTenantId(ctx)) {
      return ''
    }
    if (!enforcePlatformReadonlyForTenantWrite(ctx, actionLabel)) {
      return ''
    }
    return role || ADMIN_ROLES.SUPER
  }
  if (!resolveEffectiveTenantId(ctx)) {
    return ''
  }
  if (!enforcePlatformReadonlyForTenantWrite(ctx, actionLabel)) {
    return ''
  }
  return role
}

function resolveEffectiveTenantId(ctx) {
  const requestTenant = normalizeTenantId(ctx.state && ctx.state.tenantId ? ctx.state.tenantId : 'default')
  const requestWorkspaceType = normalizeWorkspaceType(ctx.state && ctx.state.workspaceType ? ctx.state.workspaceType : 'tenant')
  const account = resolveAdminAccount(ctx)
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
    writeDb(db)
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

function buildOrderRiskDetail(order) {
  ensureOrderRiskState(order)
  const totalAmount = Number(order.totalAmount || 0)
  const periods = Number(order.installmentPeriods || (Array.isArray(order.installmentPlan) ? order.installmentPlan.length : 1) || 1)
  const phoneTail = Number(String(order.receiverPhone || '').slice(-2) || '0')
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
      detail: `手机号尾号 ${String(order.receiverPhone || '').slice(-2) || '--'} 参与辅助评分`,
    },
  ]

  const factors = [
    `订单金额：¥${totalAmount}`,
    `支付方式：${order.payType === 'installment' ? '先享后付' : '全款'}`,
    `先享后付期数：${periods} 期`,
    `手机号尾号：${String(order.receiverPhone || '').slice(-2) || '--'}`,
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

  /** 仅支持单期：应还总额=订单 totalAmount（与商品小计一致），还款日为下单后第 14 天 */
  const principal = Number(parsedAmount.toFixed(2))
  return [{
    period: 1,
    dueDate: addDays(createdAt, 14),
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
    order.createdAt,
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
    /** 卡包已发放即视为订单生命周期已完成：不因分期未结清而回退到待收货/待发货（与后台、商城展示一致） */
    if (order.cardPackageIssued) {
      return false
    }
    ensureOrderShipment(order)
    const tn = String(order.trackingNumber || '').trim()
    order.status = tn ? 'receiving' : 'shipping'
    return true
  }
  return false
}

/** 幂等：历史数据或旧逻辑下「卡包已发但 status 仍为 shipping/receiving」时对齐为 enjoying */
function reconcileCardPackageIssuedToEnjoying(order) {
  ensureOrderCardPackage(order)
  if (order.payType !== 'installment' || !order.cardPackageIssued) {
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
 * 在 GET /orders 等读库路径上幂等执行，单次 writeDb 与 reconcileInstallmentCompletionAcrossDb 合并。
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
      order.createdAt,
      prevPaid,
      order.installmentPeriods,
    )
    changed = true
  }
  return changed
}

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
  }
  if (changed) {
    writeDb(db)
  }
}

/**
 * 订单卡包金额（元）：已落库则规范化；否则按商品卡包金额 × 数量回填（幂等，供对账写库）。
 * @returns {boolean} 是否写入了与之前不同的值
 */
function ensureOrderCardPackageAmountFromProduct(db, order) {
  const qty = Math.max(1, Math.floor(Number(order.quantity)) || 1)
  let resolved = 0
  const pid = String(order.productId || '').trim()
  if (pid) {
    const raw = (Array.isArray(db.products) ? db.products : []).find(p => p && String(p.id) === pid)
    if (raw) {
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
  const xfProto = String(ctx.get('x-forwarded-proto') || '').trim().split(',')[0]
  const xfHost = String(ctx.get('x-forwarded-host') || '').trim().split(',')[0]
  if (xfHost) {
    return `${xfProto || 'https'}://${xfHost}`
  }
  if (typeof ctx.origin === 'string' && ctx.origin) {
    return ctx.origin
  }
  return `${ctx.protocol}://${ctx.host}`
}

/** 模拟签署：带用户信息 + 确认按钮的 HTML 页（非静态 PDF） */
function mallCardPackageMockSignPageUrl(ctx, orderId, phone) {
  const oid = encodeURIComponent(String(orderId || '').trim())
  const ph = encodeURIComponent(String(phone || '').trim())
  return `${mallCardPackagePublicOrigin(ctx)}/api/card-packages/${oid}/contract-view?phone=${ph}`
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
      })
      await fsp.writeFile(path.join(MOCK_CARD_PACKAGE_PDF_CACHE_DIR, filename), buf).catch((e) => {
        console.warn('[card-package-pdf-cache-write]', e && e.message ? String(e.message) : e)
      })
      const prev = String(order.cardPackageContractPdfCacheFile || '').trim()
      order.cardPackageContractPdfCacheFile = filename
      if (prev && prev !== filename && /^cpdf-[a-f0-9]{32}\.pdf$/i.test(prev)) {
        await fsp.unlink(path.join(MOCK_CARD_PACKAGE_PDF_CACHE_DIR, prev)).catch(() => {})
      }
      writeDb(db)
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
  const order = db.orders.find(item => item.id === id)
  if (!order || !orderReceiverPhoneMatches(phone, order.receiverPhone)) {
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

function platformAuditRecord(ctx, action, detail = {}) {
  try {
    const account = resolveAdminAccount(ctx)
    if (!account || account.scopeType !== 'platform') {
      return
    }
    const db = readCoreDb()
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
    writeCoreDb(db)
  }
  catch {
    // ignore audit write failures
  }
}

function requirePlatformScope(ctx, actionLabel = '访问平台接口') {
  const role = requireAdminPermission(ctx, [ADMIN_ROLES.SUPER, ADMIN_ROLES.BOSS], actionLabel)
  if (!role) {
    return null
  }
  const account = resolveAdminAccount(ctx)
  if (!account || account.scopeType !== 'platform') {
    fail(ctx, '仅平台账号可访问该接口', 403)
    return null
  }
  return account
}

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '')
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

/** 订单收货手机号与登录 query.phone（已 normalize）一致比较，避免空格/格式导致还款找不到订单 */
function orderReceiverPhoneMatches(phoneNorm, receiverPhone) {
  if (!/^1\d{10}$/.test(String(phoneNorm || ''))) {
    return false
  }
  return normalizePhone(receiverPhone || '') === phoneNorm
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

/**
 * 完成「协商支付」首段：本期应还更新为剩余本金与协商还款日，清除 negotiationPayPending，末条协商记录写入 userPaidAt。
 * @returns {{ ok: true } | { ok: false, msg: string }}
 */
function applyInstallmentNegotiationPayCompleted(planItem) {
  const pend = planItem.negotiationPayPending
  if (!pend || !Number.isFinite(Number(pend.negotiatedAmount)) || Number(pend.negotiatedAmount) <= 0) {
    return { ok: false, msg: '暂无待支付的协商款项' }
  }
  const remainder = Number(Number(pend.remainderAmount || 0).toFixed(2))
  const remainderDue = normalizeNegotiateRemainderDueDate(pend.remainderDueDate)
  if (remainder <= 0 || !remainderDue || !/^\d{4}-\d{2}-\d{2}$/.test(remainderDue)) {
    return { ok: false, msg: '协商待支付数据异常，请联系客服' }
  }
  const hist = planItem.negotiationHistory
  const last = Array.isArray(hist) && hist.length > 0 ? hist[hist.length - 1] : null
  if (last && !String(last.originalDueDate || '').trim()) {
    last.originalDueDate = String(planItem.dueDate || '').trim()
  }
  planItem.amount = remainder
  planItem.principal = remainder
  planItem.dueDate = remainderDue
  planItem.negotiationPayPending = null
  if (last) {
    last.userPaidAt = new Date().toISOString()
  }
  return { ok: true }
}

/**
 * 撤销末条「协商支付」完成态：恢复 negotiationPayPending 与本期应还总额、还款日（依赖 originalDueDate 或 remainderDueDate）
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
  const rem = Number(Number(last.remainderAmount || 0).toFixed(2))
  const curAmt = Number(Number(planItem.amount || 0).toFixed(2))
  if (Math.abs(curAmt - rem) > 0.02) {
    return { ok: false, msg: '本期金额与协商记录不一致，无法撤销' }
  }
  planItem.negotiationPayPending = {
    negotiatedAmount: nAmt,
    remainderAmount: rem,
    remainderDueDate: String(last.remainderDueDate || '').trim(),
    createdAt: String(last.createdAt || new Date().toISOString()),
  }
  const fullAmt = Number((nAmt + rem).toFixed(2))
  planItem.amount = fullAmt
  planItem.principal = fullAmt
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
  const remainderAmount = Number(Number(last.remainderAmount || 0).toFixed(2))
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
  const raw = String(
    payload.channel != null
      ? payload.channel
      : (payload.registerChannelCode != null ? payload.registerChannelCode : ''),
  ).trim()
  if (!raw || !TRAFFIC_CHANNEL_CODE_RE.test(raw)) {
    return null
  }
  const ch = db.trafficChannels.find(
    c => c && String(c.code) === raw && !c.disabled,
  )
  if (!ch) {
    return null
  }
  return {
    code: String(ch.code),
    name: String(ch.name || '').trim(),
  }
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
  nextUser.emergencyContacts = []
  db.users.unshift(nextUser)
  return nextUser
}

function attachUserOrderStats(db, user, opts = {}) {
  const userOrders = db.orders.filter(item => orderReceiverPhoneMatches(user.phone, item.receiverPhone))
  /** 管理端展示：仅计审核通过后的订单；待审核 reviewing 不计入订单数与成交累计 */
  const approvedOrders = userOrders.filter(item => item.status !== 'reviewing')
  let lastOrderAt = ''
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
  const mall = Boolean(opts.mall)
  const emList = normalizeEmergencyContactsList(user.emergencyContacts)
  const base = {
    ...sanitizeMallUser(user, { mall }),
    quota: normalizeUserQuota(user.quota),
    orderCount: approvedOrders.length,
    totalAmount: Number(approvedOrders.reduce((sum, item) => sum + Number(item.totalAmount || 0), 0).toFixed(2)),
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
    base.registerChannelCode = code
    /** 注册时的渠道名称快照；老数据可能为空 */
    base.registerChannelName = storedName
    /** 列表/详情展示：快照优先，否则当前渠道库名称，再无则 code */
    base.registerChannelLabel = label
  }
  return base
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
  const userOrders = db.orders.filter(item => orderReceiverPhoneMatches(phone, item.receiverPhone))
  const userCards = db.bankCards.filter(item => normalizePhone(item.userPhone || '') === phone)

  const mallSummaryStatus = (item) => {
    ensureOrderCardPackage(item)
    if (item.payType === 'installment' && item.cardPackageIssued) {
      return 'enjoying'
    }
    return item.status
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
    const url = new URL('https://nominatim.openstreetmap.org/reverse')
    url.searchParams.set('format', 'jsonv2')
    url.searchParams.set('lat', String(lat))
    url.searchParams.set('lon', String(lng))
    url.searchParams.set('accept-language', 'zh-CN')
    /** zoom 越高细节越多：18 接近道路/建筑级 */
    url.searchParams.set('zoom', '18')
    const res = await fetch(url.toString(), {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'tea-mall-registration/1.0 (dev)',
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
        /** 若仍为 true，说明尚未完成迁移或存在旧数据，应重启 api 或执行 import:mongo-local */
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

router.post('/admin/reset-data', (ctx) => {
  if (!requireAdminPermission(ctx, [ADMIN_ROLES.SUPER], '重置数据')) {
    return
  }
  const db = resetDb()
  ensureProductCatalog(db)
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
    salesMode: salesModeQ = '',
  } = ctx.query
  const categoryKey = String(category || '').trim()
  const searchKey = String(keyword || '').trim()
  const showAll = includeAll === '1'
  const salesMode = String(salesModeQ || ctx.query.zone || '').trim()
  const list = db.products
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

  const existing = db.users.find(item => item.phone === phone)
  if (existing) {
    fail(ctx, '该手机号已注册，请直接登录', 409)
    return
  }

  const smsCheck = verifyAndConsumeRegisterSms(phone, payload.smsCode)
  if (!smsCheck.ok) {
    fail(ctx, smsCheck.reason)
    return
  }

  const user = createMallUserFromRegisterPayload(db, payload)
  writeDb(db)
  ctx.body = success(attachUserOrderStats(db, user, { mall: true }))
})

router.post('/auth/login', (ctx) => {
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

function handleAdminLogin(ctx) {
  const payload = ctx.request.body || {}
  const username = String(payload.username || '').trim()
  const password = String(payload.password || '').trim()
  const requestTenantId = normalizeTenantId(ctx.state && ctx.state.tenantId ? ctx.state.tenantId : DEFAULT_TENANT_ID)
  const account = getAdminAccountByUsernameAcrossTenants(username, requestTenantId)
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

  const db = readDbByTenantId(effectiveTenant)

  const allowAutoSeedUser = effectiveTenant === DEFAULT_TENANT_ID
  const existed = db.users.find(item => item.phone === account.phone)
  if (allowAutoSeedUser && !existed) {
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
      creditStatus: '待风控',
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
    scopeType: account.scopeType || 'tenant',
    tenantId: normalizeTenantId(account.tenantId || 'default'),
    tenantName: effectiveTenant === DEFAULT_TENANT_ID ? '主系统' : effectiveTenant,
    scopeTenantIds: effectiveScopeTenantIds(account),
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
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  }
}

function isBossAccount(account) {
  return normalizeAdminRole(account && account.role ? account.role : '') === ADMIN_ROLES.BOSS
}

function listTenantAdminAccountsForValidation(extraTenantIds = []) {
  const set = new Set(collectKnownTenantIds())
  extraTenantIds
    .map(item => normalizeTenantId(item))
    .filter(item => item && item !== DEFAULT_TENANT_ID)
    .forEach(item => set.add(item))
  const rows = []
  for (const tenantId of set) {
    const db = readDbByTenantId(tenantId)
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

function findDuplicatedBossUsername(username, extraTenantIds = [], excludeAccountId = '') {
  const key = String(username || '').trim()
  if (!key) return null
  const rows = listTenantAdminAccountsForValidation(extraTenantIds)
  return rows.find(({ account }) => {
    if (!account || account.id === excludeAccountId) return false
    if (!isBossAccount(account)) return false
    return String(account.username || '').trim() === key
  }) || null
}

function findDuplicatedBossPhone(phone, extraTenantIds = [], excludeAccountId = '') {
  const key = normalizePhone(phone)
  if (!key) return null
  const rows = listTenantAdminAccountsForValidation(extraTenantIds)
  return rows.find(({ account }) => {
    if (!account || account.id === excludeAccountId) return false
    if (!isBossAccount(account)) return false
    return normalizePhone(account.phone) === key
  }) || null
}

function createTenantScopedAdminAccount(targetTenantId, payload) {
  return runWithTenant(targetTenantId, () => {
    const db = readDb()
    ensureAdminAccounts(db)
    const username = String(payload.username || '').trim()
    const phone = normalizePhone(payload.phone)
    const role = normalizeAdminRole(payload.role)
    if (role === ADMIN_ROLES.BOSS) {
      const duplicatedBossUsername = findDuplicatedBossUsername(username, [targetTenantId])
      if (duplicatedBossUsername) {
        return { ok: false, code: 409, msg: '老板账号已存在，请更换账号' }
      }
      const duplicatedBossPhone = findDuplicatedBossPhone(phone, [targetTenantId])
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
      tenantId: targetTenantId,
      scopeTenantIds: [targetTenantId],
      createdAt: now,
      updatedAt: now,
    })
    db.adminAccounts.unshift(next)
    writeDb(db)
    return { ok: true, account: next }
  })
}

function createPlatformScopedAdminAccount(payload) {
  return runWithWorkspace('core', DEFAULT_TENANT_ID, () => {
    const db = readCoreDb()
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
      createdAt: now,
      updatedAt: now,
    })
    db.adminAccounts.unshift(next)
    writeCoreDb(db)
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
    writeDb(db)
  }
  return true
}

function registerKnownTenantId(tenantId) {
  const nextTenantId = normalizeTenantId(tenantId || DEFAULT_TENANT_ID)
  runWithWorkspace('core', DEFAULT_TENANT_ID, () => {
    const db = readDb()
    ensureTenantRegistered(db, nextTenantId)
  })
}

function unregisterKnownTenantId(tenantId) {
  const nextTenantId = normalizeTenantId(tenantId || DEFAULT_TENANT_ID)
  if (!nextTenantId || nextTenantId === DEFAULT_TENANT_ID) {
    return false
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
    writeDb(db)
    return true
  })
}

function collectKnownTenantIds() {
  const set = new Set()
  const dbCore = readCoreDb()
  parseKnownTenantIdsFromMeta(dbCore._meta)
    .filter(id => id !== DEFAULT_TENANT_ID)
    .forEach(id => set.add(id))
  return [...set]
}

async function collectKnownTenantIdsForPlatform() {
  const set = new Set(collectKnownTenantIds())
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
  const out = [...set].filter(id => id !== DEFAULT_TENANT_ID)
  runWithWorkspace('core', DEFAULT_TENANT_ID, () => {
    const db = readDb()
    const known = parseKnownTenantIdsFromMeta(db._meta).filter(id => id !== DEFAULT_TENANT_ID)
    const merged = [...new Set([...known, ...out])]
    if (merged.length !== known.length || merged.some((item, idx) => known[idx] !== item)) {
      writeKnownTenantIdsMeta(db, merged)
      writeDb(db)
    }
  })
  return out
}

async function readTenantAdminAccountsFromMongo(tenantId) {
  if (!mongo.getMongoClient || !mongo.getMongoClient()) {
    return null
  }
  try {
    const t = normalizeTenantId(tenantId || DEFAULT_TENANT_ID)
    const cfg = mongoConfig.getMongoConfig()
    const dbName = String(cfg.dbName || 'mall').trim() || 'mall'
    const scopedDbName = t === DEFAULT_TENANT_ID ? dbName : `${dbName}__tenant_${t}`
    const client = mongo.getMongoClient()
    const docs = await client.db(scopedDbName).collection(mongo.COLLECTIONS.adminAccounts).find({}).toArray()
    return docs
      .map((doc) => {
        if (!doc || typeof doc !== 'object') {
          return null
        }
        const { _id, ...rest } = doc
        const id = _id !== undefined && _id !== null ? _id : rest.id
        return normalizeAdminAccount({ ...rest, id })
      })
      .filter(Boolean)
  }
  catch {
    return null
  }
}

async function findGlobalBossConflict({ username, phone, excludeAccountId = '' }) {
  const usernameKey = String(username || '').trim()
  const phoneKey = normalizePhone(phone)
  const known = await collectKnownTenantIdsForPlatform()
  const tenantIds = [...new Set(known.filter(id => id && id !== DEFAULT_TENANT_ID))]

  for (const tenantId of tenantIds) {
    const mongoAccounts = await readTenantAdminAccountsFromMongo(tenantId)
    const sourceAccounts = Array.isArray(mongoAccounts)
      ? mongoAccounts
      : (() => {
          const db = readDbByTenantId(tenantId)
          ensureAdminAccounts(db)
          return db.adminAccounts
        })()
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

  const coreDb = readCoreDb()
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

router.get('/admin/accounts', (ctx) => {
  if (!requireAdminPermission(ctx, [ADMIN_ROLES.SUPER], '查看后台账号')) {
    return
  }
  const db = readDb()
  ensureAdminAccounts(db)
  const scopeTypeQuery = String(ctx.query?.scopeType || '').trim()
  let list = db.adminAccounts
    .map(toAdminAccountView)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
  if (scopeTypeQuery === 'platform' || scopeTypeQuery === 'tenant') {
    list = list.filter(item => item.scopeType === scopeTypeQuery)
  }
  const currentAccount = resolveAdminAccount(ctx)
  if (!currentAccount || currentAccount.scopeType !== 'platform') {
    list = list.filter(item => item.scopeType !== 'platform')
  }
  ctx.body = success(list)
})

router.post('/admin/accounts', async (ctx) => {
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
  const currentAccount = resolveAdminAccount(ctx)
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
    const created = createTenantScopedAdminAccount(finalTenantId, {
      username,
      password,
      role,
      phone,
      name,
    })
    if (!created.ok) {
      fail(ctx, created.msg, created.code)
      return
    }
    registerKnownTenantId(finalTenantId)
    ctx.body = success(toAdminAccountView(created.account))
    return
  }
  if (!currentAccount || currentAccount.scopeType !== 'platform') {
    fail(ctx, '仅主系统账号可创建平台账号', 403)
    return
  }
  const created = createPlatformScopedAdminAccount({
    username,
    password,
    role,
    phone,
    name,
    scopeTenantIds,
  })
  if (!created.ok) {
    fail(ctx, created.msg, created.code)
    return
  }
  ctx.body = success(toAdminAccountView(created.account))
})

router.patch('/admin/accounts/:id', async (ctx) => {
  if (!requireAdminPermission(ctx, [ADMIN_ROLES.SUPER], '修改后台账号')) {
    return
  }
  const db = readDb()
  ensureAdminAccounts(db)
  const { id } = ctx.params
  const payload = ctx.request.body || {}
  const currentAccount = resolveAdminAccount(ctx)
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
  const currentAccount = resolveAdminAccount(ctx)
  const isPlatformOperator = Boolean(currentAccount && currentAccount.scopeType === 'platform')
  const role = resolveAdminRole(ctx)
  const canCrossTenantCleanup = isPlatformOperator || isSuperEquivalentRole(role)
  const target = db.adminAccounts.find(item => item.id === id)
  if (!target) {
    if (!canCrossTenantCleanup) {
      fail(ctx, '后台账号不存在', 404)
      return
    }
    // 平台兜底：历史脏数据可能落在其他子系统库，按已知子系统逐库删除同 ID 子系统账号
    const knownTenantIds = collectKnownTenantIds()
    for (const tenantId of knownTenantIds) {
      const result = deleteTenantScopedAdminAccountInTenantDbById(tenantId, id)
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
  writeDb(db)
  ctx.body = success({ id })
})

router.get('/platform/tenants', async (ctx) => {
  const account = requirePlatformScope(ctx, '查看子系统列表')
  if (!account) {
    return
  }
  const known = await collectKnownTenantIdsForPlatform()
  const createdAtById = parseTenantCreatedAtMapFromMeta(readCoreDb()._meta)
  const allow = effectiveScopeTenantIds(account)
  const visibleAll = allow.includes('*')
    ? known
    : known.filter(item => allow.includes(item))
  const visible = visibleAll.filter(item => item !== DEFAULT_TENANT_ID)
  const list = visible
    .map((tenantId) => {
      const db = readDbByTenantId(tenantId)
      const createdAt = createdAtById[tenantId] || null
      return {
        tenantId,
        tenantName: tenantId === DEFAULT_TENANT_ID ? '主系统' : tenantId,
        userCount: Array.isArray(db.users) ? db.users.length : 0,
        orderCount: Array.isArray(db.orders) ? db.orders.length : 0,
        productCount: Array.isArray(db.products) ? db.products.length : 0,
        createdAt,
      }
    })
    .sort((a, b) => {
      const ta = new Date(String(a.createdAt || '')).getTime()
      const tb = new Date(String(b.createdAt || '')).getTime()
      const va = Number.isFinite(ta) ? ta : 0
      const vb = Number.isFinite(tb) ? tb : 0
      if (vb !== va) return vb - va
      return a.tenantId.localeCompare(b.tenantId)
    })
  platformAuditRecord(ctx, 'platform.tenants.list', { visibleTenantCount: list.length })
  ctx.body = success(list)
})

router.post('/platform/tenants', async (ctx) => {
  const account = requirePlatformScope(ctx, '新增子系统')
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
  registerKnownTenantId(tenantId)
  const dbAfterRegister = readCoreDb()
  const createdAtById = parseTenantCreatedAtMapFromMeta(dbAfterRegister._meta)
  const createdAt = createdAtById[tenantId] || new Date().toISOString()
  platformAuditRecord(ctx, 'platform.tenants.create', { tenantId, createdAt })
  ctx.body = success({
    tenantId,
    tenantName: tenantId,
    createdAt,
  })
})

router.post('/platform/tenants/onboard', async (ctx) => {
  const account = requirePlatformScope(ctx, '一体化开通子系统')
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

  registerKnownTenantId(tenantId)
  try {
    const created = createTenantScopedAdminAccount(tenantId, {
      username,
      password,
      role,
      phone,
      name,
    })
    if (!created.ok) {
      fail(ctx, created.msg, created.code)
      void unregisterKnownTenantId(tenantId)
      return
    }
    const dbAfterRegister = readCoreDb()
    const createdAtById = parseTenantCreatedAtMapFromMeta(dbAfterRegister._meta)
    const createdAt = createdAtById[tenantId] || new Date().toISOString()
    platformAuditRecord(ctx, 'platform.tenants.onboard', { tenantId, createdAt, username })
    ctx.body = success({
      tenantId,
      tenantName: tenantId,
      createdAt,
      bossAccount: toAdminAccountView(created.account),
    })
  }
  catch (error) {
    void unregisterKnownTenantId(tenantId)
    fail(ctx, error instanceof Error ? error.message : '开通失败，已自动回滚', 500)
  }
})

router.delete('/platform/tenants/:tenantId', async (ctx) => {
  const account = requirePlatformScope(ctx, '回滚子系统')
  if (!account) {
    return
  }
  const tenantId = normalizeTenantId(ctx.params?.tenantId || '')
  if (!tenantId || tenantId === DEFAULT_TENANT_ID) {
    fail(ctx, 'tenantId 不合法')
    return
  }
  const tenantDb = readDbByTenantId(tenantId)
  const hasTenantData = Boolean(
    (Array.isArray(tenantDb.users) && tenantDb.users.length)
    || (Array.isArray(tenantDb.orders) && tenantDb.orders.length)
    || (Array.isArray(tenantDb.products) && tenantDb.products.length)
    || (Array.isArray(tenantDb.adminAccounts) && tenantDb.adminAccounts.length),
  )
  if (hasTenantData) {
    fail(ctx, '子系统已存在数据，不允许回滚删除', 409)
    return
  }
  let droppedMongoDb = false
  const client = mongo.getMongoClient && mongo.getMongoClient()
  if (client) {
    try {
      const dbName = String(mongoConfig.getMongoConfig().dbName || 'mall').trim() || 'mall'
      const scopedName = `${dbName}__tenant_${tenantId}`
      await client.db(scopedName).dropDatabase()
      droppedMongoDb = true
    }
    catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!/not found|does not exist|ns not found/i.test(msg)) {
        fail(ctx, `删除子系统数据库失败：${msg}`, 502)
        return
      }
    }
  }
  const removed = unregisterKnownTenantId(tenantId)
  if (!removed && !droppedMongoDb) {
    fail(ctx, '子系统系统不存在或已被回滚', 404)
    return
  }
  evictTenantMemoryCache(tenantId)
  platformAuditRecord(ctx, 'platform.tenants.rollback', { tenantId })
  ctx.body = success({ tenantId })
})

router.get('/platform/dashboard/summary', async (ctx) => {
  const account = requirePlatformScope(ctx, '查看总部汇总')
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
    const db = readDbByTenantId(tenantId)
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
  platformAuditRecord(ctx, 'platform.dashboard.summary', {
    tenantCount: visible.length,
    totalUsers,
    totalOrders,
    totalProducts,
  })
})

router.get('/platform/audit-logs', (ctx) => {
  const account = requirePlatformScope(ctx, '查看平台审计日志')
  if (!account) {
    return
  }
  const limitRaw = Number(ctx.query?.limit || 100)
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, Math.floor(limitRaw))) : 100
  const db = readCoreDb()
  const logs = db?._meta && Array.isArray(db._meta.platformAuditLogs)
    ? db._meta.platformAuditLogs.slice(0, limit)
    : []
  platformAuditRecord(ctx, 'platform.audit.list', { limit, returned: logs.length })
  ctx.body = success(logs)
})

router.get('/platform/admin-accounts', async (ctx) => {
  const account = requirePlatformScope(ctx, '查看全子系统后台账号')
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
    const mongoAccounts = await readTenantAdminAccountsFromMongo(tenantId)
    const sourceAccounts = Array.isArray(mongoAccounts)
      ? mongoAccounts
      : (() => {
          const db = readDbByTenantId(tenantId)
          ensureAdminAccounts(db)
          return db.adminAccounts
        })()
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
  platformAuditRecord(ctx, 'platform.admin-accounts.list', {
    tenantQuery: tenantQuery || 'all',
    tenantCount: targetTenants.length,
    accountCount: list.length,
  })
  ctx.body = success(list)
})

router.get('/platform/accounts', (ctx) => {
  const account = requirePlatformScope(ctx, '查看主系统账号')
  if (!account) {
    return
  }
  migrateLegacyMainAccountsToCore()
  const db = readCoreDb()
  ensureAdminAccounts(db)
  const hasLegacyPromoted = db.adminAccounts.some(
    item => normalizeTenantId(item.tenantId || DEFAULT_TENANT_ID) === DEFAULT_TENANT_ID
      && String(item.scopeType || 'tenant') === 'platform',
  )
  if (hasLegacyPromoted) {
    writeCoreDb(db)
  }
  const list = db.adminAccounts
    .filter(item => String(item.scopeType || 'tenant') === 'platform')
    .map(item => ({
      ...toAdminAccountView(item),
      sourceTenantId: DEFAULT_TENANT_ID,
      sourceTenantName: '主系统',
    }))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
  platformAuditRecord(ctx, 'platform.accounts.list', { accountCount: list.length })
  ctx.body = success(list)
})

router.post('/platform/accounts', (ctx) => {
  const current = requirePlatformScope(ctx, '新增主系统账号')
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
  const created = createPlatformScopedAdminAccount({
    username,
    password,
    role,
    phone,
    name,
    scopeTenantIds,
  })
  if (!created.ok) {
    fail(ctx, created.msg, created.code)
    return
  }
  registerKnownTenantId(DEFAULT_TENANT_ID)
  platformAuditRecord(ctx, 'platform.accounts.create', { username, role })
  ctx.body = success(toAdminAccountView(created.account))
})

router.patch('/platform/accounts/:id', (ctx) => {
  if (!requirePlatformScope(ctx, '修改主系统账号')) {
    return
  }
  const payload = ctx.request.body || {}
  const { id } = ctx.params
  const db = readCoreDb()
  ensureAdminAccounts(db)
  const target = db.adminAccounts.find(item => item.id === id && String(item.scopeType || 'tenant') === 'platform')
  if (!target) {
    fail(ctx, '主系统账号不存在', 404)
    return
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
  target.scopeType = 'platform'
  target.tenantId = DEFAULT_TENANT_ID
  target.updatedAt = new Date().toISOString()
  writeCoreDb(db)
  platformAuditRecord(ctx, 'platform.accounts.update', { id: target.id, username: target.username })
  ctx.body = success(toAdminAccountView(target))
})

router.delete('/platform/accounts/:id', (ctx) => {
  if (!requirePlatformScope(ctx, '删除主系统账号')) {
    return
  }
  const { id } = ctx.params
  const db = readCoreDb()
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
  platformAuditRecord(ctx, 'platform.accounts.delete', { id, username: target.username })
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

router.get('/admin/traffic-channels', (ctx) => {
  if (!requireAdminPermission(ctx, [ADMIN_ROLES.SUPER], '查看流量渠道')) {
    return
  }
  const db = readDb()
  ensureTrafficChannels(db)
  const counts = new Map()
  for (const u of db.users) {
    const c = u && u.registerChannelCode ? String(u.registerChannelCode) : ''
    if (c) {
      counts.set(c, (counts.get(c) || 0) + 1)
    }
  }
  const list = db.trafficChannels
    .map(ch => toTrafficChannelView(ch, counts.get(String(ch.code)) || 0))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
  ctx.body = success(list)
})

router.post('/admin/traffic-channels', (ctx) => {
  if (!requireAdminPermission(ctx, [ADMIN_ROLES.SUPER], '新增流量渠道')) {
    return
  }
  const db = readDb()
  ensureTrafficChannels(db)
  const payload = ctx.request.body || {}
  const code = String(payload.code || '').trim()
  const norm = normalizeTrafficChannelBody(payload)
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
  writeDb(db)
  ctx.body = success(toTrafficChannelView(row, 0))
})

router.patch('/admin/traffic-channels/:id', (ctx) => {
  if (!requireAdminPermission(ctx, [ADMIN_ROLES.SUPER], '编辑流量渠道')) {
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
  const body = ctx.request.body || {}
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
  writeDb(db)
  const reg = db.users.filter(u => u.registerChannelCode === merged.code).length
  ctx.body = success(toTrafficChannelView(merged, reg))
})

router.delete('/admin/traffic-channels/:id', (ctx) => {
  if (!requireAdminPermission(ctx, [ADMIN_ROLES.SUPER], '删除流量渠道')) {
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
  db.trafficChannels.splice(idx, 1)
  writeDb(db)
  ctx.body = success({ id })
})

router.get('/users', (ctx) => {
  if (!requireAdminPermission(ctx, [ADMIN_ROLES.SUPER, ADMIN_ROLES.REVIEWER], '查看用户列表')) {
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
    .map(item => attachUserOrderStats(db, item, { includeAdminPasswordEcho: true }))
  ctx.body = success(users)
})

router.get('/users/by-phone', (ctx) => {
  const db = readDb()
  const phone = normalizePhone(ctx.query.phone)
  const user = db.users.find(item => item.phone === phone) || null
  ctx.body = success(user ? attachUserOrderStats(db, user, { mall: true }) : null)
})

/** 商城：已下单用户登记两位紧急联系人（姓名 + 手机号），用于领取等流程 */
router.post('/mall/me/emergency-contacts', (ctx) => {
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
  const list = []
  for (let i = 0; i < 2; i++) {
    const it = arr[i]
    if (!it || typeof it !== 'object') {
      fail(ctx, `请完整填写第 ${i + 1} 位紧急联系人的姓名与手机号`, 400)
      return
    }
    if (!isValidEmergencyContactPersonName(it.name)) {
      fail(ctx, `第 ${i + 1} 位紧急联系人姓名须为汉字或英文字母，不可含数字、标点及其它符号（姓名中仅允许间隔符「·」与空格）`, 400)
      return
    }
    const ph = normalizePhone(it.phone != null ? it.phone : '')
    if (!/^1\d{10}$/.test(ph)) {
      fail(ctx, `第 ${i + 1} 位紧急联系人手机号须为以 1 开头的 11 位大陆号码`, 400)
      return
    }
    list.push({ name: normalizeEmergencyContactPersonName(it.name), phone: ph })
  }
  if (list[0].phone === list[1].phone) {
    fail(ctx, '两位紧急联系人手机号不能相同', 400)
    return
  }
  user.emergencyContacts = list
  writeDb(db)
  ctx.body = success({ user: attachUserOrderStats(db, user, { mall: true }) })
})

/** 先享后付下单：创建浏览器可分步调用的风控会话（后续 7 步由 /wave/:id/step/:key 完成） */
router.post('/mall/installment-risk/wave', (ctx) => {
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
router.get('/users/:id', (ctx) => {
  if (!requireAdminPermission(ctx, [ADMIN_ROLES.SUPER, ADMIN_ROLES.REVIEWER], '查看用户详情')) {
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

/** 管理端：手动调用单条风控产品（按次计费） */
router.post('/users/:id/risk-slot/:slotKey', async (ctx) => {
  if (!requireAdminPermission(ctx, [ADMIN_ROLES.SUPER, ADMIN_ROLES.REVIEWER], '用户风控核查')) {
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

  const anyFail = fourteenRows.some(r => r.state === 'fail')
  target.riskControlSnapshot = {
    ...prev,
    fourteenRows,
    configured: isRiskUpstreamConfigured(),
    simulated: false,
    passed: !anyFail,
    checkedAt: new Date().toISOString(),
    summaryMessage: prev.summaryMessage || '',
    userId: target.id,
  }
  writeDb(db)

  ctx.body = success({
    row,
    user: attachUserOrderStats(db, target, { includeAdminPasswordEcho: true }),
    snapshot: target.riskControlSnapshot,
  })
})

router.post('/users/:id/risk-check', async (ctx) => {
  if (!requireAdminPermission(ctx, [ADMIN_ROLES.SUPER, ADMIN_ROLES.REVIEWER], '用户风控核查')) {
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
  }
  writeDb(db)

  ctx.body = success({
    user: attachUserOrderStats(db, target, { includeAdminPasswordEcho: true }),
    snapshot,
  })
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
  writeDb(db)
  ctx.body = success(attachUserOrderStats(db, nextUser, { includeAdminPasswordEcho: true }))
})

router.get('/my/summary', (ctx) => {
  const db = readDb()
  reconcileInstallmentCompletionAcrossDb(db)
  const phone = getUserPhone(ctx)
  if (!phone) {
    fail(ctx, '手机号格式不正确')
    return
  }
  ctx.body = success(calcMySummary(db, phone))
})

router.get('/card-packages', (ctx) => {
  const db = readDb()
  reconcileInstallmentCompletionAcrossDb(db)
  const phone = getUserPhone(ctx)
  if (!phone) {
    fail(ctx, '手机号格式不正确')
    return
  }
  const list = db.orders
    .filter(item => orderReceiverPhoneMatches(phone, item.receiverPhone) && isOrderCardPackageEligible(item))
    .map((item) => {
      ensureOrderInstallmentPlan(item)
      ensureOrderCardPackage(item)
      return {
        orderId: item.id,
        title: item.name,
        spec: item.spec || '',
        totalAmount: Number(item.totalAmount || 0),
        packageAmount: Math.max(0, Math.round(Number(item.cardPackageAmount) || 0)),
        cardPackageIssued: item.cardPackageIssued,
        orderStatus: item.status,
        createdAt: item.createdAt,
      }
    })
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
  reconcileInstallmentCompletionAcrossDb(db)
  const order = findMallCardPackageClaimOrder(db, phone, orderId)
  if (!order) {
    ctx.status = 404
    ctx.type = 'html; charset=utf-8'
    ctx.body = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>提示</title></head><body style="font-family:sans-serif;padding:1rem;">订单不存在或当前不可领取卡包</body></html>'
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
    writeDb(db)
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
  reconcileInstallmentCompletionAcrossDb(db)
  const order = findMallCardPackageClaimOrder(db, phone, orderId)
  if (!order) {
    fail(ctx, '订单不存在或不可领取卡包', 404)
    return
  }

  if (isMallCardPackageContractMock()) {
    try {
      let contractNo = String(order.cardPackageContractNo || '').trim()
      if (!contractNo) {
        contractNo = buildCardPackageContractNo(order)
        order.cardPackageContractNo = contractNo
        writeDb(db)
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
      writeDb(db)
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
      writeDb(db)
    }
    ctx.body = success({ signed: true })
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
      writeDb(db)
    }
    ctx.body = success({ signed: true })
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
  writeDb(db)
  ctx.body = success({ reset: true })
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

router.delete('/bank-cards/:id', (ctx) => {
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
  writeDb(db)
  ctx.body = success({ id: Number(id) })
})

/**
 * 与 GET /bills 一致：构建商城分期账单行并计算 shouldRepay（本月待还）、totalPending（全部待还）。
 * 含 status=reviewing 的先享后付单（行状态为「审核中」、不计入待还汇总），与订单列表一致；供 /bills 与 /my/summary 共用。
 */
function buildMallBillingListAndSummaries(db, phone) {
  const list = []
  /** 含审核中的先享后付单，便于账单与「我的—订单」同步展示；待还汇总仅计 status 为「待还款」的行 */
  const loanOrders = db.orders
    .filter(item => orderReceiverPhoneMatches(phone, item.receiverPhone))
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
      }
      if (Array.isArray(planItem.negotiationHistory) && planItem.negotiationHistory.length > 0) {
        installmentRow.negotiationHistory = planItem.negotiationHistory.map((h) => ({
          negotiatedAmount: Number(Number(h.negotiatedAmount || 0).toFixed(2)),
          remainderAmount: Number(Number(h.remainderAmount || 0).toFixed(2)),
          remainderDueDate: String(h.remainderDueDate || '').trim(),
          createdAt: String(h.createdAt || '').trim(),
          userPaidAt: String(h.userPaidAt || '').trim(),
        }))
      }
      const pend = planItem.negotiationPayPending
      if (pend && Number(pend.negotiatedAmount || 0) > 0) {
        installmentRow.negotiationPayPending = {
          negotiatedAmount: Number(Number(pend.negotiatedAmount || 0).toFixed(2)),
          remainderAmount: Number(Number(pend.remainderAmount || 0).toFixed(2)),
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

router.get('/bills', (ctx) => {
  const db = readDb()
  reconcileInstallmentCompletionAcrossDb(db)
  const phone = getUserPhone(ctx)
  if (!phone) {
    fail(ctx, '手机号格式不正确')
    return
  }
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
  ctx.body = success({
    summary: {
      shouldRepay,
      totalPending,
      availableQuota,
      billDate: `每月 ${billDateDay} 日`,
      minRepayment: Number((shouldRepay * 0.1).toFixed(2)),
    },
    list,
  })
})

/**
 * 商城用户还款：与后台 PATCH /orders/:id/installments/:period/pay 写入同一套 installmentPlan，
 * 需校验收货手机号与订单归属；与 OrdersPage 一致，卡包未发放前不允许记为已还。
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

  const loanOrders = db.orders
    .filter(item => orderReceiverPhoneMatches(phone, item.receiverPhone))
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
    for (const order of loanOrders) {
      ensureOrderInstallmentPlan(order)
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
      }
    }
    writeDb(db)
    await flushMongoPersist()
    ctx.body = success({ all: true, repaidPeriods })
    return
  }

  const orderId = String(payload.orderId || '').trim()
  const periodNumber = Number(payload.period)
  if (!orderId || !Number.isInteger(periodNumber) || periodNumber <= 0) {
    fail(ctx, '请提供正确的 orderId 与 period')
    return
  }

  const target = db.orders.find(item => String(item.id) === orderId && orderReceiverPhoneMatches(phone, item.receiverPhone))
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
  planItem.paid = true
  target.installmentScheduleExplicit = true
  applyInstallmentCompletionOrderStatus(target, { ignoreAdminSkip: true })
  writeDb(db)
  await flushMongoPersist()
  ctx.body = success({ orderId: target.id, period: periodNumber, paid: true })
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
  const target = db.orders.find(item => String(item.id) === orderId && orderReceiverPhoneMatches(phone, item.receiverPhone))
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
  const remainder = Number(Number(pend.remainderAmount || 0).toFixed(2))
  const remainderDue = normalizeNegotiateRemainderDueDate(pend.remainderDueDate)
  if (remainder <= 0 || !remainderDue || !/^\d{4}-\d{2}-\d{2}$/.test(remainderDue)) {
    fail(ctx, '协商待支付数据异常，请联系客服', 400)
    return
  }
  const applied = applyInstallmentNegotiationPayCompleted(planItem)
  if (!applied.ok) {
    fail(ctx, applied.msg, 400)
    return
  }
  target.installmentScheduleExplicit = true
  applyInstallmentCompletionOrderStatus(target, { ignoreAdminSkip: true })
  writeDb(db)
  await flushMongoPersist()
  ctx.body = success({ orderId: target.id, period: periodNumber, negotiatedPaid: true })
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
  }
  if (typeof payload.signAuthSerialNo === 'string') {
    const s = payload.signAuthSerialNo.trim()
    target.signAuthSerialNo = s
  }

  writeDb(db)
  ctx.body = success(attachUserOrderStats(db, target, { includeAdminPasswordEcho: true }))
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
  reconcileInstallmentCompletionAcrossDb(db)
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
      ensureOrderShipment(item)
      return '待收货'
    }
    return '已完成'
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

  const enriched = list.map((order) => {
    const phone = normalizePhone(order.receiverPhone || '')
    const buyer = /^1\d{10}$/.test(phone) ? db.users.find(item => item.phone === phone) : null
    const rawRemark = buyer && typeof buyer.adminRemark === 'string' ? buyer.adminRemark.trim() : ''
    const emergencyContactsComplete = buyer
      ? isEmergencyContactsComplete(normalizeEmergencyContactsList(buyer.emergencyContacts))
      : null
    return {
      ...order,
      buyerAdminRemark: rawRemark,
      emergencyContactsComplete,
    }
  })

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

router.get('/orders/pending-receivable', (ctx) => {
  if (!requireAdminPermission(ctx, [ADMIN_ROLES.SUPER, ADMIN_ROLES.COLLECTOR], '查看先享后付待收明细')) {
    return
  }
  const dueDate = String(ctx.query.dueDate || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    fail(ctx, '参数 dueDate 须为 YYYY-MM-DD', 400)
    return
  }
  const db = readDb()
  reconcileInstallmentCompletionAcrossDb(db)
  const rows = []
  let totalDueOnDate = 0
  let paidDueOnDate = 0
  let unpaidDueOnDate = 0
  let overdueBeforeDateCount = 0
  let unpaidDueOnOrBeforeDateCount = 0

  for (const order of db.orders) {
    ensureOrderInstallmentPlan(order)
    ensureOrderCardPackage(order)
    ensureOrderShipment(order)
    if (order.payType === 'full' && order.status !== 'reviewing' && !order.paid) {
      order.paid = true
    }
    const plan = Array.isArray(order.installmentPlan) ? order.installmentPlan : []
    for (const item of plan) {
      if (!item) {
        continue
      }
      const key = normalizeInstallmentDueDateKey(item.dueDate)
      if (key === dueDate) {
        const amt = Number(Number(item.amount || 0).toFixed(2))
        totalDueOnDate += amt
        if (item.paid) {
          paidDueOnDate += amt
        }
        else {
          unpaidDueOnDate += amt
        }
      }
      if (!item.paid && key) {
        if (key <= dueDate) {
          unpaidDueOnOrBeforeDateCount += 1
          if (key < dueDate) {
            overdueBeforeDateCount += 1
          }
        }
      }
      if (!item.paid && key === dueDate) {
        rows.push({
          orderId: order.id,
          receiverName: String(order.receiverName || '').trim() || '商城用户',
          receiverPhone: String(order.receiverPhone || '').trim(),
          productName: String(order.name || '').trim(),
          period: Number(item.period),
          dueDate: key,
          amount: Number(Number(item.amount || 0).toFixed(2)),
        })
      }
    }
  }
  const totalAmount = Number(unpaidDueOnDate.toFixed(2))
  totalDueOnDate = Number(totalDueOnDate.toFixed(2))
  paidDueOnDate = Number(paidDueOnDate.toFixed(2))
  unpaidDueOnDate = Number(unpaidDueOnDate.toFixed(2))
  const overdueRateAsOfDate = unpaidDueOnOrBeforeDateCount > 0
    ? Number(((overdueBeforeDateCount / unpaidDueOnOrBeforeDateCount) * 100).toFixed(2))
    : 0
  ctx.body = success({
    dueDate,
    rows,
    totalAmount,
    totalDueOnDate,
    paidDueOnDate,
    unpaidDueOnDate,
    overdueRateAsOfDate,
    overdueBeforeDateCount,
    unpaidDueOnOrBeforeDateCount,
  })
})

/** 单条订单详情（含最新 installmentPlan），供管理端「查看还款」等弹窗拉数 */
router.get('/orders/:id', (ctx) => {
  const db = readDb()
  reconcileInstallmentCompletionAcrossDb(db)
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
  const phone = normalizePhone(target.receiverPhone || '')
  const buyer = /^1\d{10}$/.test(phone)
    ? db.users.find(item => normalizePhone(item.phone || '') === phone)
    : null
  const rawRemark = buyer && typeof buyer.adminRemark === 'string' ? buyer.adminRemark.trim() : ''
  const emergencyContactsComplete = buyer
    ? isEmergencyContactsComplete(normalizeEmergencyContactsList(buyer.emergencyContacts))
    : null
  ctx.body = success({
    ...target,
    buyerAdminRemark: rawRemark,
    emergencyContactsComplete,
  })
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
  const receiverPhoneForDedupe = String(payload.receiverPhone || '').trim()
  const receiverNormForBlacklist = normalizePhone(receiverPhoneForDedupe)
  if (/^1\d{10}$/.test(receiverNormForBlacklist)) {
    const blockedBuyer = db.users.find(item => item.phone === receiverNormForBlacklist)
    if (blockedBuyer && blockedBuyer.orderBlacklisted) {
      fail(ctx, '该账号已被限制下单，如有疑问请联系客服', 403)
      return
    }
  }
  if (receiverPhoneForDedupe) {
    const hasOpenSamePhone = db.orders.some(
      (item) => String(item.receiverPhone || '').trim() === receiverPhoneForDedupe && item.status !== 'enjoying',
    )
    if (hasOpenSamePhone) {
      fail(ctx, '您尚有未完成的订单，请待订单完成后再下单', 400)
      return
    }
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
    const buyerPhone = normalizePhone(receiverPhoneForDedupe)
    if (!/^1\d{10}$/.test(buyerPhone)) {
      fail(ctx, '请填写正确的收货手机号以便校验授信额度', 400)
      return
    }
    const buyer = db.users.find(item => item.phone === buyerPhone)
    if (!buyer) {
      fail(ctx, '该手机号尚未注册，请先完成注册后再先享后付下单', 400)
      return
    }
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
  }
  if (nextOrder.payType === 'installment') {
    const riskBypassReason = String(payload.riskBypassReason || '').trim()
    const isReturningCustomerBypass = riskBypassReason === 'returning_customer'
    if (isReturningCustomerBypass) {
      const receiverNorm = normalizePhone(nextOrder.receiverPhone)
      const hasCompletedIssuedOrder = db.orders.some((item) => {
        if (normalizePhone(String(item.receiverPhone || '')) !== receiverNorm) {
          return false
        }
        ensureOrderCardPackage(item)
        return item.status === 'enjoying' && item.cardPackageIssued === true
      })
      if (!hasCompletedIssuedOrder) {
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
    const skipUpstream = String(process.env.RISK_ORDER_SUBMIT_SKIP_UPSTREAM || '').trim() === '1'
    const idForRisk = String(payload.idNumber || '').trim()
    const idPlaceholder = String(process.env.RISK_PRELIMINARY_PLACEHOLDER_ID || '').trim()
    if (isRiskUpstreamConfigured() && !skipUpstream && !idForRisk && !idPlaceholder) {
      fail(ctx, '先享后付下单需提交身份证号以便系统风控核验，请先完成注册资料', 400)
      return
    }
    const installmentRiskWaveId = String(payload.installmentRiskWaveId || '').trim()
    let riskResult
    let orderSubmitRiskStepsFull = []
    if (installmentRiskWaveId) {
      const consumed = consumeInstallmentRiskWaveForOrder(installmentRiskWaveId, {
        userName: nextOrder.receiverName,
        phoneNumber: normalizePhone(nextOrder.receiverPhone),
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
      try {
        const pack = await runOrderSubmitUpstreamRiskPack({
          userName: nextOrder.receiverName,
          phoneNumber: nextOrder.receiverPhone,
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
    nextOrder.riskStatus = riskResult.status
    nextOrder.riskReason = riskResult.reason
    nextOrder.riskCheckedAt = riskResult.checkedAt
    if (Array.isArray(riskResult.preliminaryStepsSummary)) {
      nextOrder.riskPreliminaryStepsSummary = riskResult.preliminaryStepsSummary
    }
    nextOrder.riskOrderSubmitPack = true
    const buyerForRiskSnap = db.users.find(item => item.phone === normalizePhone(nextOrder.receiverPhone))
    if (buyerForRiskSnap && orderSubmitRiskStepsFull.length > 0) {
      mergeInstallmentOrderRiskStepsIntoUserSnapshot(
        buyerForRiskSnap,
        orderSubmitRiskStepsFull,
        riskResult.checkedAt,
      )
    }
    }
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

router.patch('/orders/:id/pay', async (ctx) => {
  const db = readDb()
  const { id } = ctx.params
  const payload = ctx.request.body || {}
  const target = db.orders.find(item => String(item.id) === String(id))

  if (!target) {
    ctx.status = 404
    ctx.body = { success: false, code: 404, msg: '订单不存在', data: null }
    return
  }

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
  if (payload.payChannel) {
    target.payChannel = payload.payChannel
  }
  if (target.status === 'reviewing' && target.payType === 'full') {
    target.status = 'shipping'
  }
  writeDb(db)
  await flushMongoPersist()
  ctx.body = success(target)
})

router.patch('/orders/:id/installments/:period/pay', async (ctx) => {
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

  planItem.paid = Boolean(payload.paid)
  if (planItem.paid && planItem.negotiationPayPending) {
    planItem.negotiationPayPending = null
  }
  if (!planItem.paid) {
    restoreNegotiationPayPendingFromLastHistoryIfNeeded(planItem)
  }

  target.installmentScheduleExplicit = true

  applyInstallmentCompletionOrderStatus(target, { ignoreAdminSkip: true })

  writeDb(db)
  await flushMongoPersist()
  ctx.body = success(target)
})

/** 管理端：将指定期次的还款日在原日期基础上顺延若干天 */
router.patch('/orders/:id/installments/:period/due-date', async (ctx) => {
  if (!requireAdminPermission(ctx, [ADMIN_ROLES.SUPER], '延期还款')) {
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

  const addDaysNum = Number(payload.addDays)
  if (!Number.isInteger(addDaysNum) || addDaysNum < 1 || addDaysNum > 3650) {
    fail(ctx, 'addDays 须为 1～3650 的整数')
    return
  }

  ensureOrderInstallmentPlan(target)
  const planItem = findInstallmentPlanItemByPeriod(target.installmentPlan, periodNumber)
  if (!planItem) {
    fail(ctx, '先享后付记录不存在', 404)
    return
  }

  if (installmentItemIsPaid(planItem)) {
    fail(ctx, '已还款期次不可延期')
    return
  }
  if (Array.isArray(planItem.negotiationHistory) && planItem.negotiationHistory.length > 0) {
    fail(ctx, '该期已有协商记录，请使用「协商还款」调整，不可延期还款', 400)
    return
  }
  if (planItem.negotiationPayPending && Number(planItem.negotiationPayPending.negotiatedAmount || 0) > 0) {
    fail(ctx, '本期尚有协商款项待用户完成支付，请先完成后再延期', 400)
    return
  }

  const key = normalizeInstallmentDueDateKey(planItem.dueDate)
  if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    fail(ctx, '当前期还款日无效，无法延期')
    return
  }

  const nextYmd = addDays(`${key}T12:00:00`, addDaysNum)
  if (!nextYmd || !/^\d{4}-\d{2}-\d{2}$/.test(nextYmd)) {
    fail(ctx, '计算新还款日失败')
    return
  }

  planItem.dueDate = nextYmd
  target.installmentScheduleExplicit = true
  applyInstallmentCompletionOrderStatus(target, { ignoreAdminSkip: true })

  writeDb(db)
  await flushMongoPersist()
  ctx.body = success(target)
})

/** 管理端：协商结清金额——将本期应还总额与本金直接改为指定值（无协商记录且待协商支付为空时可用） */
router.patch('/orders/:id/installments/:period/settle-amount', async (ctx) => {
  if (!requireAdminPermission(ctx, [ADMIN_ROLES.SUPER], '协商结清金额')) {
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
  writeDb(db)
  await flushMongoPersist()
  ctx.body = success(target)
})

/** 管理端：协商还款——登记本次协商金额，更新剩余应还本金与还款日，并写入协商历史（用户端账单展示「协商记录」） */
router.patch('/orders/:id/installments/:period/negotiate', async (ctx) => {
  if (!requireAdminPermission(ctx, [ADMIN_ROLES.SUPER], '协商还款')) {
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
  if (nAmt >= curAmount) {
    fail(ctx, '协商还款金额须小于当前应还金额')
    return
  }
  const remainder = Number((curAmount - nAmt).toFixed(2))
  if (remainder <= 0) {
    fail(ctx, '协商后未还金额须大于 0')
    return
  }
  const remainderDue = normalizeNegotiateRemainderDueDate(payload.remainderDueDate)
  if (!remainderDue || !/^\d{4}-\d{2}-\d{2}$/.test(remainderDue)) {
    fail(ctx, '请提供有效的协商后未还金额还款日（YYYY-MM-DD）')
    return
  }
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
  /** 待用户在前台完成「协商支付」后再写入剩余本金与还款日；此前本期应还总额保持不变 */
  planItem.negotiationPayPending = {
    negotiatedAmount: nAmt,
    remainderAmount: remainder,
    remainderDueDate: remainderDue,
    createdAt: new Date().toISOString(),
  }
  target.installmentScheduleExplicit = true
  applyInstallmentCompletionOrderStatus(target, { ignoreAdminSkip: true })
  writeDb(db)
  await flushMongoPersist()
  ctx.body = success(target)
})

/** 管理端：协商记录中单条「协商金额还款状态」标记已还 / 未还（与商城协商支付落库一致，可撤销末条已应用状态） */
router.patch('/orders/:id/installments/:period/negotiation/history/:historyIndex/paid', async (ctx) => {
  if (!requireAdminPermission(ctx, [ADMIN_ROLES.SUPER], '协商还款')) {
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
  writeDb(db)
  await flushMongoPersist()
  ctx.body = success(target)
})

router.patch('/orders/:id/status', (ctx) => {
  const role = requireAdminPermission(ctx, [ADMIN_ROLES.SUPER, ADMIN_ROLES.REVIEWER], '审核订单')
  if (!role) {
    return
  }
  const db = readDb()
  const { id } = ctx.params
  const body = ctx.request.body || {}
  const { status } = body
  const target = db.orders.find(item => item.id === id)

  if (!target) {
    ctx.status = 404
    ctx.body = { success: false, code: 404, msg: '订单不存在', data: null }
    return
  }

  /** 人工审核不通过：保持 reviewing，仅将先享后付风控标为未通过（与系统风控失败同列展示逻辑） */
  if (body.riskStatus === 'failed') {
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
    writeDb(db)
    ctx.body = success(target)
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
  writeDb(db)
  ctx.body = success(target)
})

router.patch('/orders/:id/shipment', (ctx) => {
  if (!requireAdminPermission(ctx, [ADMIN_ROLES.SUPER], '登记快递单号')) {
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
  if (target.status !== 'shipping' && target.status !== 'receiving') {
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
  writeDb(db)
  ctx.body = success(target)
})

router.patch('/orders/:id/card-package', (ctx) => {
  const role = requireAdminPermission(ctx, [ADMIN_ROLES.SUPER, ADMIN_ROLES.REVIEWER], '维护卡包发放状态')
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
  target.cardPackageIssued = payload.cardPackageIssued
  /** 管理端规则：卡包标记已发放时与订单「已完成」联动（enjoying ↔ 前端展示已完成） */
  if (payload.cardPackageIssued === true) {
    target.status = 'enjoying'
    target.skipInstallmentAutoEnjoying = false
  }
  writeDb(db)
  ctx.body = success(target)
})

/** 管理端：维护卡包领取电子合同签署状态（与商城 contract-ack 语义一致） */
router.patch('/orders/:id/card-package-contract', (ctx) => {
  const role = requireAdminPermission(ctx, [ADMIN_ROLES.SUPER, ADMIN_ROLES.REVIEWER], '维护卡包合同签署状态')
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
  writeDb(db)
  ctx.body = success(target)
})

router.delete('/orders/:id', (ctx) => {
  if (!requireAdminPermission(ctx, [ADMIN_ROLES.SUPER], '删除订单')) {
    return
  }
  const db = readDb()
  const { id } = ctx.params
  const idx = db.orders.findIndex(item => item.id === id)
  if (idx < 0) {
    fail(ctx, '订单不存在', 404)
    return
  }
  db.orders.splice(idx, 1)
  writeDb(db)
  ctx.body = success({ id })
})

/** ---------- 商城 / 管理端：在线客服（持久化 csSessions，轮询拉取） ---------- */

router.post('/mall/cs/session/open', (ctx) => {
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
    writeDb(db)
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
  writeDb(db)
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

router.get('/mall/cs/session', (ctx) => {
  const db = readDb()
  const r = resolveCsMallSession(ctx, db, { requireExisting: true })
  if (r.error) {
    fail(ctx, r.error, 401)
    return
  }
  const s = r.session
  const resolvedName = resolveCsSessionDisplayName(db, s)
  if (s.mallUserId && resolvedName && s.displayName !== resolvedName) {
    s.displayName = resolvedName
  }
  s.userOnlineAt = new Date().toISOString()
  s.unreadUser = 0
  writeDb(db)
  ctx.body = success({
    sessionId: s.id,
    visitorKey: s.visitorKey || '',
    displayName: resolvedName,
    messages: Array.isArray(s.messages) ? s.messages : [],
  })
})

router.post('/mall/cs/messages', (ctx) => {
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
  writeDb(db)
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
      writeDb(db)
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

router.get('/admin/cs/sessions', (ctx) => {
  if (!requireAdminPermission(ctx, [ADMIN_ROLES.SUPER, ADMIN_ROLES.REVIEWER], '查看客服会话')) {
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
  ctx.body = success(list)
})

router.get('/admin/cs/sessions/:sessionId', (ctx) => {
  if (!requireAdminPermission(ctx, [ADMIN_ROLES.SUPER, ADMIN_ROLES.REVIEWER], '查看客服会话详情')) {
    return
  }
  const db = readDb()
  const s = findCsSessionById(db, ctx.params.sessionId)
  if (!s) {
    fail(ctx, '会话不存在', 404)
    return
  }
  const markRead = !['0', 'false', 'no'].includes(String(ctx.query.read || '1').toLowerCase())
  if (markRead) {
    s.unreadAgent = 0
    writeDb(db)
  }
  ctx.body = success({
    id: s.id,
    displayName: resolveCsSessionDisplayName(db, s),
    online: csUserOnline(s),
    messages: Array.isArray(s.messages) ? s.messages : [],
    mallUserId: s.mallUserId || '',
  })
})

router.post('/admin/cs/sessions/:sessionId/messages', (ctx) => {
  if (!requireAdminPermission(ctx, [ADMIN_ROLES.SUPER, ADMIN_ROLES.REVIEWER], '回复客服会话')) {
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
  writeDb(db)
  ctx.body = success({
    ok: true,
    messages: Array.isArray(s.messages) ? s.messages : [],
  })
})

router.post('/admin/cs/sessions/:sessionId/messages/image', async (ctx) => {
  if (!requireAdminPermission(ctx, [ADMIN_ROLES.SUPER, ADMIN_ROLES.REVIEWER], '回复客服会话')) {
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
      writeDb(db)
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
app.use(async (ctx, next) => {
  const tenantId = resolveTenantIdFromRequest(ctx)
  const rawWorkspace = resolveWorkspaceTypeFromRequest(ctx)
  const workspaceType = clampIncomingWorkspaceType(ctx, tenantId, rawWorkspace)
  ctx.state.tenantId = tenantId
  ctx.state.workspaceType = workspaceType
  ctx.set('x-tenant-id', tenantId)
  ctx.set('x-workspace-type', workspaceType)
  await runWithWorkspace(workspaceType, tenantId, () => next())
})
app.use(async (ctx, next) => {
  if (String(ctx.path || '').startsWith('/api/') && isMongoPersistenceEnabled()) {
    try {
      const tenantId = normalizeTenantId(ctx.state && ctx.state.tenantId ? ctx.state.tenantId : DEFAULT_TENANT_ID)
      const workspaceType = normalizeWorkspaceType(ctx.state && ctx.state.workspaceType ? ctx.state.workspaceType : 'tenant')
      const hydrateTenantId = workspaceType === 'tenant' ? tenantId : DEFAULT_TENANT_ID
      if (!hasScopeCache(workspaceType, hydrateTenantId)) {
        await hydrateTenantDbFromMongo(workspaceType, hydrateTenantId)
      }
    }
    catch {
      // ignore on-demand hydrate failures and fallback to in-memory snapshot
    }
  }
  await next()
})
app.use(async (ctx, next) => {
  if (String(ctx.path || '').startsWith('/api/')) {
    try {
      const tenantId = normalizeTenantId(ctx.state && ctx.state.tenantId ? ctx.state.tenantId : DEFAULT_TENANT_ID)
      const db = readDb()
      ensureTenantRegistered(db, tenantId)
    }
    catch {
      // ignore tenant meta register errors
    }
  }
  await next()
})
/**
 * 开发/测试：响应返回前等待本次请求触发的 Mongo 写入完成（readDb 仍为内存快照，但落库与 HTTP 响应同步）。
 * 生产关闭（默认 false），避免额外延迟。
 */
app.use(async (ctx, next) => {
  await next()
  if (!mongoConfig.isMongoAwaitPersistEnabled() || !isMongoPersistenceEnabled()) {
    return
  }
  if (!String(ctx.path || '').startsWith('/api/')) {
    return
  }
  try {
    await flushMongoPersist()
  }
  catch (err) {
    console.error('[store] MONGO_AWAIT_PERSIST 落库等待失败:', err?.message || err)
  }
})
app.use(router.routes())
app.use(router.allowedMethods())
app.use(riskControlRouter.routes())
app.use(riskControlRouter.allowedMethods())

;(async () => {
  let mongoPersistenceActive = false
  try {
    await mongo.connectMongo()
    mongoPersistenceActive = await hydrateFromMongoAfterConnect()
    if (mongoPersistenceActive) {
      console.log(`[mongo] 已启用 MongoDB 持久化（分集合: ${mongo.SHARDED_ENTITY_KEYS.join(', ')}；元数据: ${mongo.APP_META}）`)
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
    reconcileInstallmentCompletionAcrossDb(db)
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
