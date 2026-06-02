import { onUnmounted, ref } from 'vue'
import { useRuntimeConfig } from '@/spa-shim'
import { useMallAuth } from '~/composables/useMallAuth'

const LS_VISITOR = 'mall_cs_visitor_key'
const LS_SESSION = 'mall_cs_session_id'
const LS_SECRET = 'mall_cs_secret'

/** 商城在线客服 API（useMallCsChat） */

function mallApiBase() {
  const c = useRuntimeConfig()
  return (c.public.mallApiBase || '/api').replace(/\/$/, '')
}

export interface CsChatMessage {
  id: string
  role: 'user' | 'agent'
  text: string
  createdAt: string
  agentName?: string
  /** 新建消息必有；历史数据缺省时按纯文本处理 */
  type?: 'text' | 'image'
  imageUrl?: string
}

/** 仅客服上传图：历史为 /static/uploads/cs/；线上网关常只反代 /api，须走 /api/static/... */
function normalizeCsChatImagePath(relativePath: string): string {
  const p = relativePath.startsWith('/') ? relativePath : `/${relativePath}`
  if (p.startsWith('/api/static/uploads/cs/')) {
    return p
  }
  if (p.startsWith('/static/uploads/cs/')) {
    return `/api${p}`
  }
  return p
}

function mallApiBaseAbsoluteForResolve(): string | null {
  let base = mallApiBase().trim().replace(/\/$/, '')
  if (!base) {
    return null
  }
  if (base.startsWith('//')) {
    if (typeof window !== 'undefined' && window.location?.protocol) {
      base = `${window.location.protocol}${base}`
    }
    else {
      base = `https:${base}`
    }
  }
  if (!base.startsWith('http')) {
    if (typeof window === 'undefined') {
      return null
    }
    try {
      base = new URL(base, window.location.origin).href
    }
    catch {
      return null
    }
  }
  return base
}

/** 将服务端返回的图片路径或绝对 URL 转为浏览器可加载地址 */
export function resolveCsImageDisplayUrl(pathOrUrl: string): string {
  let s = String(pathOrUrl || '').trim()
  if (!s) {
    return ''
  }
  if (s.startsWith('//')) {
    return typeof window !== 'undefined' && window.location?.protocol
      ? `${window.location.protocol}${s}`
      : `https:${s}`
  }
  if (/^https?:\/\//i.test(s)) {
    return s
  }
  s = normalizeCsChatImagePath(s)
  const absBase = mallApiBaseAbsoluteForResolve()
  if (absBase) {
    try {
      return `${new URL(absBase).origin}${s}`
    }
    catch {
      return s
    }
  }
  return s
}

export interface CsOpenPayload {
  sessionId: string
  visitorKey: string
  displayName: string
  messages: CsChatMessage[]
  auth: 'mall_token' | 'visitor_headers'
  secret?: string
}

function readLs(key: string) {
  if (typeof localStorage === 'undefined')
    return ''
  try {
    return String(localStorage.getItem(key) || '').trim()
  }
  catch {
    return ''
  }
}

function writeLs(key: string, val: string) {
  if (typeof localStorage === 'undefined')
    return
  try {
    if (!val)
      localStorage.removeItem(key)
    else
      localStorage.setItem(key, val)
  }
  catch {
    /* ignore */
  }
}

/** 轮询合并：避免服务端快照短暂滞后时本地消息被旧数据覆盖 */
function mergeCsMessages(existing: CsChatMessage[], incoming: CsChatMessage[]): CsChatMessage[] {
  const map = new Map<string, CsChatMessage>()
  for (const m of existing) {
    if (m?.id) {
      map.set(m.id, m)
    }
  }
  for (const m of incoming) {
    if (m?.id) {
      map.set(m.id, m)
    }
  }
  if (!map.size) {
    return incoming.length ? incoming : existing
  }
  return [...map.values()].sort((a, b) =>
    String(a.createdAt || '').localeCompare(String(b.createdAt || '')),
  )
}

export function useMallCsChat() {
  const { loginPhone } = useMallAuth()

  const sessionId = ref('')
  const visitorKey = ref('')
  const secret = ref('')
  const displayName = ref('')
  const messages = ref<CsChatMessage[]>([])
  const authMode = ref<'mall_token' | 'visitor_headers' | ''>('')
  const loading = ref(false)
  const sending = ref(false)
  const errorText = ref('')
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let visHandler: (() => void) | null = null
  let pullInFlight = false
  /** 递增后使进行中的 pullMessages 结果失效，避免轮询慢响应覆盖刚发送的消息 */
  let pullGen = 0

  const POLL_MS = 5000

  function clearVisitorStorage() {
    writeLs(LS_VISITOR, '')
    writeLs(LS_SESSION, '')
    writeLs(LS_SECRET, '')
  }

  function buildAuthHeaders(): Record<string, string> {
    const h: Record<string, string> = {}
    const phone = loginPhone.value?.trim()
    if (authMode.value === 'mall_token' && phone) {
      h.Authorization = `Bearer mock-token-${phone}`
    }
    else if (authMode.value === 'visitor_headers' && sessionId.value && secret.value) {
      h['x-cs-session-id'] = sessionId.value
      h['x-cs-secret'] = secret.value
    }
    return h
  }

  async function openSession() {
    loading.value = true
    errorText.value = ''
    try {
      const vkStored = readLs(LS_VISITOR)
      const body: { visitorKey?: string } = {}
      if (!loginPhone.value?.trim() && vkStored) {
        body.visitorKey = vkStored
      }
      const res = await $fetch<{ success: boolean, msg?: string, data: CsOpenPayload }>(
        `${mallApiBase()}/mall/cs/session/open`,
        {
          method: 'POST',
          body,
          headers: loginPhone.value?.trim()
            ? { Authorization: `Bearer mock-token-${loginPhone.value.trim()}` }
            : {},
        },
      )
      if (!res?.success || !res.data) {
        throw new Error(res?.msg || '开启会话失败')
      }
      const d = res.data
      pullGen += 1
      sessionId.value = d.sessionId
      displayName.value = d.displayName
      messages.value = Array.isArray(d.messages) ? d.messages : []
      authMode.value = d.auth

      if (d.auth === 'visitor_headers') {
        visitorKey.value = d.visitorKey || ''
        if (d.visitorKey) {
          writeLs(LS_VISITOR, d.visitorKey)
        }
        if (d.secret) {
          secret.value = d.secret
          writeLs(LS_SESSION, d.sessionId)
          writeLs(LS_SECRET, d.secret)
        }
        else {
          const sid = readLs(LS_SESSION)
          const sec = readLs(LS_SECRET)
          if (sid === d.sessionId && sec) {
            secret.value = sec
          }
          else {
            throw new Error('本地会话凭证缺失，请清除缓存后重试')
          }
        }
      }
      else {
        visitorKey.value = ''
        secret.value = ''
        clearVisitorStorage()
      }
    }
    catch (e) {
      errorText.value = e instanceof Error ? e.message : '开启会话失败'
      throw e
    }
    finally {
      loading.value = false
    }
  }

  async function pullMessages() {
    if (!sessionId.value || !authMode.value) {
      return
    }
    if (authMode.value === 'visitor_headers' && (!secret.value)) {
      return
    }
    if (pullInFlight) {
      return
    }
    pullInFlight = true
    const gen = ++pullGen
    const sid = sessionId.value
    try {
      const res = await $fetch<{ success: boolean, data?: { messages: CsChatMessage[] } }>(
        `${mallApiBase()}/mall/cs/session`,
        {
          method: 'GET',
          headers: buildAuthHeaders(),
        },
      )
      if (gen !== pullGen || sessionId.value !== sid) {
        return
      }
      if (res?.success && res.data && Array.isArray(res.data.messages)) {
        messages.value = messages.value.length
          ? mergeCsMessages(messages.value, res.data.messages)
          : res.data.messages
      }
    }
    catch {
      /* 轮询失败静默 */
    }
    finally {
      pullInFlight = false
    }
  }

  async function sendUserMessage(text: string) {
    const t = text.trim()
    if (!t) {
      return
    }
    sending.value = true
    errorText.value = ''
    try {
      const res = await $fetch<{ success: boolean, msg?: string, data?: { messages: CsChatMessage[] } }>(
        `${mallApiBase()}/mall/cs/messages`,
        {
          method: 'POST',
          body: { text: t },
          headers: {
            'Content-Type': 'application/json',
            ...buildAuthHeaders(),
          },
        },
      )
      if (!res?.success) {
        throw new Error(res?.msg || '发送失败')
      }
      if (res.data?.messages) {
        pullGen += 1
        messages.value = res.data.messages
      }
    }
    catch (e) {
      errorText.value = e instanceof Error ? e.message : '发送失败'
    }
    finally {
      sending.value = false
    }
  }

  async function sendUserImage(file: File) {
    if (!sessionId.value || !authMode.value || sending.value) {
      return
    }
    if (authMode.value === 'visitor_headers' && !secret.value) {
      return
    }
    sending.value = true
    errorText.value = ''
    try {
      const fd = new FormData()
      fd.append('image', file)
      const res = await $fetch<{ success: boolean, msg?: string, data?: { messages: CsChatMessage[] } }>(
        `${mallApiBase()}/mall/cs/messages/image`,
        {
          method: 'POST',
          body: fd,
          headers: buildAuthHeaders(),
        },
      )
      if (!res?.success) {
        throw new Error(res?.msg || '发送失败')
      }
      if (res.data?.messages) {
        pullGen += 1
        messages.value = res.data.messages
      }
    }
    catch (e) {
      errorText.value = e instanceof Error ? e.message : '图片发送失败'
    }
    finally {
      sending.value = false
    }
  }

  function startPolling() {
    stopPolling()
    const tick = () => {
      void pullMessages()
    }
    const armTimer = () => {
      if (pollTimer) {
        return
      }
      pollTimer = setInterval(tick, POLL_MS)
    }
    if (typeof document !== 'undefined') {
      visHandler = () => {
        if (document.visibilityState === 'hidden') {
          if (pollTimer) {
            clearInterval(pollTimer)
            pollTimer = null
          }
          return
        }
        tick()
        armTimer()
      }
      document.addEventListener('visibilitychange', visHandler)
      if (document.visibilityState === 'hidden') {
        return
      }
    }
    tick()
    armTimer()
  }

  function stopPolling() {
    if (visHandler && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', visHandler)
    }
    visHandler = null
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  onUnmounted(() => {
    stopPolling()
  })

  return {
    sessionId,
    displayName,
    messages,
    authMode,
    loading,
    sending,
    errorText,
    openSession,
    pullMessages,
    sendUserMessage,
    sendUserImage,
    startPolling,
    stopPolling,
    clearVisitorStorage,
  }
}
