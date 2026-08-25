const {
  isRiskUpstreamConfigured,
  orderRiskChannelAndEnvelopeOk,
  postClSmsSend,
} = require('./riskControl/upstreamClient')

function createAdminSecuritySmsSender(options = {}) {
  const isConfigured = options.isConfigured || isRiskUpstreamConfigured
  const postSms = options.postSms || postClSmsSend
  const parseResponse = options.parseResponse || orderRiskChannelAndEnvelopeOk

  return async function sendAdminSecuritySms(phone, message) {
    if (!isConfigured()) {
      throw new Error('后台安全短信通道未配置')
    }
    let response
    try {
      response = await postSms({ phone, msg: message })
    }
    catch (error) {
      throw new Error(error?.message || '调用后台安全短信通道失败')
    }
    const parsed = parseResponse(response)
    if (!parsed?.ok) {
      throw new Error(parsed?.reason || '后台安全短信发送失败')
    }
  }
}

function isAdminSecuritySmsReady() {
  return isRiskUpstreamConfigured()
}

module.exports = { createAdminSecuritySmsSender, isAdminSecuritySmsReady }
