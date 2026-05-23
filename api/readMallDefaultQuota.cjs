/**
 * 默认授信额度：仅维护本目录 .env.development / .env.production 的 MALL_DEFAULT_CREDIT_QUOTA。
 * shop/admin 的 vite.config 构建时读取并注入 VITE_MALL_DEFAULT_CREDIT_QUOTA。
 */
const fs = require('node:fs')
const path = require('node:path')

const FALLBACK_QUOTA = 2750
const ENV_KEY = 'MALL_DEFAULT_CREDIT_QUOTA'
const VITE_ENV_KEY = 'VITE_MALL_DEFAULT_CREDIT_QUOTA'

function normalizeApiEnvMode(mode) {
  const m = String(mode || 'development').trim().toLowerCase()
  return m === 'production' ? 'production' : 'development'
}

function getApiEnvPath(apiRoot, mode) {
  const normalized = normalizeApiEnvMode(mode)
  return path.join(apiRoot, `.env.${normalized}`)
}

function parseSimpleEnv(content) {
  const out = {}
  for (const line of String(content || '').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }
    const eq = trimmed.indexOf('=')
    if (eq <= 0) {
      continue
    }
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith('\'') && val.endsWith('\''))) {
      val = val.slice(1, -1)
    }
    out[key] = val
  }
  return out
}

function parseQuotaValue(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return null
  }
  const n = Number(String(raw).trim())
  if (!Number.isFinite(n) || n < 0) {
    return null
  }
  return Math.round(n)
}

function readMallDefaultQuotaFromFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return null
  }
  const parsed = parseSimpleEnv(fs.readFileSync(filePath, 'utf8'))
  return parseQuotaValue(parsed[ENV_KEY])
}

function readMallDefaultQuotaFromApiEnv(apiRoot, mode) {
  return readMallDefaultQuotaFromFile(getApiEnvPath(apiRoot, mode))
}

/** Vite：包内 VITE_* 可覆盖；否则读 api/.env.[mode]；再否则 2750 */
function resolveViteMallDefaultCreditQuota(apiRoot, mode) {
  const fromVite = parseQuotaValue(process.env[VITE_ENV_KEY])
  if (fromVite !== null) {
    return fromVite
  }
  const fromApi = readMallDefaultQuotaFromApiEnv(apiRoot, mode)
  if (fromApi !== null) {
    return fromApi
  }
  return FALLBACK_QUOTA
}

function viteDefineForMallDefaultQuota(apiRoot, mode) {
  const q = resolveViteMallDefaultCreditQuota(apiRoot, mode)
  return {
    'import.meta.env.VITE_MALL_DEFAULT_CREDIT_QUOTA': JSON.stringify(String(q)),
  }
}

module.exports = {
  FALLBACK_QUOTA,
  ENV_KEY,
  VITE_ENV_KEY,
  normalizeApiEnvMode,
  getApiEnvPath,
  readMallDefaultQuotaFromApiEnv,
  resolveViteMallDefaultCreditQuota,
  viteDefineForMallDefaultQuota,
}
