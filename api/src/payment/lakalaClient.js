const crypto = require('node:crypto')
const fs = require('node:fs')

function readEnvTrim(key) {
  return String(process.env[key] || '').trim()
}

function isLakalaConfigured() {
  return Boolean(
    readEnvTrim('LAKALA_APP_ID')
    && readEnvTrim('LAKALA_SERIAL_NO')
    && readEnvTrim('LAKALA_MERCHANT_NO')
    && readEnvTrim('LAKALA_TERM_NO')
    && (readEnvTrim('LAKALA_PRIVATE_KEY') || readEnvTrim('LAKALA_PRIVATE_KEY_PATH')),
  )
}

function isLakalaMockEnabled() {
  if (readEnvTrim('LAKALA_MOCK') === '1') {
    return true
  }
  if (readEnvTrim('LAKALA_MOCK') === '0') {
    return false
  }
  return !isLakalaConfigured() && process.env.NODE_ENV !== 'production'
}

function resolveApiBase() {
  const custom = readEnvTrim('LAKALA_API_BASE')
  if (custom) {
    return custom.replace(/\/$/, '')
  }
  return process.env.NODE_ENV === 'production'
    ? 'https://s2.lakala.com'
    : 'https://test.wsmsd.cn/sit'
}

function loadPrivateKeyPem() {
  const inline = readEnvTrim('LAKALA_PRIVATE_KEY')
  if (inline) {
    return inline.includes('BEGIN') ? inline : inline.replace(/\\n/g, '\n')
  }
  const filePath = readEnvTrim('LAKALA_PRIVATE_KEY_PATH')
  if (filePath && fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, 'utf8')
  }
  return ''
}

function loadPlatformPublicKeyPem() {
  const inline = readEnvTrim('LAKALA_PLATFORM_PUBLIC_KEY')
  if (inline) {
    return inline.includes('BEGIN') ? inline : inline.replace(/\\n/g, '\n')
  }
  const filePath = readEnvTrim('LAKALA_PLATFORM_PUBLIC_KEY_PATH')
  if (filePath && fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, 'utf8')
  }
  return ''
}

function formatReqTime(date = new Date()) {
  const pad = (n, len = 2) => String(n).padStart(len, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function randomNonceStr(len = 12) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let out = ''
  for (let i = 0; i < len; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)]
  }
  return out
}

function buildAuthorizationHeader({ appId, serialNo, timestamp, nonceStr, signature }) {
  return `LKLAPI-SHA256withRSA appid="${appId}",serial_no="${serialNo}",timestamp="${timestamp}",nonce_str="${nonceStr}",signature="${signature}"`
}

function signRequestBody(bodyString) {
  const appId = readEnvTrim('LAKALA_APP_ID')
  const serialNo = readEnvTrim('LAKALA_SERIAL_NO')
  const privateKeyPem = loadPrivateKeyPem()
  if (!appId || !serialNo || !privateKeyPem) {
    throw new Error('拉卡拉签名配置不完整（LAKALA_APP_ID / LAKALA_SERIAL_NO / LAKALA_PRIVATE_KEY）')
  }
  const timestamp = Math.floor(Date.now() / 1000)
  const nonceStr = randomNonceStr(12)
  const preSign = `${appId}\n${serialNo}\n${timestamp}\n${nonceStr}\n${bodyString}\n`
  const sign = crypto.createSign('RSA-SHA256')
  sign.update(preSign, 'utf8')
  sign.end()
  const signature = sign.sign(privateKeyPem, 'base64')
  return {
    authorization: buildAuthorizationHeader({ appId, serialNo, timestamp, nonceStr, signature }),
    appId,
    serialNo,
    timestamp,
    nonceStr,
  }
}

function verifyResponseSignature(headers, bodyString) {
  const publicKeyPem = loadPlatformPublicKeyPem()
  if (!publicKeyPem) {
    return true
  }
  const signature = String(headers['lklapi-signature'] || headers['Lklapi-Signature'] || '').trim()
  if (!signature) {
    return false
  }
  const appId = String(headers['lklapi-appid'] || headers['Lklapi-Appid'] || readEnvTrim('LAKALA_APP_ID')).trim()
  const serialNo = String(headers['lklapi-serial'] || headers['Lklapi-Serial'] || '').trim()
  const timestamp = String(headers['lklapi-timestamp'] || headers['Lklapi-Timestamp'] || '').trim()
  const nonceStr = String(headers['lklapi-nonce'] || headers['Lklapi-Nonce'] || '').trim()
  const preSign = `${appId}\n${serialNo}\n${timestamp}\n${nonceStr}\n${bodyString}\n`
  const verify = crypto.createVerify('RSA-SHA256')
  verify.update(preSign, 'utf8')
  verify.end()
  return verify.verify(publicKeyPem, signature, 'base64')
}

async function lakalaPost(pathSuffix, reqData, { skipSign = false } = {}) {
  if (isLakalaMockEnabled()) {
    return mockLakalaResponse(pathSuffix, reqData)
  }
  const body = {
    req_time: formatReqTime(),
    version: '3.0',
    req_data: reqData,
  }
  const bodyString = JSON.stringify(body)
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  if (!skipSign) {
    const signed = signRequestBody(bodyString)
    headers.Authorization = signed.authorization
  }
  const url = `${resolveApiBase()}${pathSuffix}`
  const res = await fetch(url, { method: 'POST', headers, body: bodyString })
  const text = await res.text()
  let parsed
  try {
    parsed = JSON.parse(text)
  }
  catch {
    throw new Error(`拉卡拉响应非 JSON：${text.slice(0, 200)}`)
  }
  if (!verifyResponseSignature(res.headers, text)) {
    console.warn('[lakala] 响应验签未通过，仍解析业务结果')
  }
  return parsed
}

function mockLakalaResponse(pathSuffix, reqData) {
  const outTradeNo = String(reqData.out_trade_no || `MOCK${Date.now()}`)
  if (pathSuffix.includes('preorder')) {
    const isWechat = String(reqData.account_type || '').toUpperCase() === 'WECHAT'
    const code = isWechat
      ? 'weixin://wxpay/bizpayurl?pr=MOCK_DEMO'
      : `https://qr.alipay.com/mock/${outTradeNo}`
    return {
      code: 'BBS00000',
      msg: '成功（模拟）',
      resp_time: formatReqTime(),
      resp_data: {
        merchant_no: readEnvTrim('LAKALA_MERCHANT_NO') || 'MOCK_MERCHANT',
        out_trade_no: outTradeNo,
        trade_no: `MOCK${Date.now()}`,
        log_no: String(Date.now()).slice(-14),
        acc_resp_fields: { code, code_image: '' },
      },
    }
  }
  if (pathSuffix.includes('tradequery')) {
    return {
      code: 'BBS00000',
      msg: '成功（模拟）',
      resp_time: formatReqTime(),
      resp_data: {
        out_trade_no: outTradeNo,
        trade_no: `MOCK${Date.now()}`,
        trade_state: 'SUCCESS',
        trade_state_desc: '交易成功（模拟）',
        total_amount: String(reqData.total_amount || reqData.amount || '1'),
        account_type: reqData.account_type || 'ALIPAY',
      },
    }
  }
  return { code: 'BBS00000', msg: 'ok', resp_data: {} }
}

function mapPayChannelToAccountType(payChannel) {
  const ch = String(payChannel || '').toLowerCase()
  if (ch === 'wechat') {
    return 'WECHAT'
  }
  if (ch === 'alipay') {
    return 'ALIPAY'
  }
  return 'ALIPAY'
}

function yuanToCents(amountYuan) {
  const n = Number(amountYuan)
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error('支付金额无效')
  }
  return Math.round(n * 100)
}

async function createPreorder({
  outTradeNo,
  totalAmountYuan,
  accountType,
  subject,
  notifyUrl,
  requestIp,
}) {
  const reqData = {
    merchant_no: readEnvTrim('LAKALA_MERCHANT_NO'),
    term_no: readEnvTrim('LAKALA_TERM_NO'),
    out_trade_no: outTradeNo,
    account_type: accountType,
    trans_type: '41',
    total_amount: String(yuanToCents(totalAmountYuan)),
    subject: String(subject || '商城支付').slice(0, 42),
    notify_url: notifyUrl,
    location_info: {
      request_ip: requestIp || '127.0.0.1',
      location: readEnvTrim('LAKALA_LOCATION') || '+31.230416/+121.473701',
    },
  }
  const resp = await lakalaPost('/api/v3/labs/trans/preorder', reqData)
  if (String(resp.code) !== 'BBS00000') {
    const err = new Error(resp.msg || resp.message || '拉卡拉预下单失败')
    err.lakalaCode = resp.code
    throw err
  }
  return resp.resp_data || {}
}

async function queryTrade({ outTradeNo, tradeNo }) {
  const reqData = {
    merchant_no: readEnvTrim('LAKALA_MERCHANT_NO'),
    term_no: readEnvTrim('LAKALA_TERM_NO'),
  }
  if (tradeNo) {
    reqData.trade_no = tradeNo
  }
  else {
    reqData.out_trade_no = outTradeNo
  }
  const resp = await lakalaPost('/api/v3/labs/query/tradequery', reqData)
  if (String(resp.code) !== 'BBS00000') {
    const err = new Error(resp.msg || resp.message || '拉卡拉查询失败')
    err.lakalaCode = resp.code
    throw err
  }
  return resp.resp_data || {}
}

function extractPayPresentation(respData) {
  const fields = respData && respData.acc_resp_fields ? respData.acc_resp_fields : {}
  const code = String(fields.code || fields.redirect_url || '').trim()
  const codeImage = String(fields.code_image || '').trim()
  return {
    payCode: code,
    payCodeImage: codeImage,
    tradeNo: String(respData.trade_no || '').trim(),
    logNo: String(respData.log_no || '').trim(),
  }
}

function isTradeSuccessState(state) {
  const s = String(state || '').toUpperCase()
  return s === 'SUCCESS'
}

module.exports = {
  isLakalaConfigured,
  isLakalaMockEnabled,
  mapPayChannelToAccountType,
  yuanToCents,
  createPreorder,
  queryTrade,
  extractPayPresentation,
  isTradeSuccessState,
  readEnvTrim,
  resolveApiBase,
}
