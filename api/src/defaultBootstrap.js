/**
 * 空库 / 重置时的唯一内置超级管理员（无其它后台账号；无模拟商品/订单）。
 * 账号口令从环境变量读取（api/.env.development | .env.production），避免写死在仓库。
 * 变量未设置时回落为开发与历史兼容默认值。
 *
 * BOOTSTRAP_ADMIN_ACCOUNTS：后台登录账号，始终参与种子（adminAccounts）。
 */
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
const DEFAULT_SUPER_ADMIN_BACKOFFICE_PASSWORD = readEnvTrim('BOOTSTRAP_SUPER_ADMIN_PASSWORD', '1203')

const _bootstrapNow = new Date().toISOString()

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
  BOOTSTRAP_ADMIN_ACCOUNTS,
}
