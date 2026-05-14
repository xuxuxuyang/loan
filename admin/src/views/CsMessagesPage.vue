<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref } from 'vue'
import { ChatDotRound } from '@element-plus/icons-vue'
import { withAdminAuthHeaders } from '../composables/useAdminApi'

const MALL_API_BASE = `${(import.meta.env.VITE_MALL_API_BASE || 'http://localhost:3110/api').replace(/\/$/, '')}`

interface SessionRow {
  id: string
  userName: string
  lastMessage: string
  lastAt: string
  online: boolean
  unread: number
}

interface ChatMessage {
  id: string
  role: 'user' | 'agent'
  text: string
  createdAt: string
  agentName?: string
  type?: 'text' | 'image'
  imageUrl?: string
}

const CsSessionListPanel = defineAsyncComponent(() => import('../components/cs/CsSessionListPanel.vue'))
const CsChatPanel = defineAsyncComponent(() => import('../components/cs/CsChatPanel.vue'))

const sessions = ref<SessionRow[]>([])
const activeId = ref('')
const draft = ref('')
const detailMessages = ref<ChatMessage[]>([])
const detailTitle = ref('')
const detailOnline = ref(false)
const loadingList = ref(false)
const loadingDetail = ref(false)
const sending = ref(false)
let pollTimer: ReturnType<typeof setInterval> | null = null

const activeSession = computed(() => sessions.value.find(s => s.id === activeId.value))

let messageModulePromise: Promise<typeof import('element-plus/es/components/message/index')> | null = null

function loadEpMessage() {
  if (!messageModulePromise) {
    messageModulePromise = import('element-plus/es/components/message/index')
  }
  return messageModulePromise
}

function notifyError(message: string) {
  void loadEpMessage().then(({ ElMessage }) => {
    ElMessage.error(message)
  })
}

function formatListTime(iso: string) {
  if (!iso) {
    return ''
  }
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) {
    return iso
  }
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) {
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  const yest = new Date(now)
  yest.setDate(yest.getDate() - 1)
  if (d.toDateString() === yest.toDateString()) {
    return '昨天'
  }
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function formatMsgTime(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) {
    return ''
  }
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

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

function mallApiBaseAbsoluteForImages(): string | null {
  let base = MALL_API_BASE.trim().replace(/\/$/, '')
  if (!base) {
    return null
  }
  if (base.startsWith('//')) {
    base = typeof window !== 'undefined' && window.location?.protocol
      ? `${window.location.protocol}${base}`
      : `https:${base}`
  }
  if (!base.startsWith('http')) {
    try {
      base = new URL(base, window.location.origin).href
    }
    catch {
      return null
    }
  }
  return base
}

function resolveCsImageUrl(pathOrUrl: string): string {
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
  const absBase = mallApiBaseAbsoluteForImages()
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

function isCsImageMessage(m: ChatMessage): boolean {
  return m.type === 'image' || Boolean(String(m.imageUrl || '').trim())
}

function csChatImageSrc(m: ChatMessage): string {
  if (!isCsImageMessage(m)) {
    return ''
  }
  return resolveCsImageUrl(m.imageUrl || '')
}

async function onAgentImageSelected(ev: Event) {
  const el = ev.target as HTMLInputElement
  const file = el.files?.[0]
  el.value = ''
  if (!file || !activeId.value || sending.value) {
    return
  }
  sending.value = true
  try {
    const fd = new FormData()
    fd.append('image', file)
    const response = await fetch(
      `${MALL_API_BASE}/admin/cs/sessions/${encodeURIComponent(activeId.value)}/messages/image`,
      { method: 'POST', headers: withAdminAuthHeaders(), body: fd },
    )
    const payload = await response.json() as {
      success?: boolean
      msg?: string
      data?: { messages?: ChatMessage[] }
    }
    if (!response.ok || payload.success === false) {
      throw new Error(payload.msg || '发送失败')
    }
    if (payload.data?.messages) {
      detailMessages.value = payload.data.messages
    }
    await fetchSessions()
  }
  catch (e) {
    notifyError(e instanceof Error ? e.message : '图片发送失败')
  }
  finally {
    sending.value = false
  }
}

async function fetchSessions() {
  loadingList.value = true
  try {
    const response = await fetch(`${MALL_API_BASE}/admin/cs/sessions`, {
      method: 'GET',
      headers: withAdminAuthHeaders(),
    })
    const payload = await response.json() as {
      success?: boolean
      msg?: string
      data?: SessionRow[]
    }
    if (!response.ok || payload.success === false) {
      throw new Error(payload.msg || `加载失败 (${response.status})`)
    }
    const list = Array.isArray(payload.data) ? payload.data : []
    sessions.value = list.map(s => ({
      ...s,
      lastAt: formatListTime(s.lastAt),
    }))
    if (!activeId.value && list.length) {
      activeId.value = list[0].id
    }
    else if (activeId.value && !list.some(s => s.id === activeId.value)) {
      activeId.value = list[0]?.id ?? ''
    }
  }
  catch (e) {
    console.error(e)
  }
  finally {
    loadingList.value = false
  }
}

async function fetchDetail(id: string) {
  if (!id) {
    detailMessages.value = []
    return
  }
  loadingDetail.value = true
  try {
    const response = await fetch(
      `${MALL_API_BASE}/admin/cs/sessions/${encodeURIComponent(id)}?read=1`,
      { method: 'GET', headers: withAdminAuthHeaders() },
    )
    const payload = await response.json() as {
      success?: boolean
      msg?: string
      data?: { displayName?: string, online?: boolean, messages?: ChatMessage[] }
    }
    if (!response.ok || payload.success === false) {
      throw new Error(payload.msg || `加载会话失败 (${response.status})`)
    }
    const d = payload.data
    detailTitle.value = String(d?.displayName || '')
    detailOnline.value = Boolean(d?.online)
    detailMessages.value = Array.isArray(d?.messages) ? d.messages : []
  }
  catch (e) {
    console.error(e)
    notifyError(e instanceof Error ? e.message : '加载会话失败')
  }
  finally {
    loadingDetail.value = false
  }
}

function selectSession(id: string) {
  activeId.value = id
  const s = sessions.value.find(x => x.id === id)
  if (s && s.unread > 0) {
    s.unread = 0
  }
  void fetchDetail(id).then(() => fetchSessions())
}

async function sendReply() {
  const t = draft.value.trim()
  if (!t || !activeId.value || sending.value) {
    return
  }
  sending.value = true
  try {
    const response = await fetch(
      `${MALL_API_BASE}/admin/cs/sessions/${encodeURIComponent(activeId.value)}/messages`,
      {
        method: 'POST',
        headers: withAdminAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ text: t }),
      },
    )
    const payload = await response.json() as {
      success?: boolean
      msg?: string
      data?: { messages?: ChatMessage[] }
    }
    if (!response.ok || payload.success === false) {
      throw new Error(payload.msg || '发送失败')
    }
    draft.value = ''
    if (payload.data?.messages) {
      detailMessages.value = payload.data.messages
    }
    await fetchSessions()
  }
  catch (e) {
    notifyError(e instanceof Error ? e.message : '发送失败')
  }
  finally {
    sending.value = false
  }
}

function startPolling() {
  stopPolling()
  pollTimer = setInterval(() => {
    void fetchSessions()
    if (activeId.value) {
      void fetchDetail(activeId.value)
    }
  }, 2500)
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

onMounted(async () => {
  await fetchSessions()
  if (activeId.value) {
    await fetchDetail(activeId.value)
  }
  startPolling()
})

onUnmounted(() => {
  stopPolling()
})
</script>

<template>
  <div class="cs-page">
    <div class="cs-banner">
      <el-icon class="cs-banner-icon">
        <ChatDotRound />
      </el-icon>
      <div>
        <h2 class="cs-banner-title">
          客服消息
        </h2>
      </div>
    </div>

    <div class="cs-shell">
      <Suspense>
        <CsSessionListPanel
          :sessions="sessions"
          :active-id="activeId"
          :loading-list="loadingList"
          @select="selectSession"
        />
      </Suspense>

      <Suspense>
        <CsChatPanel
          :active-id="activeId"
          :active-session-user-name="activeSession?.userName"
          :active-session-id="activeSession?.id"
          :detail-title="detailTitle"
          :detail-online="detailOnline"
          :detail-messages="detailMessages"
          :loading-detail="loadingDetail"
          :sending="sending"
          :draft="draft"
          :is-cs-image-message="isCsImageMessage"
          :cs-chat-image-src="csChatImageSrc"
          :format-msg-time="formatMsgTime"
          @draft-change="(val) => draft = val"
          @send-reply="sendReply"
          @image-change="onAgentImageSelected"
        />
      </Suspense>
    </div>
  </div>
</template>

<style scoped>
.cs-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.cs-banner {
  display: flex;
  gap: 14px;
  align-items: flex-start;
  padding: 16px 18px;
  border-radius: 12px;
  background: linear-gradient(120deg, #eff6ff 0%, #f8fafc 100%);
  border: 1px solid #e2e8f0;
}

.cs-banner-icon {
  font-size: 28px;
  color: #2563eb;
  margin-top: 2px;
}

.cs-banner-title {
  margin: 0 0 6px;
  font-size: 18px;
  font-weight: 700;
  color: #0f172a;
}

.cs-banner-desc {
  margin: 0;
  font-size: 13px;
  color: #64748b;
  line-height: 1.5;
}

.cs-shell {
  display: grid;
  grid-template-columns: 280px 1fr;
  min-height: 520px;
  border-radius: 12px;
  border: 1px solid #e5e7eb;
  background: #fff;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
}

</style>
