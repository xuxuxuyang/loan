function readTrim(value) {
  return value == null ? '' : String(value).trim()
}

function boolFromEnv(value) {
  return ['1', 'true', 'yes', 'on'].includes(readTrim(value).toLowerCase())
}

function parseExplicitNumber(value) {
  const raw = readTrim(value)
  if (!raw) return undefined
  const number = Number(raw)
  return Number.isFinite(number) ? number : NaN
}

function halfFlowTrafficConfigFromEnv(env = process.env) {
  return {
    enabled: boolFromEnv(env.HALF_FLOW_TRAFFIC_ENABLED),
    routePrefix: readTrim(env.HALF_FLOW_TRAFFIC_ROUTE_PREFIX).replace(/\/+$/, ''),
    channelCode: readTrim(env.HALF_FLOW_TRAFFIC_CHANNEL_CODE),
    registerChannelCode: readTrim(env.HALF_FLOW_TRAFFIC_REGISTER_CHANNEL_CODE),
    registerChannelName: readTrim(env.HALF_FLOW_TRAFFIC_REGISTER_CHANNEL_NAME),
    aesKey: readTrim(env.HALF_FLOW_TRAFFIC_AES_KEY),
    creditNotifyUrl: readTrim(env.HALF_FLOW_TRAFFIC_CREDIT_NOTIFY_URL),
    customerServicePhone: readTrim(env.HALF_FLOW_TRAFFIC_CUSTOMER_SERVICE_PHONE),
    defaultAmount: parseExplicitNumber(env.HALF_FLOW_TRAFFIC_DEFAULT_AMOUNT),
    defaultUserQuota: parseExplicitNumber(env.HALF_FLOW_TRAFFIC_DEFAULT_USER_QUOTA),
    creditExpireDays: parseExplicitNumber(env.HALF_FLOW_TRAFFIC_CREDIT_EXPIRE_DAYS),
    loginTokenTtlMs: parseExplicitNumber(env.HALF_FLOW_TRAFFIC_LOGIN_TOKEN_TTL_MS),
    notifyTimeoutMs: parseExplicitNumber(env.HALF_FLOW_TRAFFIC_NOTIFY_TIMEOUT_MS),
    loanUrlTemplate: readTrim(env.HALF_FLOW_TRAFFIC_LOAN_URL_TEMPLATE),
  }
}

function resolveHalfFlowTrafficConfig(config = {}) {
  const merged = { ...halfFlowTrafficConfigFromEnv(), ...config }
  merged.enabled = Boolean(merged.enabled)
  merged.routePrefix = readTrim(merged.routePrefix).replace(/\/+$/, '')
  merged.channelCode = readTrim(merged.channelCode)
  merged.registerChannelCode = readTrim(merged.registerChannelCode)
  merged.registerChannelName = readTrim(merged.registerChannelName)
  merged.aesKey = readTrim(merged.aesKey)
  merged.creditNotifyUrl = readTrim(merged.creditNotifyUrl)
  merged.customerServicePhone = readTrim(merged.customerServicePhone)
  merged.loanUrlTemplate = readTrim(merged.loanUrlTemplate)
  for (const field of ['defaultAmount', 'defaultUserQuota', 'creditExpireDays', 'loginTokenTtlMs', 'notifyTimeoutMs']) {
    if (merged[field] != null && merged[field] !== '') merged[field] = Number(merged[field])
  }
  return merged
}

function isHttpUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  }
  catch {
    return false
  }
}

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === 'https:'
  }
  catch {
    return false
  }
}

function hasValidAesKey(value) {
  const raw = readTrim(value)
  if (!raw || raw.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) return false
  const key = Buffer.from(raw, 'base64')
  return key.toString('base64') === raw && [16, 24, 32].includes(key.length)
}

const SAFE_INTEGER_RANGES = Object.freeze({
  defaultAmount: [1, 10_000_000],
  defaultUserQuota: [1, 10_000_000],
  creditExpireDays: [1, 3650],
  loginTokenTtlMs: [1000, 86_400_000],
  notifyTimeoutMs: [1000, 60_000],
})

function isSafeInteger(field, value) {
  const range = SAFE_INTEGER_RANGES[field]
  const number = Number(value)
  return Boolean(range)
    && Number.isSafeInteger(number)
    && number >= range[0]
    && number <= range[1]
}

function validateEnabledHalfFlowTrafficConfig(config = {}, options = {}) {
  if (!config.enabled) return { valid: true, missing: [], invalid: [] }

  const missing = []
  const invalid = []
  const textFields = [
    'routePrefix',
    'channelCode',
    'registerChannelCode',
    'registerChannelName',
    'aesKey',
    'creditNotifyUrl',
    'customerServicePhone',
    'loanUrlTemplate',
  ]
  const numberFields = [
    'defaultAmount',
    'defaultUserQuota',
    'creditExpireDays',
    'loginTokenTtlMs',
    'notifyTimeoutMs',
  ]

  for (const field of textFields) {
    if (!readTrim(config[field])) missing.push(field)
  }
  for (const field of numberFields) {
    if (config[field] == null || config[field] === '') missing.push(field)
    else if (!isSafeInteger(field, config[field])) invalid.push(field)
  }
  if (readTrim(config.routePrefix) && !readTrim(config.routePrefix).startsWith('/')) invalid.push('routePrefix')
  if (readTrim(config.registerChannelCode) && !/^[a-zA-Z0-9_-]{2,40}$/.test(readTrim(config.registerChannelCode))) {
    invalid.push('registerChannelCode')
  }
  if (readTrim(config.aesKey) && !hasValidAesKey(config.aesKey)) invalid.push('aesKey')
  if (readTrim(config.creditNotifyUrl) && !isHttpUrl(config.creditNotifyUrl)) invalid.push('creditNotifyUrl')
  if (readTrim(config.loanUrlTemplate)) {
    const placeholders = ['{orderId}', '{channel}', '{token}', '{consumePath}', '{domainUrl}']
    if (!isHttpUrl(config.loanUrlTemplate) || placeholders.some(item => !config.loanUrlTemplate.includes(item))) {
      invalid.push('loanUrlTemplate')
    }
  }
  if (readTrim(options.nodeEnv || process.env.NODE_ENV).toLowerCase() === 'production') {
    if (readTrim(config.creditNotifyUrl) && !isHttpsUrl(config.creditNotifyUrl)) invalid.push('creditNotifyUrl')
    if (readTrim(config.loanUrlTemplate) && !isHttpsUrl(config.loanUrlTemplate)) invalid.push('loanUrlTemplate')
  }

  return {
    valid: missing.length === 0 && invalid.length === 0,
    missing: [...new Set(missing)],
    invalid: [...new Set(invalid)],
  }
}

module.exports = {
  halfFlowTrafficConfigFromEnv,
  readTrim,
  resolveHalfFlowTrafficConfig,
  validateEnabledHalfFlowTrafficConfig,
}
