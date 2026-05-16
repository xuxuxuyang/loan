/**
 * 空库 / 重置时的唯一内置超级管理员（无其它后台账号；无模拟商品/订单）。
 * 商城用户 `BOOTSTRAP_ADMIN_USER` 与同手机号，密码哈希由 pepper + 明文密码生成。
 */
const DEFAULT_SUPER_ADMIN_USERNAME = 'xuyang'
const DEFAULT_SUPER_ADMIN_PHONE = '15180545617'

/** 后台登录明文密码（开发/演示默认；生产请修改） */
const DEFAULT_SUPER_ADMIN_BACKOFFICE_PASSWORD = '123456'

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
  registerAt: new Date().toISOString(),
  quota: 3000,
  /** 与 API mall pepper + DEFAULT_SUPER_ADMIN_BACKOFFICE_PASSWORD 生成的哈希一致（默认明文 123456） */
  passwordHash: '51294d76482bb32367c70586dfc6d484d96550b2fe47118f38c1679a0185812f',
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
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
]

module.exports = {
  DEFAULT_SUPER_ADMIN_USERNAME,
  DEFAULT_SUPER_ADMIN_PHONE,
  DEFAULT_SUPER_ADMIN_BACKOFFICE_PASSWORD,
  BOOTSTRAP_ADMIN_USER,
  BOOTSTRAP_ADMIN_ACCOUNTS,
}
