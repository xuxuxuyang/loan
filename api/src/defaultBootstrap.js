/**
 * 空库 / 重置时的唯一内置超级管理员（无其它后台账号；无模拟商品/订单）。
 * 前台商城测试账号与同手机号、密码哈希一致（见 LoginCard / useMallAuth）。
 */
const DEFAULT_SUPER_ADMIN_USERNAME = 'xuyang'
const DEFAULT_SUPER_ADMIN_PHONE = '15180545617'

/** 后台登录 plaintext；商城密码登录同 `ADMIN_TEST_MALL_PASSWORD`（默认 123456） */
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
  creditStatus: '良好',
  registerAt: new Date().toISOString(),
  quota: 3000,
  /** sha256(pepper + ":" + ADMIN_TEST_MALL_PASSWORD)，默认密码 123456 */
  passwordHash: '51294d76482bb32367c70586dfc6d484d96550b2fe47118f38c1679a0185812f',
}

const BOOTSTRAP_ADMIN_ACCOUNTS = [
  {
    id: 'A1001',
    username: DEFAULT_SUPER_ADMIN_USERNAME,
    password: DEFAULT_SUPER_ADMIN_BACKOFFICE_PASSWORD,
    role: 'super_admin',
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
