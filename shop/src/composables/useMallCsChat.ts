import { onUnmounted, ref } from 'vue'
import { useRuntimeConfig } from '@/spa-shim'
import { useMallAuth } from '~/composables/useMallAuth'

const LS_VISITOR = 'mall_cs_visitor_key'
const LS_SESSION = 'mall_cs_session_id'
const LS_SECRET = 'mall_cs_secret'

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

/** 将服务端返回的 `/static/...` 或绝对 URL 转为浏览器可加载地址 */
export function resolveCsImageDisplayUrl(pathOrUrl: string): string {
  const s = String(pathOrUrl || '').trim()
  if (!s) {
    return ''
  }
  if (/^https?:\/\//i.test(s)) {
    return s
  }
  const base = mallApiBase()
  if (base.startsWith('http')) {
    try {
      const origin = new URL(base).origin
      return `${origin}${s.startsWith('/') ? s : `/${s}`}`
    }
    catch {
      return s
    }
  }
  return s.startsWith('/') ? s : `/${s}`
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
    try {
      const res = await $fetch<{ success: boolean, data?: { messages: CsChatMessage[] } }>(
        `${mallApiBase()}/mall/cs/session`,
        {
          method: 'GET',
          headers: buildAuthHeaders(),
        },
      )
      if (res?.success && res.data && Array.isArray(res.data.messages)) {
        messages.value = res.data.messages
      }
    }
    catch {
      /* 轮询失败静默 */
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
    pollTimer = setInterval(() => {
      void pullMessages()
    }, 2500)
  }

  function stopPolling() {
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
