const { registerIosAppRoutes: registerRoutes } = require('./router')

const REQUIRED_DEPENDENCIES = [
  'readDb',
  'success',
  'fail',
  'normalizePhone',
  'resolveUser',
  'sendRegisterSms',
  'verifyRegisterSms',
  'resolveRegisterChannel',
  'createUser',
  'writeUsers',
  'idCardUploadMiddleware',
  'uploadIdCard',
  'validateIdCardImages',
  'getRiskStepKeys',
  'createRiskWave',
  'runRiskStep',
  'recordRiskStep',
  'consumeRiskWave',
  'normalizeProduct',
  'normalizeQuota',
  'isOrderSettled',
  'buildInstallmentPlan',
  'writeOrders',
  'flushPersist',
  'applyContactsSummary',
  'writeUsersAndOrders',
  'verifyPassword',
  'deleteContactsByAccount',
  'deleteIdCardImage',
  'writeAccountDeletion',
]

const REQUIRED_OBJECT_DEPENDENCIES = ['contactsStore']

function registerIosAppRoutes(router, deps) {
  for (const key of REQUIRED_DEPENDENCIES) {
    if (!deps || typeof deps[key] !== 'function') {
      throw new Error(`registerIosAppRoutes missing dependency: ${key}`)
    }
  }
  for (const key of REQUIRED_OBJECT_DEPENDENCIES) {
    if (!deps || !deps[key] || typeof deps[key] !== 'object') {
      throw new Error(`registerIosAppRoutes missing dependency: ${key}`)
    }
  }
  return registerRoutes(router, deps)
}

module.exports = {
  registerIosAppRoutes,
}
