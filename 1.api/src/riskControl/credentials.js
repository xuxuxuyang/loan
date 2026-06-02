/**
 * 风控开放接口 appid / appkey（与其它业务接口凭证分离）。
 * 支持：
 * - RISK_CONTROL_APP_ID + RISK_CONTROL_APP_KEY：单应用
 * - RISK_CONTROL_CREDENTIALS_JSON：多应用，形如 [{"appid":"x","appkey":"y"},...]
 */

function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase()
    if (lower === 'true' || lower === '1') return true
    if (lower === 'false' || lower === '0') return false
  }
  return fallback
}

function parseCredentialsJson(raw) {
  const s = String(raw || '').trim()
  if (!s) return []
  try {
    const parsed = JSON.parse(s)
    return Array.isArray(parsed) ? parsed : []
  }
  catch {
    return []
  }
}

function buildCredentialMap() {
  const map = new Map()
  const singleId = String(process.env.RISK_CONTROL_APP_ID || '').trim()
  const singleKey = String(process.env.RISK_CONTROL_APP_KEY || '').trim()
  if (singleId && singleKey) {
    map.set(singleId, singleKey)
  }
  for (const row of parseCredentialsJson(process.env.RISK_CONTROL_CREDENTIALS_JSON)) {
    const appid = row && String(row.appid || '').trim()
    const appkey = row && String(row.appkey || '').trim()
    if (appid && appkey) {
      map.set(appid, appkey)
    }
  }
  return map
}

let cachedMap = null

function getCredentialMap() {
  if (!cachedMap) {
    cachedMap = buildCredentialMap()
  }
  return cachedMap
}

/** 开发态热更新（可选）；默认仅在进程启动时读取环境变量 */
function reloadCredentialMap() {
  cachedMap = buildCredentialMap()
  return cachedMap
}

function getAppKey(appid) {
  const id = String(appid || '').trim()
  if (!id) return ''
  return getCredentialMap().get(id) || ''
}

function hasAnyCredential() {
  return getCredentialMap().size > 0
}

const REQUIRE_CONFIGURED =
  normalizeBoolean(process.env.RISK_CONTROL_REQUIRE_CREDENTIALS, true)

module.exports = {
  getAppKey,
  hasAnyCredential,
  reloadCredentialMap,
  REQUIRE_CONFIGURED,
}
