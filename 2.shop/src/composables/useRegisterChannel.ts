/**
 * 注册渠道：仅从 URL `?channel=` 读取，写入 sessionStorage，仅在注册成功提交后清除。
 * 采用「首次有效参数为准」，避免后续跳转覆盖归因。
 */
const STORAGE_KEY = 'mall_pending_register_channel'

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

/** 路由进入时调用：若 URL 含合法 channel 且尚未锁定，则写入 sessionStorage */
export function captureRegisterChannelFromRoute(query: Record<string, unknown>) {
  if (import.meta.env.SSR || typeof sessionStorage === 'undefined') {
    return
  }
  const code = resolveChannelFromRouteQuery(query)
  if (!code) {
    return
  }
  reportChannelClickOnce(code)
  try {
    if (!sessionStorage.getItem(STORAGE_KEY)) {
      sessionStorage.setItem(STORAGE_KEY, code)
    }
  }
  catch {
    /* ignore quota / private mode */
  }
}

export function getPendingRegisterChannel(): string {
  if (import.meta.env.SSR || typeof sessionStorage === 'undefined') {
    return ''
  }
  try {
    return safeTrimChannel(sessionStorage.getItem(STORAGE_KEY))
  }
  catch {
    return ''
  }
}

export function clearPendingRegisterChannel() {
  if (typeof sessionStorage === 'undefined') {
    return
  }
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  }
  catch {
    /* ignore */
  }
}
