const { readTrim } = require('./crypto')

function boolFromEnv(value) {
  return ['1', 'true', 'yes', 'on'].includes(readTrim(value).toLowerCase())
}

function normalizeRoutePrefix(value) {
  const raw = readTrim(value).replace(/\/+$/, '')
  return raw && raw.startsWith('/') ? raw : ''
}

function parseNumber(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function parsePeriods(value) {
  if (Array.isArray(value)) return value.map(Number).filter(Number.isFinite)
  const raw = readTrim(value)
  if (!raw) return [3, 6, 9, 12]
  return raw.split(',').map(item => Number(readTrim(item))).filter(Number.isFinite)
}

function parseContracts(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value
  const raw = readTrim(value)
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
    if (Array.isArray(parsed)) return { default: parsed, '1': parsed, credit: parsed }
  }
  catch {
    return {}
  }
  return {}
}

function zheyinTrafficConfigFromEnv(env = process.env) {
  return {
    enabled: boolFromEnv(env.ZHEYIN_TRAFFIC_ENABLED),
    routePrefix: normalizeRoutePrefix(env.ZHEYIN_TRAFFIC_ROUTE_PREFIX),
    channel: readTrim(env.ZHEYIN_TRAFFIC_CHANNEL),
    aesKey: readTrim(env.ZHEYIN_TRAFFIC_AES_KEY),
    aesIv: readTrim(env.ZHEYIN_TRAFFIC_AES_IV),
    orderIdPrefix: readTrim(env.ZHEYIN_TRAFFIC_ORDER_ID_PREFIX) || 'ZY',
    creditNotifyUrl: readTrim(env.ZHEYIN_TRAFFIC_CREDIT_NOTIFY_URL),
    loanUrlTemplate: readTrim(env.ZHEYIN_TRAFFIC_LOAN_URL_TEMPLATE),
    defaultAmount: parseNumber(env.ZHEYIN_TRAFFIC_DEFAULT_AMOUNT, 50000),
    periods: parsePeriods(env.ZHEYIN_TRAFFIC_PERIODS),
    yearRate: readTrim(env.ZHEYIN_TRAFFIC_YEAR_RATE) || '12%',
    creditType: parseNumber(env.ZHEYIN_TRAFFIC_CREDIT_TYPE, 1),
    creditExpireDays: parseNumber(env.ZHEYIN_TRAFFIC_CREDIT_EXPIRE_DAYS, 365),
    contractsByScene: parseContracts(env.ZHEYIN_TRAFFIC_CONTRACTS_BY_SCENE || env.ZHEYIN_TRAFFIC_CONTRACTS_CREDIT),
  }
}

function resolveZheyinTrafficConfig(config = {}) {
  const env = zheyinTrafficConfigFromEnv()
  const merged = { ...env, ...config }
  merged.enabled = Boolean(merged.enabled)
  merged.routePrefix = normalizeRoutePrefix(merged.routePrefix)
  merged.channel = readTrim(merged.channel)
  merged.aesKey = readTrim(merged.aesKey)
  merged.aesIv = readTrim(merged.aesIv)
  merged.orderIdPrefix = readTrim(merged.orderIdPrefix) || 'ZY'
  merged.creditNotifyUrl = readTrim(merged.creditNotifyUrl)
  merged.loanUrlTemplate = readTrim(merged.loanUrlTemplate)
  merged.defaultAmount = parseNumber(merged.defaultAmount, 50000)
  merged.periods = parsePeriods(merged.periods)
  merged.yearRate = readTrim(merged.yearRate) || '12%'
  merged.creditType = parseNumber(merged.creditType, 1)
  merged.creditExpireDays = parseNumber(merged.creditExpireDays, 365)
  merged.contractsByScene = parseContracts(merged.contractsByScene)
  return merged
}

function requireZheyinTrafficConfig(config, fields) {
  const missing = fields.filter(field => !readTrim(config[field]))
  if (missing.length) {
    throw new Error(`Zheyin traffic config missing: ${missing.join(', ')}`)
  }
}

module.exports = {
  zheyinTrafficConfigFromEnv,
  resolveZheyinTrafficConfig,
  requireZheyinTrafficConfig,
}
