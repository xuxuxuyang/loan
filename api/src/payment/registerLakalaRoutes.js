const lakalaPayment = require('./lakalaPaymentService')
const lakala = require('./lakalaClient')

function registerLakalaRoutes(router, ctxApi) {
  const {
    fail,
    success,
    readDb,
    resolvePlacingMallUserFromBearer,
  } = ctxApi

  router.post('/payment/lakala/preorder', async (ctx) => {
    try {
      const db = readDb()
      const mallUser = resolvePlacingMallUserFromBearer(ctx, db)
      if (!mallUser) {
        fail(ctx, '请先登录商城账号', 401)
        return
      }
      const payload = ctx.request.body || {}
      const data = await lakalaPayment.createMallPayment(ctx, payload, mallUser)
      ctx.body = success(data)
    }
    catch (err) {
      const code = err.statusCode || 400
      let msg = err.message || '创建支付失败'
      if (err.lakalaCode) {
        msg = `${msg}（${err.lakalaCode}）`
      }
      fail(ctx, msg, code)
    }
  })

  router.get('/payment/lakala/status/:outTradeNo', async (ctx) => {
    try {
      const db = readDb()
      const mallUser = resolvePlacingMallUserFromBearer(ctx, db)
      if (!mallUser) {
        fail(ctx, '请先登录商城账号', 401)
        return
      }
      const outTradeNo = String(ctx.params.outTradeNo || '').trim()
      if (!outTradeNo) {
        fail(ctx, '缺少支付流水号')
        return
      }
      const data = await lakalaPayment.syncPaymentStatus(outTradeNo, { mallUser })
      ctx.body = success(data)
    }
    catch (err) {
      const code = err.statusCode || 400
      fail(ctx, err.message || '查询支付失败', code)
    }
  })

  router.post('/payment/lakala/mock-complete/:outTradeNo', async (ctx) => {
    try {
      const db = readDb()
      const mallUser = resolvePlacingMallUserFromBearer(ctx, db)
      if (!mallUser) {
        fail(ctx, '请先登录商城账号', 401)
        return
      }
      const outTradeNo = String(ctx.params.outTradeNo || '').trim()
      const data = await lakalaPayment.mockCompletePayment(outTradeNo, mallUser)
      ctx.body = success(data)
    }
    catch (err) {
      const code = err.statusCode || 400
      fail(ctx, err.message || '模拟支付失败', code)
    }
  })

  router.post('/payment/lakala/notify', async (ctx) => {
    try {
      await lakalaPayment.handleNotifyPayload(ctx.request.body || {})
      ctx.body = { code: 'SUCCESS', message: '执行成功' }
    }
    catch (err) {
      console.error('[lakala-notify]', err)
      ctx.status = 500
      ctx.body = { code: 'FAIL', message: err.message || '处理失败' }
    }
  })

  router.get('/payment/lakala/config', async (ctx) => {
    ctx.body = success({
      enabled: lakala.isLakalaConfigured() || lakala.isLakalaMockEnabled(),
      mock: lakala.isLakalaMockEnabled(),
      mode: 'counter',
      channels: ['wechat', 'alipay', 'union'],
    })
  })
}

module.exports = { registerLakalaRoutes }
