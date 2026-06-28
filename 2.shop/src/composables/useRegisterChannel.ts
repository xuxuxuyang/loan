/**
 * 注册渠道：仅从 URL `?channel=` 读取，持久化到本地缓存，仅在注册成功提交后清除。
 * 采用「首次有效参数为准」，避免后续跳转覆盖归因。
 */
const STORAGE_KEY = 'mall_pending_register_channel'
const PENDING_REGISTER_CHANNEL_TTL_MS = 30 * 24 * 60 * 60 * 1000

function safeTrimChannel(raw: unknown): string {
  if (typeof raw !== 'string') {
    return ''
  }
  const s = raw.trim()
  if (!s || s.length > 40) {
    return ''
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(s)) {
    return ''
  }
  return s
}

function readStoredChannelValue(raw: string | null): string {
  const text = String(raw || '').trim()
  if (!text) {
    return ''
  }
  if (!text.startsWith('{')) {
    return safeTrimChannel(text)
  }
  try {
    const parsed = JSON.parse(text) as { code?: unknown, expiresAt?: unknown }
    const expiresAt = Number(parsed.expiresAt || 0)
    if (expiresAt > 0 && expiresAt < Date.now()) {
      return ''
    }
    return safeTrimChannel(parsed.code)
  }
  catch {
    return ''
  }
}

function removeStoredChannel() {
  try {
    localStorage?.removeItem(STORAGE_KEY)
  }
  catch {
    /* ignore */
  }
  try {
    sessionStorage?.removeItem(STORAGE_KEY)
  }
  catch {
    /* ignore */
  }
}

function readStoredChannel(): string {
  try {
    const fromLocal = readStoredChannelValue(localStorage?.getItem(STORAGE_KEY) || null)
    if (fromLocal) {
      return fromLocal
    }
    if (localStorage?.getItem(STORAGE_KEY)) {
      localStorage.removeItem(STORAGE_KEY)
    }
  }
  catch {
    /* ignore */
  }
  try {
    return readStoredChannelValue(sessionStorage?.getItem(STORAGE_KEY) || null)
  }
  catch {
    return ''
  }
}

function writeStoredChannel(code: string) {
  const payload = JSON.stringify({
    code,
    expiresAt: Date.now() + PENDING_REGISTER_CHANNEL_TTL_MS,
  })
  try {
    localStorage?.setItem(STORAGE_KEY, payload)
    return
  }
  catch {
    /* fall back to sessionStorage below */
  }
  try {
    sessionStorage?.setItem(STORAGE_KEY, code)
  }
  catch {
    /* ignore quota / private mode */
  }
}

/** 单次解析 URL query（支持 string | string[]），用于注册提交时兜底 */
export function resolveChannelFromRouteQuery(query: Record<string, unknown>): string {
  const raw = query.channel
  const first = Array.isArray(raw) ? raw[0] : raw
  return safeTrimChannel(first as unknown)
}

const CLICK_SENT_KEY = 'mall_channel_click_sent'

function mallApiBase() {
  const raw = import.meta.env.VITE_MALL_API_BASE || '/api'
  return `${String(raw).replace(/\/$/, '')}`
}

/** 上报渠道点击（用于流量商后台「点击数」）；同一会话同一渠道只上报一次 */
function reportChannelClickOnce(code: string) {
  if (import.meta.env.SSR || typeof sessionStorage === 'undefined') {
    return
  }
  const flagKey = `${CLICK_SENT_KEY}:${code}`
  try {
    if (sessionStorage.getItem(flagKey)) {
      return
    }
    sessionStorage.setItem(flagKey, '1')
  }
  catch {
    return
  }
  void fetch(`${mallApiBase()}/traffic/channel-click`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel: code }),
  }).catch(() => {
    try {
      sessionStorage.removeItem(flagKey)
    }
    catch {
      /* ignore */
    }
  })
}

/** 路由进入时调用：若 URL 含合法 channel 且尚未锁定，则写入本地缓存 */
export function captureRegisterChannelFromRoute(query: Record<string, unknown>) {
  if (import.meta.env.SSR) {
    return
  }
  const code = resolveChannelFromRouteQuery(query)
  if (!code) {
    return
  }
  reportChannelClickOnce(code)
  if (!getPendingRegisterChannel()) {
    writeStoredChannel(code)
  }
}

export function getPendingRegisterChannel(): string {
  if (import.meta.env.SSR) {
    return ''
  }
  return readStoredChannel()
}

export function clearPendingRegisterChannel() {
  if (typeof window === 'undefined') {
    return
  }
  removeStoredChannel()
}
