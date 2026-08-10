const { setError } = require('./auth')

async function requireUploadUser(ctx, next, deps) {
  const db = deps.readDb()
  const user = deps.resolveUser(ctx, db)
  if (!user) {
    setError(ctx, 'UNAUTHORIZED', '请先登录后再上传资料', 401)
    return
  }
  ctx.state.iosIdentityUpload = { db, user }
  await next()
}

function registerUploadRoutes(router, deps) {
  router.post(
    '/ios/uploads/id-card',
    (ctx, next) => requireUploadUser(ctx, next, deps),
    deps.idCardUploadMiddleware,
    async (ctx) => {
      const body = ctx.request.body || {}
      const scene = String(body.scene || '').trim().toLowerCase()
      if (!['front', 'back', 'handheld'].includes(scene)) {
        setError(ctx, 'INVALID_ID_CARD_SCENE', 'scene 必须是 front / back / handheld')
        return
      }
      const file = ctx.file
      if (!file || !file.buffer) {
        setError(ctx, 'ID_CARD_IMAGE_REQUIRED', '请选择身份证图片')
        return
      }

      try {
        const user = ctx.state.iosIdentityUpload.user
        const uploaded = await deps.uploadIdCard({
          buffer: file.buffer,
          contentType: file.mimetype || 'image/jpeg',
          originalName: file.originalname || `${scene}.jpg`,
          scene,
          phone: deps.normalizePhone(user.phone),
        })
        ctx.body = deps.success(uploaded)
      }
      catch (error) {
        const raw = String(error && error.message || '上传失败')
        const status = raw === 'oss_not_configured' ? 503 : 400
        setError(ctx, 'ID_CARD_UPLOAD_FAILED', raw === 'oss_not_configured' ? '图片服务暂不可用' : raw, status)
      }
    },
  )
}

module.exports = {
  registerUploadRoutes,
  requireUploadUser,
}
