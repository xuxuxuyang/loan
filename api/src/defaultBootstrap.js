/**
 * 空库 / 重置时的唯一内置超级管理员（无其它后台账号；无模拟商品/订单）。
 * 账号口令从环境变量读取（api/.env.development | .env.production），避免写死在仓库。
 * 变量未设置时回落为开发与历史兼容默认值。
 *
 * 商城用户 `BOOTSTRAP_ADMIN_USER` 与同手机号；`passwordHash` 与 api/src/index.js 中 MALL_PASSWORD_PEPPER 规则一致。
 */
const crypto = require('node:crypto')

/** 须与 api/src/index.js 中 MALL_PASSWORD_PEPPER 保持一致 */
const MALL_PASSWORD_PEPPER = 'mall-local-pepper-v1'

function hashMallUserPassword(plain) {
  const s = String(plain || '')
  return crypto.createHash('sha256').update(`${MALL_PASSWORD_PEPPER}:${s}`, 'utf8').digest('hex')
}

function readEnvTrim(key, fallback) {
  const v = process.env[key]
  if (v === undefined || v === null) {
    return fallback
  }
  const t = String(v).trim()
  return t || fallback
}

const DEFAULT_SUPER_ADMIN_USERNAME = readEnvTrim('BOOTSTRAP_SUPER_ADMIN_USERNAME', 'xuyang')
const DEFAULT_SUPER_ADMIN_PHONE = readEnvTrim('BOOTSTRAP_SUPER_ADMIN_PHONE', '15180545617')
const DEFAULT_SUPER_ADMIN_BACKOFFICE_PASSWORD = readEnvTrim('BOOTSTRAP_SUPER_ADMIN_PASSWORD', '123456')

const _bootstrapNow = new Date().toISOString()

const BOOTSTRAP_ADMIN_USER = {
  id: `U${DEFAULT_SUPER_ADMIN_PHONE}`,
  name: '超级管理员',
  phone: DEFAULT_SUPER_ADMIN_PHONE,
  idCardFront: 'placeholder://admin/id-card-front',
  idCardBack: 'placeholder://admin/id-card-back',
  idCardHandheld: 'placeholder://admin/id-card-handheld',
  locationText: '',
  latitude: 0,
  longitude: 0,
  creditStatus: '待风控',
  registerAt: _bootstrapNow,
  quota: 3000,
  passwordHash: hashMallUserPassword(DEFAULT_SUPER_ADMIN_BACKOFFICE_PASSWORD),
}

const BOOTSTRAP_ADMIN_ACCOUNTS = [
  {
    id: 'A1001',
    username: DEFAULT_SUPER_ADMIN_USERNAME,
    password: DEFAULT_SUPER_ADMIN_BACKOFFICE_PASSWORD,
    role: 'super_admin',
    scopeType: 'platform',
    tenantId: 'default',
    scopeTenantIds: ['*'],
    name: '超级管理员',
    phone: DEFAULT_SUPER_ADMIN_PHONE,
    status: 'active',
    createdAt: _bootstrapNow,
    updatedAt: _bootstrapNow,
  },
]

module.exports = {
  DEFAULT_SUPER_ADMIN_USERNAME,
  DEFAULT_SUPER_ADMIN_PHONE,
  DEFAULT_SUPER_ADMIN_BACKOFFICE_PASSWORD,
  BOOTSTRAP_ADMIN_USER,
  BOOTSTRAP_ADMIN_ACCOUNTS,
}
