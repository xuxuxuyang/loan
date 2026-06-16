const FALLBACK_TRAFFIC_LOGIN_MESSAGE = '正在为您进入商城，请稍候重试'
const DUODIANDIAN_HALF_FLOW_PREFIX = '/market/halfFlow/447285613150998528/open'

function normalizeApiBase(mallApiBase: string) {
  return String(mallApiBase || '/api').trim().replace(/\/+$/, '') || '/api'
}

function normalizeConsumePath(path: string) {
  const value = String(path || '').trim()
  if (!value || value.startsWith('//') || /^https?:\/\//i.test(value)) return ''
  if (!value.startsWith('/')) return ''
  if (!value.endsWith('/login/consume')) return ''
  return value
}

export function resolveDuodiandianLoginConsumeUrl(
  mallApiBase: string,
  channel: string,
  consumePath?: string,
) {
  const apiBase = normalizeApiBase(mallApiBase)
  const configuredPath = normalizeConsumePath(String(consumePath || ''))
  if (configuredPath) {
    return configuredPath.startsWith('/api/') ? configuredPath : `${apiBase}${configuredPath}`
  }
  if (String(channel || '').trim() === 'duodiandian') {
    return `${apiBase}${DUODIANDIAN_HALF_FLOW_PREFIX}/login/consume`
  }
  const safeChannel = String(channel || '').replace(/[^a-zA-Z0-9_-]/g, '')
  return `${apiBase}/open/partners/${safeChannel}/login/consume`
}

export function sanitizeTrafficLoginErrorMessage(message: unknown) {
  const raw = typeof message === 'string' ? message.trim() : ''
  if (!raw) return FALLBACK_TRAFFIC_LOGIN_MESSAGE
  if (/\b(POST|GET|PUT|PATCH|DELETE)\b|https?:\/\/|\/open\/partners\/|\/market\/halfFlow\/|40[45]\s+(Not\s+Found|Not\s+Allowed)/i.test(raw)) {
    return FALLBACK_TRAFFIC_LOGIN_MESSAGE
  }
  return raw
}
