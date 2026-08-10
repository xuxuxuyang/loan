const { registerAuthRoutes } = require('./auth')
const { registerProfileRoutes } = require('./profile')
const { registerUploadRoutes } = require('./upload')
const { registerInstallmentRoutes } = require('./installment')
const { registerContactRoutes } = require('./contacts')
const { registerAccountDeletionRoutes } = require('./accountDeletion')

function registerIosAppRoutes(router, deps) {
  registerAuthRoutes(router, deps)
  registerProfileRoutes(router, deps)
  registerUploadRoutes(router, deps)
  registerInstallmentRoutes(router, deps)
  registerContactRoutes(router, deps)
  registerAccountDeletionRoutes(router, deps)
}

module.exports = {
  registerIosAppRoutes,
}
