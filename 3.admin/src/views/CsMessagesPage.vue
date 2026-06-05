<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref } from 'vue'
import { ChatDotRound } from '@element-plus/icons-vue'
import { csMenuHasUnread } from '../composables/useAdminCsUnreadBadge'
import { withMallTenantHeaders } from '../composables/useAdminApi'

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
let sessionsPollTimer: ReturnType<typeof setInterval> | null = null
let detailPollTimer: ReturnType<typeof setInterval> | null = null
let visHandler: (() => void) | null = null
/** 递增后使进行中的 fetchDetail 结果失效，避免轮询慢响应覆盖刚发送的消息 */
let detailFetchGen = 0
let sessionsInFlight = false
/** 轮询 tick 时若详情请求未返回则跳过，避免慢响应叠加并发 GET */
let detailInFlight = false

const DETAIL_POLL_MS = 10000
const SESSIONS_POLL_MS = 30000
const SESSION_LIST_PAGE_SIZE = 100
const DETAIL_MESSAGE_PAGE_SIZE = 100

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

/** 发送消息后立即更新侧边栏预览，避免立刻 GET 会话列表读到旧快照 */
function patchSessionSidebarPreview(sessionId: string, messages: ChatMessage[]) {
  if (!sessionId || !messages.length)
    return
  const idx = sessions.value.findIndex(s => s.id === sessionId)
  if (idx < 0)
    return
  const last = messages[messages.length - 1]
  const img = Boolean(last && (last.type === 'image' || String(last.imageUrl || '').trim()))
  const lastMessage = img
    ? '[图片]'
    : String(last?.text || '').trim() || '[消息]'
  const rawTime = typeof last?.createdAt === 'string' ? last.createdAt.trim() : ''
  sessions.value[idx] = {
    ...sessions.value[idx],
    lastMessage,
    ...(rawTime ? { lastAt: formatListTime(rawTime) } : {}),
  }
}

function formatMsgTime(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) {
    return ''
  }
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

/** 轮询合并消息：服务端快照短暂滞后时保留本地已有条目，避免回复闪没 */
function mergeCsMessages(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const map = new Map<string, ChatMessage>()
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

function applyDetailMessages(incoming: ChatMessage[], options?: { merge?: boolean }) {
  const list = Array.isArray(incoming) ? incoming : []
  if (options?.merge && detailMessages.value.length) {
    detailMessages.value = mergeCsMessages(detailMessages.value, list)
    return
  }
  detailMessages.value = list
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
      { method: 'POST', headers: withMallTenantHeaders(), body: fd },
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
      detailFetchGen += 1
      applyDetailMessages(payload.data.messages)
      patchSessionSidebarPreview(activeId.value, detailMessages.value)
    }
  }
  catch (e) {
    notifyError(e instanceof Error ? e.message : '图片发送失败')
  }
  finally {
    sending.value = false
  }
}

async function fetchSessions(options?: { silent?: boolean }) {
  if (sessionsInFlight) {
    return
  }
  sessionsInFlight = true
  const silent = Boolean(options?.silent)
  if (!silent) {
    loadingList.value = true
  }
  try {
    const qs = new URLSearchParams({
      page: '1',
      pageSize: String(SESSION_LIST_PAGE_SIZE),
    })
    const response = await fetch(`${MALL_API_BASE}/admin/cs/sessions?${qs.toString()}`, {
      method: 'GET',
      headers: withMallTenantHeaders(),
    })
    const payload = await response.json() as {
      success?: boolean
      msg?: string
      data?: SessionRow[] | { list?: SessionRow[] }
    }
    if (!response.ok || payload.success === false) {
      throw new Error(payload.msg || `加载失败 (${response.status})`)
    }
    const list = Array.isArray(payload.data)
      ? payload.data
      : (Array.isArray(payload.data?.list) ? payload.data.list : [])
    sessions.value = list.map(s => ({
      ...s,
      lastAt: formatListTime(s.lastAt),
    }))
    csMenuHasUnread.value = list.some(row => Number(row.unread || 0) > 0)
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
    if (!silent) {
      loadingList.value = false
    }
    sessionsInFlight = false
  }
}

async function fetchDetail(id: string, options?: { markRead?: boolean, silent?: boolean }) {
  if (!id) {
    detailMessages.value = []
    return
  }
  const markRead = options?.markRead ?? false
  const silent = Boolean(options?.silent)
  if (silent && detailInFlight) {
    return
  }
  detailInFlight = true
  const gen = ++detailFetchGen
  const sessionId = id
  if (!silent && !detailMessages.value.length) {
    loadingDetail.value = true
  }
  try {
    const qs = new URLSearchParams({ read: markRead ? '1' : '0' })
    const latestMessageId = detailMessages.value[detailMessages.value.length - 1]?.id
    if (silent && latestMessageId) {
      qs.set('afterMessageId', latestMessageId)
      qs.set('pageSize', String(DETAIL_MESSAGE_PAGE_SIZE))
    }
    const response = await fetch(
      `${MALL_API_BASE}/admin/cs/sessions/${encodeURIComponent(sessionId)}?${qs.toString()}`,
      { method: 'GET', headers: withMallTenantHeaders() },
    )
    const payload = await response.json() as {
      success?: boolean
      msg?: string
      data?: { displayName?: string, online?: boolean, messages?: ChatMessage[] }
    }
    if (!response.ok || payload.success === false) {
      throw new Error(payload.msg || `加载会话失败 (${response.status})`)
    }
    if (gen !== detailFetchGen || activeId.value !== sessionId) {
      return
    }
    const d = payload.data
    detailTitle.value = String(d?.displayName || '')
    detailOnline.value = Boolean(d?.online)
    applyDetailMessages(Array.isArray(d?.messages) ? d.messages : [], { merge: silent })
  }
  catch (e) {
    console.error(e)
    if (gen === detailFetchGen && activeId.value === sessionId) {
      notifyError(e instanceof Error ? e.message : '加载会话失败')
    }
  }
  finally {
    detailInFlight = false
    if (gen === detailFetchGen && activeId.value === sessionId) {
      loadingDetail.value = false
    }
  }
}

function selectSession(id: string) {
  detailFetchGen += 1
  activeId.value = id
  const s = sessions.value.find(x => x.id === id)
  if (s && s.unread > 0) {
    s.unread = 0
    csMenuHasUnread.value = sessions.value.some(row => Number(row.unread || 0) > 0)
  }
  /** 用详情里的最新消息刷新侧栏预览，避免紧接 GET 会话列表撞到旧快照；完整列表交给轮询统一拉取 */
  void fetchDetail(id, { markRead: true }).then(() => patchSessionSidebarPreview(id, detailMessages.value))
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
        headers: withMallTenantHeaders({ 'Content-Type': 'application/json' }),
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
      detailFetchGen += 1
      applyDetailMessages(payload.data.messages)
      patchSessionSidebarPreview(activeId.value, detailMessages.value)
    }
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
  sessionsPollTimer = window.setInterval(() => {
    void fetchSessions({ silent: true })
  }, SESSIONS_POLL_MS)
  detailPollTimer = window.setInterval(() => {
    if (activeId.value) {
      void fetchDetail(activeId.value, { markRead: false, silent: true })
    }
  }, DETAIL_POLL_MS)
}

function stopPolling() {
  if (sessionsPollTimer) {
    clearInterval(sessionsPollTimer)
    sessionsPollTimer = null
  }
  if (detailPollTimer) {
    clearInterval(detailPollTimer)
    detailPollTimer = null
  }
}

function onDocVisibility() {
  if (typeof document === 'undefined' || document.visibilityState === 'hidden') {
    stopPolling()
    return
  }
  void fetchSessions().then(() => {
    if (activeId.value) {
      void fetchDetail(activeId.value, { markRead: false, silent: true })
    }
  })
  startPolling()
}

onMounted(async () => {
  visHandler = onDocVisibility
  document.addEventListener('visibilitychange', visHandler)
  await fetchSessions()
  if (activeId.value) {
    await fetchDetail(activeId.value, { markRead: true })
  }
  if (typeof document === 'undefined' || document.visibilityState === 'visible') {
    startPolling()
  }
})

onUnmounted(() => {
  if (visHandler && typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', visHandler)
  }
  visHandler = null
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
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.cs-banner {
  flex-shrink: 0;
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
  grid-template-rows: minmax(0, 1fr);
  flex: 1;
  min-height: 0;
  border-radius: 12px;
  border: 1px solid #e5e7eb;
  background: #fff;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
}

.cs-shell :deep(.cs-sessions),
.cs-shell :deep(.cs-chat) {
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

</style>
