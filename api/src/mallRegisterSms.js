const {
  postClSmsSend,
  isRiskUpstreamConfigured,
  orderRiskChannelAndEnvelopeOk,
} = require('./riskControl/upstreamClient')

/** phone -> { code, expiresAt, lastSentAt } */
const registerSmsByPhone = new Map()

const TTL_MS = Number(process.env.MALL_REGISTER_SMS_TTL_MS || 5 * 60 * 1000)
const RESEND_MS = Number(process.env.MALL_REGISTER_SMS_RESEND_MS || 60 * 1000)

function pruneStaleEntries() {
  const now = Date.now()
  for (const [phone, row] of registerSmsByPhone.entries()) {
    if (now > row.expiresAt + 120_000) {
      registerSmsByPhone.delete(phone)
    }
  }
}

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000))
}

function buildRegisterSmsMsg(code) {
  let tpl = String(process.env.MALL_REGISTER_SMS_MSG_TEMPLATE || '').trim()
  const signBracket = String(process.env.MALL_REGISTER_SMS_SIGN_BRACKET || '').trim()

  if (!tpl) {
    // 与运营商备案一致（可整体覆盖：MALL_REGISTER_SMS_MSG_TEMPLATE）
    const sign = signBracket || '宁波海曙文硕'
    tpl = `【${sign}】您的注册验证码为{code}，5分钟内有效`
  }
  else if (!/【[^】]+】/.test(tpl) && signBracket) {
    tpl = `【${signBracket}】${tpl}`
  }

  if (!tpl.includes('{code}')) {
    const err = new Error('短信模板须包含占位符 {code}（环境变量 MALL_REGISTER_SMS_MSG_TEMPLATE）')
    err.httpStatus = 503
    throw err
  }
  return tpl.split('{code}').join(code)
}

/** 上游顶层 msg 为空时，尝试从 data 里带出可读原因（便于排查 50001 等） */
function describeClSmsUpstreamFailure(res, channelReason) {
  const j = res && res.json
  if (!j || typeof j !== 'object') {
    return channelReason || '短信发送失败'
  }
  let detail = ''
  const d = j.data
  if (typeof d === 'string' && d.trim()) {
    detail = d.trim().slice(0, 400)
  }
  else if (d && typeof d === 'object') {
    const sub = d.msg ?? d.message ?? d.errMsg ?? d.err_msg ?? d.error ?? d.desc ?? d.reason
    if (sub != null && String(sub).trim()) {
      detail = String(sub).trim().slice(0, 400)
    }
    else {
      try {
        const s = JSON.stringify(d)
        if (s && s !== '{}' && s !== '[]') {
          detail = s.slice(0, 400)
        }
      }
      catch {
        /* noop */
      }
    }
  }
  const main = channelReason || '短信发送失败'
  if (detail && !main.includes(detail)) {
    return `${main}（详情：${detail}）`
  }
  return main
}

/**
 * 向未注册手机号发送注册验证码：经风控上游 POST /api/clSms/send（与 riskControl/router forwardClSmsSend 一致，data 含 phone、msg）。
 * @param {string} phone 11 位国内手机号
 */
async function sendRegisterVerificationSms(phone) {
  pruneStaleEntries()
  const now = Date.now()
  const prev = registerSmsByPhone.get(phone)
  if (prev && now - prev.lastSentAt < RESEND_MS) {
    const err = new Error('发送过于频繁，请稍后再试')
    err.httpStatus = 429
    throw err
  }

  if (!isRiskUpstreamConfigured()) {
    const err = new Error('未配置风控上游（RISK_UPSTREAM_* 或 HD_CLOUD_BASE_URL / HD_CLOUD_APP_ID / HD_CLOUD_APP_KEY）')
    err.httpStatus = 503
    throw err
  }

  const code = generateCode()
  const msg = buildRegisterSmsMsg(code)

  let res
  try {
    res = await postClSmsSend({ phone, msg })
  }
  catch (e) {
    const err = new Error(e && e.message ? e.message : '调用验证码短信接口失败')
    err.httpStatus = 502
    throw err
  }

  const ch = orderRiskChannelAndEnvelopeOk(res)
  if (!ch.ok) {
    const text = describeClSmsUpstreamFailure(res, ch.reason)
    console.warn('[mallRegisterSms] clSms/send rejected', { phone, upstream: res && res.json })
    const err = new Error(text)
    err.httpStatus = res && Number(res.status) >= 400 && Number(res.status) < 600 ? Number(res.status) : 502
    throw err
  }

  registerSmsByPhone.set(phone, {
    code,
    expiresAt: now + TTL_MS,
    lastSentAt: now,
  })
}

/**
 * 校验并消费注册短信验证码（成功则删除缓存，失败不消费）。
 * @param {string} phone
 * @param {string} inputCode
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
function verifyAndConsumeRegisterSms(phone, inputCode) {
  const want = String(inputCode || '').trim()
  if (!/^\d{6}$/.test(want)) {
    return { ok: false, reason: '请输入 6 位短信验证码' }
  }
  const row = registerSmsByPhone.get(phone)
  if (!row) {
    return { ok: false, reason: '请先获取短信验证码' }
  }
  if (Date.now() > row.expiresAt) {
    registerSmsByPhone.delete(phone)
    return { ok: false, reason: '验证码已过期，请重新获取' }
  }
  if (want !== row.code) {
    return { ok: false, reason: '短信验证码不正确' }
  }
  registerSmsByPhone.delete(phone)
  return { ok: true }
}

module.exports = {
  sendRegisterVerificationSms,
  verifyAndConsumeRegisterSms,
}
