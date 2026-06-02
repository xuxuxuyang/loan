const crypto = require('node:crypto')
const fs = require('node:fs')

/** 聚合收银台 API（见仓库根「支付接入」） */
const COUNTER_CREATE_PATH = '/api/v3/ccss/counter/order/special_create'
const COUNTER_QUERY_PATH = '/api/v3/ccss/counter/order/query'

function readEnvTrim(key) {
  return String(process.env[key] || '').trim()
}

function isLakalaConfigured() {
  return Boolean(
    readEnvTrim('LAKALA_APP_ID')
    && readEnvTrim('LAKALA_SERIAL_NO')
    && readEnvTrim('LAKALA_MERCHANT_NO')
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

function buildOrderEfficientTime(baseDate = new Date()) {
  const rawMinutes = Number(readEnvTrim('LAKALA_ORDER_EFFICIENT_MINUTES') || '120')
  const minutes = Number.isFinite(rawMinutes) ? rawMinutes : 120
  const capped = Math.min(Math.max(minutes, 5), 7 * 24 * 60)
  const end = new Date(baseDate.getTime() + capped * 60 * 1000)
  return formatReqTime(end)
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

function isApiSuccess(code) {
  const c = String(code || '')
  return c === '000000' || c === 'BBS00000'
}

function assertApiSuccess(resp, fallbackMsg) {
  if (!isApiSuccess(resp.code)) {
    const err = new Error(resp.msg || resp.message || fallbackMsg || '拉卡拉接口失败')
    err.lakalaCode = resp.code
    throw err
  }
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

function mockOutOrderNo(reqData) {
  return String(reqData.out_order_no || reqData.out_trade_no || `MOCK${Date.now()}`)
}

function mockLakalaResponse(pathSuffix, reqData) {
  const outOrderNo = mockOutOrderNo(reqData)
  if (pathSuffix.includes('special_create')) {
    return {
      code: '000000',
      msg: '成功（模拟）',
      resp_time: formatReqTime(),
      resp_data: {
        merchant_no: readEnvTrim('LAKALA_MERCHANT_NO') || 'MOCK_MERCHANT',
        out_order_no: outOrderNo,
        pay_order_no: `MOCK${Date.now()}`,
        order_create_time: formatReqTime(),
        order_efficient_time: buildOrderEfficientTime(),
        total_amount: String(reqData.total_amount || '1'),
        counter_url: `https://pay.wsmsd.cn/mock-counter/${encodeURIComponent(outOrderNo)}`,
      },
    }
  }
  if (pathSuffix.includes('/order/query')) {
    return {
      code: '000000',
      msg: '成功（模拟）',
      resp_time: formatReqTime(),
      resp_data: {
        out_order_no: outOrderNo,
        pay_order_no: String(reqData.pay_order_no || `MOCK${Date.now()}`),
        order_status: '0',
        total_amount: String(reqData.total_amount || '1'),
        order_trade_info_list: [],
      },
    }
  }
  return { code: '000000', msg: 'ok', resp_data: {} }
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

/**
 * 限定收银台仅能用某一种支付（counter_param.pay_mode 会锁死渠道，慎用）
 * LAKALA_COUNTER_PAY_MODE=WECHAT|ALIPAY 时生效；ALL 或留空表示不限制
 */
function resolveRestrictCounterPayMode() {
  const envMode = readEnvTrim('LAKALA_COUNTER_PAY_MODE').toUpperCase()
  if (envMode === 'WECHAT' || envMode === 'ALIPAY') {
    return envMode
  }
  return ''
}

/** 期望收银台打开时默认选中的方式（不限制其他方式） */
function resolveDefaultCounterPayMode(payChannel) {
  const envDefault = readEnvTrim('LAKALA_COUNTER_DEFAULT_PAY_MODE').toUpperCase()
  if (envDefault === 'WECHAT' || envDefault === 'ALIPAY') {
    return envDefault
  }
  const ch = String(payChannel || '').trim().toLowerCase()
  if (ch === 'wechat' || ch === 'alipay') {
    return mapPayChannelToAccountType(ch)
  }
  return ''
}

function buildCounterParam() {
  const restrict = resolveRestrictCounterPayMode()
  if (!restrict) {
    return ''
  }
  return JSON.stringify({ pay_mode: restrict })
}

/** 开关类 env：仅 1 / true / yes 为开启（0、空、false 均为关闭） */
function envFlagEnabled(key) {
  const v = readEnvTrim(key).toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

function shouldSendCounterTermNo() {
  return envFlagEnabled('LAKALA_COUNTER_SEND_TERM_NO')
}

/**
 * 聚合收银台 special_create 的 req_data（唯一组装入口，脚本与业务共用）
 * 开关见 api/.env.development、api/.env.production
 */
function buildCounterOrderReqData({
  outOrderNo,
  totalAmountYuan,
  orderInfo,
  notifyUrl,
  callbackUrl,
}) {
  const reqData = {
    out_order_no: outOrderNo,
    merchant_no: readEnvTrim('LAKALA_MERCHANT_NO'),
    total_amount: String(yuanToCents(totalAmountYuan)),
    order_efficient_time: buildOrderEfficientTime(),
    order_info: String(orderInfo || '商城支付').slice(0, 64),
    support_refund: 1,
    support_repeat_pay: 1,
  }
  const vposId = readEnvTrim('LAKALA_VPOS_ID')
  if (vposId) {
    reqData.vpos_id = vposId
  }
  const channelId = readEnvTrim('LAKALA_CHANNEL_ID')
  if (channelId) {
    reqData.channel_id = channelId
  }
  if (shouldSendCounterTermNo()) {
    const termNo = readEnvTrim('LAKALA_TERM_NO')
    if (termNo) {
      reqData.term_no = termNo
    }
  }
  if (notifyUrl) {
    reqData.notify_url = notifyUrl
  }
  if (callbackUrl) {
    reqData.callback_url = callbackUrl
  }
  const counterParam = buildCounterParam()
  if (counterParam) {
    reqData.counter_param = counterParam
  }
  return reqData
}

function yuanToCents(amountYuan) {
  const n = Number(amountYuan)
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error('支付金额无效')
  }
  return Math.round(n * 100)
}

async function createCounterOrder({
  outOrderNo,
  totalAmountYuan,
  orderInfo,
  notifyUrl,
  callbackUrl,
  payChannel: _payChannel,
}) {
  const reqData = buildCounterOrderReqData({
    outOrderNo,
    totalAmountYuan,
    orderInfo,
    notifyUrl,
    callbackUrl,
  })
  if (envFlagEnabled('LAKALA_PAY_DEBUG')) {
    console.log('[lakala] counter special_create req_data:', JSON.stringify(reqData, null, 2))
  }
  const resp = await lakalaPost(COUNTER_CREATE_PATH, reqData)
  assertApiSuccess(resp, '拉卡拉收银台下单失败')
  return resp.resp_data || {}
}

async function queryCounterOrder({ outOrderNo, payOrderNo }) {
  const reqData = {
    merchant_no: readEnvTrim('LAKALA_MERCHANT_NO'),
  }
  const channelId = readEnvTrim('LAKALA_CHANNEL_ID')
  if (channelId) {
    reqData.channel_id = channelId
  }
  if (payOrderNo) {
    reqData.pay_order_no = payOrderNo
  }
  else if (outOrderNo) {
    reqData.out_order_no = outOrderNo
  }
  else {
    throw new Error('查询缺少 out_order_no 或 pay_order_no')
  }
  const resp = await lakalaPost(COUNTER_QUERY_PATH, reqData)
  assertApiSuccess(resp, '拉卡拉收银台查询失败')
  return resp.resp_data || {}
}

/**
 * 拉卡拉短链把整段 query 做了一次 URL 编码（pageStyle%3DV2%26token%3D...）。
 * 原样二次跳转（尤其 iOS / 微信拉小程序后返回）易导致 token 解析失败，需解码为正常 query。
 */
function normalizeCounterUrl(url) {
  const raw = String(url || '').trim()
  if (!raw) {
    return raw
  }
  try {
    const u = new URL(raw)
    const host = u.hostname.toLowerCase()
    if (!host.includes('pay.wsmsd.cn') && !host.includes('pay.lakala.com') && !host.includes('huijingcai')) {
      return raw
    }
    const q = u.search.startsWith('?') ? u.search.slice(1) : ''
    if (q && (q.includes('%3D') || q.includes('%26') || q.includes('%3d') || q.includes('%26'))) {
      const decoded = decodeURIComponent(q)
      return `${u.origin}${u.pathname}?${decoded}`
    }
  }
  catch {
    return raw
  }
  return raw
}

function extractPayPresentation(respData) {
  const counterUrl = normalizeCounterUrl(respData.counter_url || '')
  const payOrderNo = String(respData.pay_order_no || '').trim()
  return {
    payCode: counterUrl,
    payCodeImage: '',
    tradeNo: payOrderNo,
    logNo: '',
    counterUrl,
    payOrderNo,
  }
}

/** 收银台 order_status：2=支付成功 */
function isOrderPaidStatus(orderStatus) {
  return String(orderStatus || '') === '2'
}

/** 兼容主扫 trade_state / 通知 trade_status */
function isTradeSuccessState(state) {
  const s = String(state || '').toUpperCase()
  return s === 'SUCCESS' || s === '2' || s === 'S'
}

function parseCounterQueryPaid(queried) {
  const orderStatus = String(queried.order_status || '').trim()
  if (isOrderPaidStatus(orderStatus)) {
    return { paid: true, tradeState: orderStatus }
  }
  const list = queried.order_trade_info_list
  if (Array.isArray(list) && list.some(item => String(item.trade_status || '').toUpperCase() === 'S')) {
    return { paid: true, tradeState: '2' }
  }
  const legacy = String(queried.trade_state || queried.trade_status || '').trim()
  if (isTradeSuccessState(legacy)) {
    return { paid: true, tradeState: legacy }
  }
  return { paid: false, tradeState: orderStatus || legacy }
}

/** @deprecated 别名，保持 service 调用兼容 */
const createPreorder = (opts) => createCounterOrder({
  outOrderNo: opts.outTradeNo,
  totalAmountYuan: opts.totalAmountYuan,
  orderInfo: opts.subject,
  notifyUrl: opts.notifyUrl,
  callbackUrl: opts.callbackUrl,
  payChannel: opts.payChannel,
})

/** @deprecated 别名 */
const queryTrade = (opts) => queryCounterOrder({
  outOrderNo: opts.outTradeNo,
  payOrderNo: opts.tradeNo,
})

module.exports = {
  isLakalaConfigured,
  isLakalaMockEnabled,
  mapPayChannelToAccountType,
  resolveRestrictCounterPayMode,
  resolveDefaultCounterPayMode,
  buildCounterParam,
  buildCounterOrderReqData,
  envFlagEnabled,
  shouldSendCounterTermNo,
  normalizeCounterUrl,
  formatReqTime,
  yuanToCents,
  createCounterOrder,
  queryCounterOrder,
  createPreorder,
  queryTrade,
  extractPayPresentation,
  isApiSuccess,
  isOrderPaidStatus,
  isTradeSuccessState,
  parseCounterQueryPaid,
  readEnvTrim,
  resolveApiBase,
  buildOrderEfficientTime,
  COUNTER_CREATE_PATH,
  COUNTER_QUERY_PATH,
}
