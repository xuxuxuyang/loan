const { buildProfileStatus } = require('./masking')
const { validateInstallmentProfile } = require('./validation')
const { setError } = require('./auth')

function requireCurrentUser(ctx, deps) {
  const db = deps.readDb()
  const user = deps.resolveUser(ctx, db)
  if (!user) {
    setError(ctx, 'UNAUTHORIZED', '请先登录后再操作', 401)
    return null
  }
  return { db, user }
}

function registerProfileRoutes(router, deps) {
  router.get('/ios/installment/profile', async (ctx) => {
    const resolved = requireCurrentUser(ctx, deps)
    if (!resolved) return
    ctx.body = deps.success(buildProfileStatus(resolved.user))
  })

  router.put('/ios/installment/profile', async (ctx) => {
    const resolved = requireCurrentUser(ctx, deps)
    if (!resolved) return

    const validation = validateInstallmentProfile(ctx.request.body, resolved.user.phone)
    if (!validation.ok) {
      setError(ctx, validation.code, validation.msg)
      return
    }

    const profile = validation.value
    const imageValidation = deps.validateIdCardImages(profile, resolved.user.phone)
    if (!imageValidation || !imageValidation.ok) {
      setError(
        ctx,
        imageValidation && imageValidation.code || 'INVALID_ID_CARD_IMAGE_REFERENCE',
        imageValidation && imageValidation.msg || '身份证图片无效，请重新上传',
      )
      return
    }
    Object.assign(resolved.user, {
      name: profile.name,
      idNumber: profile.idNumber,
      idCardFront: profile.idCardFront,
      idCardBack: profile.idCardBack,
      idCardHandheld: profile.idCardHandheld,
      emergencyContacts: profile.emergencyContacts,
    })
    await deps.writeUsers(resolved.db)
    ctx.body = deps.success(buildProfileStatus(resolved.user))
  })
}

module.exports = {
  registerProfileRoutes,
  requireCurrentUser,
}
