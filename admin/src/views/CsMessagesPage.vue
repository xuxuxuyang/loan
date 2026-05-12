<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { ChatDotRound, Picture } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
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

const sessions = ref<SessionRow[]>([])
const activeId = ref('')
const draft = ref('')
const agentImageInputRef = ref<HTMLInputElement | null>(null)
const detailMessages = ref<ChatMessage[]>([])
const detailTitle = ref('')
const detailOnline = ref(false)
const loadingList = ref(false)
const loadingDetail = ref(false)
const sending = ref(false)
let pollTimer: ReturnType<typeof setInterval> | null = null

const activeSession = computed(() => sessions.value.find(s => s.id === activeId.value))

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

function resolveCsImageUrl(pathOrUrl: string): string {
  const s = String(pathOrUrl || '').trim()
  if (!s) {
    return ''
  }
  if (/^https?:\/\//i.test(s)) {
    return s
  }
  const base = MALL_API_BASE.replace(/\/$/, '')
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

function isCsImageMessage(m: ChatMessage): boolean {
  return m.type === 'image' || Boolean(String(m.imageUrl || '').trim())
}

function pickAgentImage() {
  agentImageInputRef.value?.click()
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
    ElMessage.error(e instanceof Error ? e.message : '图片发送失败')
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
    ElMessage.error(e instanceof Error ? e.message : '加载会话失败')
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
    ElMessage.error(e instanceof Error ? e.message : '发送失败')
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
        <p class="cs-banner-desc">
          与商城 H5 在线客服实时互通：用户从首页「客服」进入聊天；本页轮询拉取会话与回复。超级管理员与审核员可访问。
        </p>
      </div>
    </div>

    <div class="cs-shell">
      <aside class="cs-sessions">
        <div class="cs-sessions-head">
          会话列表
          <span class="cs-sessions-hint">{{ loadingList ? '加载中…' : `${sessions.length} 个` }}</span>
        </div>
        <ul class="cs-session-list">
          <li
            v-for="s in sessions"
            :key="s.id"
            class="cs-session-item"
            :class="{ 'is-active': s.id === activeId }"
            @click="selectSession(s.id)"
          >
            <span
              class="cs-online-dot"
              :class="{ 'is-on': s.online }"
              :title="s.online ? '在线' : '离线'"
            />
            <div class="cs-session-main">
              <div class="cs-session-row">
                <span class="cs-session-name">{{ s.userName }}</span>
                <span class="cs-session-time">{{ s.lastAt }}</span>
              </div>
              <div class="cs-session-preview">
                {{ s.lastMessage }}
              </div>
            </div>
            <span
              v-if="s.unread > 0"
              class="cs-unread"
            >{{ s.unread > 99 ? '99+' : s.unread }}</span>
          </li>
          <li
            v-if="!sessions.length && !loadingList"
            class="cs-empty-list"
          >
            暂无用户进线
          </li>
        </ul>
      </aside>

      <section class="cs-chat">
        <header
          v-if="activeSession || detailTitle"
          class="cs-chat-head"
        >
          <div>
            <strong>{{ detailTitle || activeSession?.userName || '—' }}</strong>
            <span
              class="cs-status-pill"
              :class="detailOnline ? 'is-online' : 'is-offline'"
            >
              {{ detailOnline ? '在线' : '离线' }}
            </span>
          </div>
          <span class="cs-chat-sub">会话 ID：{{ activeSession?.id || activeId || '—' }}</span>
        </header>
        <div class="cs-messages">
          <template v-if="loadingDetail && !detailMessages.length">
            <p class="cs-empty">
              加载中…
            </p>
          </template>
          <template v-else>
            <div
              v-for="m in detailMessages"
              :key="m.id"
              class="cs-msg"
              :class="m.role === 'user' ? 'cs-msg--user' : 'cs-msg--agent'"
            >
              <div class="cs-msg-bubble">
                <img
                  v-if="isCsImageMessage(m)"
                  :src="resolveCsImageUrl(m.imageUrl || '')"
                  alt=""
                  class="cs-msg-img"
                  loading="lazy"
                >
                <template v-else>
                  {{ m.text }}
                </template>
              </div>
              <div class="cs-msg-meta">
                {{ m.role === 'user' ? '客户' : (m.agentName || '客服') }} · {{ formatMsgTime(m.createdAt) }}
              </div>
            </div>
            <p
              v-if="!detailMessages.length"
              class="cs-empty"
            >
              暂无消息
            </p>
          </template>
        </div>
        <footer class="cs-composer">
          <input
            ref="agentImageInputRef"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            class="cs-hidden-file"
            tabindex="-1"
            aria-hidden="true"
            @change="onAgentImageSelected"
          >
          <el-input
            v-model="draft"
            type="textarea"
            :rows="2"
            maxlength="2000"
            show-word-limit
            placeholder="输入回复后发送给用户"
            :disabled="!activeId"
            @keydown.enter.exact.prevent="sendReply"
          />
          <el-button
            circle
            :disabled="!activeId || sending"
            aria-label="发送图片"
            @click="pickAgentImage"
          >
            <el-icon><Picture /></el-icon>
          </el-button>
          <el-button
            type="primary"
            :loading="sending"
            :disabled="!draft.trim() || !activeId"
            @click="sendReply"
          >
            发送
          </el-button>
        </footer>
      </section>
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

.cs-sessions {
  border-right: 1px solid #e5e7eb;
  background: #fafafa;
  display: flex;
  flex-direction: column;
}

.cs-sessions-head {
  padding: 12px 14px;
  font-size: 13px;
  font-weight: 600;
  color: #374151;
  border-bottom: 1px solid #e5e7eb;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.cs-sessions-hint {
  font-size: 11px;
  font-weight: 500;
  color: #9ca3af;
}

.cs-session-list {
  list-style: none;
  margin: 0;
  padding: 8px;
  overflow-y: auto;
  flex: 1;
}

.cs-session-item {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 10px 10px;
  border-radius: 8px;
  cursor: pointer;
  margin-bottom: 4px;
  transition: background 0.15s;
}

.cs-session-item:hover {
  background: #f3f4f6;
}

.cs-session-item.is-active {
  background: #e0e7ff;
}

.cs-empty-list {
  padding: 24px 12px;
  text-align: center;
  font-size: 13px;
  color: #9ca3af;
}

.cs-online-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-top: 6px;
  flex-shrink: 0;
  background: #d1d5db;
}

.cs-online-dot.is-on {
  background: #22c55e;
  box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.25);
}

.cs-session-main {
  flex: 1;
  min-width: 0;
}

.cs-session-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.cs-session-name {
  font-size: 14px;
  font-weight: 600;
  color: #111827;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cs-session-time {
  font-size: 11px;
  color: #9ca3af;
  flex-shrink: 0;
}

.cs-session-preview {
  font-size: 12px;
  color: #6b7280;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cs-unread {
  flex-shrink: 0;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: #ef4444;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.cs-chat {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.cs-chat-head {
  padding: 12px 16px;
  border-bottom: 1px solid #e5e7eb;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.cs-chat-head strong {
  font-size: 15px;
  color: #111827;
}

.cs-status-pill {
  margin-left: 8px;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
  vertical-align: middle;
}

.cs-status-pill.is-online {
  background: #dcfce7;
  color: #166534;
}

.cs-status-pill.is-offline {
  background: #f3f4f6;
  color: #6b7280;
}

.cs-chat-sub {
  font-size: 12px;
  color: #9ca3af;
}

.cs-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  background: #f9fafb;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.cs-msg {
  display: flex;
  flex-direction: column;
  max-width: 78%;
}

.cs-msg--user {
  align-self: flex-start;
}

.cs-msg--agent {
  align-self: flex-end;
}

.cs-msg-bubble {
  padding: 10px 12px;
  border-radius: 12px;
  font-size: 14px;
  line-height: 1.45;
  word-break: break-word;
}

.cs-msg--user .cs-msg-bubble {
  background: #fff;
  border: 1px solid #e5e7eb;
  color: #1f2937;
  border-bottom-left-radius: 4px;
}

.cs-msg--agent .cs-msg-bubble {
  background: #2563eb;
  color: #fff;
  border-bottom-right-radius: 4px;
}

.cs-msg-meta {
  font-size: 11px;
  color: #9ca3af;
  margin-top: 4px;
  padding: 0 4px;
}

.cs-msg--agent .cs-msg-meta {
  text-align: right;
}

.cs-empty {
  margin: auto;
  font-size: 13px;
  color: #9ca3af;
}

.cs-msg-img {
  display: block;
  max-width: min(100%, 320px);
  max-height: 280px;
  border-radius: 8px;
  vertical-align: middle;
}

.cs-hidden-file {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
  overflow: hidden;
}

.cs-composer {
  padding: 12px 16px;
  border-top: 1px solid #e5e7eb;
  display: flex;
  gap: 10px;
  align-items: flex-end;
  background: #fff;
}

.cs-composer :deep(.el-textarea) {
  flex: 1;
}
</style>
