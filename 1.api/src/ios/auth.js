function setError(ctx, code, msg, status = 400) {
  ctx.status = status
  ctx.body = { success: false, code, msg, data: null }
}

function sanitizeUser(user) {
  if (!user || typeof user !== 'object') return user
  const { passwordHash, adminPasswordPlain, ...safeUser } = user
  return safeUser
}

function registerAuthRoutes(router, deps) {
  router.post('/ios/auth/register/sms/send', async (ctx) => {
    const body = ctx.request.body || {}
    const phone = deps.normalizePhone(body.phone)
    if (!/^1\d{10}$/.test(phone)) {
      setError(ctx, 'INVALID_PHONE', '手机号格式不正确')
      return
    }

    const db = deps.readDb()
    if (db.users.some(item => deps.normalizePhone(item && item.phone) === phone)) {
      setError(ctx, 'PHONE_ALREADY_REGISTERED', '该手机号已注册，请直接登录', 409)
      return
    }

    try {
      await deps.sendRegisterSms(phone)
      ctx.body = deps.success({})
    }
    catch (error) {
      const status = Number(error && error.httpStatus)
      setError(
        ctx,
        'SMS_SEND_FAILED',
        String(error && error.message || '短信发送失败'),
        status >= 400 && status < 600 ? status : 500,
      )
    }
  })

  router.post('/ios/auth/register', async (ctx) => {
    const body = ctx.request.body || {}
    const phone = deps.normalizePhone(body.phone)
    const smsCode = String(body.smsCode || '').trim()
    const password = String(body.password || '')
    const channel = String(body.channel || '').trim()

    if (!/^1\d{10}$/.test(phone)) {
      setError(ctx, 'INVALID_PHONE', '手机号格式不正确')
      return
    }
    if (password !== password.trim()) {
      setError(ctx, 'INVALID_PASSWORD', '密码首尾不能包含空格')
      return
    }
    if (password.length < 6) {
      setError(ctx, 'INVALID_PASSWORD', '请设置至少 6 位登录密码')
      return
    }

    const db = deps.readDb()
    if (db.users.some(item => deps.normalizePhone(item && item.phone) === phone)) {
      setError(ctx, 'PHONE_ALREADY_REGISTERED', '该手机号已注册，请直接登录', 409)
      return
    }

    const channelCheck = deps.resolveRegisterChannel(db, { channel }) || {}
    if (channelCheck.error) {
      setError(ctx, 'INVALID_REGISTER_CHANNEL', channelCheck.error.msg || '推广链接失效，请重新打开')
      return
    }

    const smsCheck = await deps.verifyRegisterSms(phone, smsCode)
    if (!smsCheck || !smsCheck.ok) {
      setError(ctx, 'INVALID_SMS_CODE', smsCheck && smsCheck.reason || '验证码无效')
      return
    }

    // iOS registration deliberately ignores all identity and contact fields from the client.
    const user = await deps.createUser(db, {
      phone,
      smsCode,
      password,
      channel,
      name: '商城用户',
      idCardFront: '',
      idCardBack: '',
      idCardHandheld: '',
      emergencyContacts: [],
    })
    if (user && typeof user === 'object') {
      delete user.adminPasswordPlain
    }
    await deps.writeUsers(db)
    ctx.body = deps.success(sanitizeUser(user))
  })
}

module.exports = {
  registerAuthRoutes,
  sanitizeUser,
  setError,
}
