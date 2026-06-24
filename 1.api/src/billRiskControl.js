const crypto = require('node:crypto')

const TOKEN_REFRESH_SKEW_MS = 60 * 1000

let cachedToken = null

function trimEnv(key, fallback = '') {
  const raw = process.env[key]
  if (raw === undefined || raw === null) {
    return fallback
  }
  const text = String(raw).trim()
  return text || fallback
}

function positiveIntEnv(key, fallback) {
  const n = Number(trimEnv(key))
  return Number.isInteger(n) && n > 0 ? n : fallback
}

function normalizeBaseUrl(raw) {
  return String(raw || '').trim().replace(/\/+$/, '')
}

function normalizePath(raw, fallback) {
  const text = String(raw || fallback || '').trim()
  if (!text) {
    return ''
  }
  return text.startsWith('/') ? text : `/${text}`
}

function getBillRiskConfig() {
  const apiBaseUrl = normalizeBaseUrl(trimEnv('BILL_RISK_API_BASE_URL', 'https://saas.flow.eeiai.cn/saas'))
  return {
    apiBaseUrl,
    tokenPath: normalizePath(trimEnv('BILL_RISK_TOKEN_PATH'), '/open/api/get/token'),
    mailPath: normalizePath(trimEnv('BILL_RISK_MAIL_PATH'), '/open/api/user/many/mail'),
    processPageUrl: trimEnv('BILL_RISK_PROCESS_PAGE_URL', 'https://flow-process.699e.cn/billProcess'),
    backUrl: trimEnv('BILL_RISK_BACK_URL'),
    callbackUrl: trimEnv('BILL_RISK_CALLBACK_URL'),
    processType: trimEnv('BILL_RISK_PROCESS_TYPE', 'h5'),
    username: trimEnv('BILL_RISK_USERNAME'),
    password: trimEnv('BILL_RISK_PASSWORD'),
    publicKey: trimEnv('BILL_RISK_PUBLIC_KEY').replace(/\\n/g, '\n'),
    callbackSignSecret: trimEnv('BILL_RISK_CALLBACK_SIGN_SECRET'),
    timeoutMs: positiveIntEnv('BILL_RISK_TIMEOUT_MS', 15000),
  }
}

function isBillRiskConfigured() {
  const cfg = getBillRiskConfig()
  return Boolean(cfg.apiBaseUrl && cfg.username && cfg.password && cfg.publicKey)
}

function buildUpstreamUrl(cfg, path) {
  return `${cfg.apiBaseUrl}${normalizePath(path)}`
}

function buildPemPublicKey(raw) {
  const text = String(raw || '').trim()
  if (!text) {
    throw new Error('未配置流水风控 RSA 公钥')
  }
  if (text.includes('BEGIN PUBLIC KEY')) {
    return text
  }
  return `-----BEGIN PUBLIC KEY-----\n${text.replace(/\s+/g, '').match(/.{1,64}/g).join('\n')}\n-----END PUBLIC KEY-----`
}

async function fetchJsonWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    })
    const payload = await response.json().catch(() => ({}))
    return { response, payload }
  }
  finally {
    clearTimeout(timer)
  }
}

async function getAccessToken(cfg = getBillRiskConfig()) {
  const now = Date.now()
  if (cachedToken && cachedToken.token && cachedToken.expireAt > now + TOKEN_REFRESH_SKEW_MS) {
    return cachedToken.token
  }

  const { response, payload } = await fetchJsonWithTimeout(
    buildUpstreamUrl(cfg, cfg.tokenPath),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ username: cfg.username, password: cfg.password }),
    },
    cfg.timeoutMs,
  )
  if (!response.ok || Number(payload?.code) !== 200 || !payload?.data?.accessToken) {
    throw new Error(String(payload?.msg || '获取流水风控 Token 失败'))
  }
  cachedToken = {
    token: String(payload.data.accessToken),
    expireAt: now + 30 * 60 * 1000,
  }
  return cachedToken.token
}

function rsaEncryptSign(signData, publicKey) {
  const pem = buildPemPublicKey(publicKey)
  const keyObj = crypto.createPublicKey(pem)
  const keySize = Math.ceil((keyObj.asymmetricKeyDetails?.modulusLength || 1024) / 8)
  const maxChunkSize = keySize - 11
  const input = Buffer.from(JSON.stringify(signData), 'utf8')
  const chunks = []
  for (let offset = 0; offset < input.length; offset += maxChunkSize) {
    chunks.push(crypto.publicEncrypt({
      key: pem,
      padding: crypto.constants.RSA_PKCS1_PADDING,
    }, input.subarray(offset, offset + maxChunkSize)))
  }
  return Buffer.concat(chunks).toString('base64')
}

function normalizeBillRiskRecord(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const reports = Array.isArray(source.reports) ? source.reports : []
  return {
    flowId: String(source.flowId || '').trim(),
    userId: String(source.userId || '').trim(),
    email: String(source.email || '').trim(),
    userName: String(source.userName || '').trim(),
    expireTime: source.expireTime != null ? Number(source.expireTime) : null,
    lastGeneratedAt: String(source.lastGeneratedAt || '').trim(),
    reports: reports
      .filter(item => item && typeof item === 'object')
      .map(item => ({ ...item }))
      .sort((a, b) => Number(b.receivedAtMs || 0) - Number(a.receivedAtMs || 0)),
  }
}

function buildGuideUrl(record, cfg = getBillRiskConfig()) {
  const flowId = String(record?.flowId || '').trim()
  if (!flowId || !cfg.processPageUrl) {
    return ''
  }
  const url = new URL(cfg.processPageUrl)
  url.searchParams.set('flowId', flowId)
  if (cfg.backUrl) {
    url.searchParams.set('backUrl', cfg.backUrl)
  }
  if (cfg.processType) {
    url.searchParams.set('type', cfg.processType)
  }
  return url.toString()
}

function buildBillRiskView(user, cfg = getBillRiskConfig()) {
  const record = normalizeBillRiskRecord(user?.billRiskControl)
  return {
    configured: isBillRiskConfigured(),
    processType: cfg.processType,
    backUrlConfigured: Boolean(cfg.backUrl),
    callbackConfigured: Boolean(cfg.callbackUrl),
    callbackSignEnabled: Boolean(cfg.callbackSignSecret),
    record,
    guideUrl: buildGuideUrl(record, cfg),
  }
}

function normalizeIdNumber(raw) {
  return String(raw || '').trim().toUpperCase()
}

function normalizeUserName(raw) {
  return String(raw || '').trim()
}

async function generateBillRiskMailForUser(user) {
  if (!user || typeof user !== 'object') {
    throw new Error('用户不存在')
  }
  const cfg = getBillRiskConfig()
  if (!isBillRiskConfigured()) {
    throw new Error('未配置流水风控接口，请先配置 BILL_RISK_* 环境变量')
  }
  const userName = normalizeUserName(user.name)
  const userCard = normalizeIdNumber(user.idNumber)
  if (!userName || !userCard) {
    throw new Error('用户姓名或身份证号缺失，无法生成流水风控动态邮箱')
  }

  const token = await getAccessToken(cfg)
  const timeStamp = Date.now()
  const sign = rsaEncryptSign({
    token,
    getUrl: cfg.mailPath,
    timeStamp,
  }, cfg.publicKey)

  const { response, payload } = await fetchJsonWithTimeout(
    buildUpstreamUrl(cfg, cfg.mailPath),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: token,
      },
      body: JSON.stringify({
        sign,
        timeStamp,
        userEmail: {
          userName,
          userCard,
          dockingSign: String(user.id || '').trim(),
        },
      }),
    },
    cfg.timeoutMs,
  )
  if (!response.ok || Number(payload?.code) !== 200 || !payload?.data?.flowId) {
    throw new Error(String(payload?.msg || '生成流水风控动态邮箱失败'))
  }

  const previous = normalizeBillRiskRecord(user.billRiskControl)
  const data = payload.data || {}
  const next = normalizeBillRiskRecord({
    ...previous,
    flowId: data.flowId,
    userId: data.userId,
    email: data.email,
    userName: data.userName || userName,
    expireTime: data.expireTime,
    lastGeneratedAt: new Date().toISOString(),
    reports: previous.reports,
  })
  user.billRiskControl = next
  return {
    upstream: payload,
    view: buildBillRiskView(user, cfg),
  }
}

function verifyCallbackSign(body, cfg = getBillRiskConfig()) {
  if (!cfg.callbackSignSecret) {
    return true
  }
  const mailId = String(body?.mailId || '').trim()
  const sign = String(body?.sign || '').trim()
  if (!mailId || !sign) {
    return false
  }
  const expected = crypto
    .createHash('md5')
    .update(`${mailId}${cfg.callbackSignSecret}`, 'utf8')
    .digest('hex')
  return expected.toLowerCase() === sign.toLowerCase()
}

function findBillRiskCallbackUser(db, body) {
  if (!db || !Array.isArray(db.users)) {
    return null
  }
  const dockingSign = String(body?.dockingSign || '').trim()
  if (dockingSign) {
    const byDockingSign = db.users.find(item => String(item.id || '').trim() === dockingSign)
    if (byDockingSign) {
      return byDockingSign
    }
  }
  const idcard = normalizeIdNumber(body?.idcard)
  const name = normalizeUserName(body?.name)
  if (!idcard && !name) {
    return null
  }
  return db.users.find((item) => {
    const sameCard = idcard && normalizeIdNumber(item.idNumber) === idcard
    const sameName = !name || normalizeUserName(item.name) === name
    return sameCard && sameName
  }) || null
}

function normalizeCallbackReport(body) {
  const now = Date.now()
  const source = body && typeof body === 'object' ? body : {}
  return {
    mailId: String(source.mailId || '').trim(),
    type: String(source.type || '').trim(),
    name: normalizeUserName(source.name),
    idcard: normalizeIdNumber(source.idcard),
    subject: String(source.subject || '').trim(),
    from: String(source.from || '').trim(),
    receiver: String(source.receiver || '').trim(),
    account: String(source.account || '').trim(),
    nickname: String(source.nickname || '').trim(),
    url: String(source.url || '').trim(),
    reportURL: String(source.reportURL || '').trim(),
    orderNumber: String(source.orderNumber || '').trim(),
    sendTime: source.sendTime != null ? Number(source.sendTime) : null,
    startTime: source.startTime != null ? Number(source.startTime) : null,
    endTime: source.endTime != null ? Number(source.endTime) : null,
    dockingSign: String(source.dockingSign || '').trim(),
    isCost: typeof source.isCost === 'boolean' ? source.isCost : Boolean(source.isCost),
    receivedAt: new Date(now).toISOString(),
    receivedAtMs: now,
  }
}

function shouldIgnoreCallbackBody(body) {
  const type = String(body?.type || '').trim()
  if ((type === 'WECHAT' || type === 'ALIPAY') && (!body?.name || !body?.idcard)) {
    return true
  }
  return false
}

function applyBillRiskCallback(db, body) {
  const cfg = getBillRiskConfig()
  if (!verifyCallbackSign(body, cfg)) {
    return { ok: false, status: 403, ignored: true, reason: 'invalid_sign' }
  }
  if (shouldIgnoreCallbackBody(body)) {
    return { ok: true, ignored: true, reason: 'missing_identity' }
  }
  const user = findBillRiskCallbackUser(db, body)
  if (!user) {
    return { ok: true, ignored: true, reason: 'user_not_found' }
  }

  const record = normalizeBillRiskRecord(user.billRiskControl)
  const report = normalizeCallbackReport(body)
  const reports = Array.isArray(record.reports) ? [...record.reports] : []
  const key = report.mailId || `${report.type}:${report.idcard}:${report.reportURL}`
  const idx = reports.findIndex((item) => {
    const itemKey = String(item.mailId || '') || `${item.type}:${item.idcard}:${item.reportURL}`
    return itemKey === key
  })
  if (idx >= 0) {
    reports[idx] = { ...reports[idx], ...report }
  }
  else {
    reports.unshift(report)
  }
  record.reports = reports
    .sort((a, b) => Number(b.receivedAtMs || 0) - Number(a.receivedAtMs || 0))
    .slice(0, positiveIntEnv('BILL_RISK_REPORT_HISTORY_MAX', 30))
  user.billRiskControl = record
  return { ok: true, ignored: false, user }
}

module.exports = {
  applyBillRiskCallback,
  buildBillRiskView,
  generateBillRiskMailForUser,
  getBillRiskConfig,
  isBillRiskConfigured,
  normalizeBillRiskRecord,
}
