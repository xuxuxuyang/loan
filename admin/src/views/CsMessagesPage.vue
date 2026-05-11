<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ChatDotRound } from '@element-plus/icons-vue'

/** 模拟会话列表（后续可对接真实在线用户与消息接口） */
interface MockSession {
  id: string
  userName: string
  lastMessage: string
  lastAt: string
  online: boolean
  unread: number
}

interface MockMsg {
  id: string
  from: 'user' | 'agent'
  text: string
  time: string
}

const sessions = ref<MockSession[]>([
  {
    id: 's1',
    userName: '访客_8921',
    lastMessage: '先享后付审核大概要多久？',
    lastAt: '14:32',
    online: true,
    unread: 2,
  },
  {
    id: 's2',
    userName: '李**',
    lastMessage: '好的，谢谢',
    lastAt: '昨天',
    online: false,
    unread: 0,
  },
  {
    id: 's3',
    userName: '王**',
    lastMessage: '物流单号能改吗',
    lastAt: '周一',
    online: true,
    unread: 0,
  },
])

const messagesBySession = reactive<Record<string, MockMsg[]>>({
  s1: [
    { id: 'm1', from: 'user', text: '你好，我想问下先享后付审核大概要多久？', time: '14:28' },
    { id: 'm2', from: 'agent', text: '您好，人工审核一般 1 个工作日内完成，请耐心等待。', time: '14:30' },
    { id: 'm3', from: 'user', text: '如果补充材料是发到哪个邮箱？', time: '14:31' },
  ],
  s2: [
    { id: 'm1', from: 'user', text: '还款日可以调整吗？', time: '昨天 10:12' },
    { id: 'm2', from: 'agent', text: '目前还款日按合同约定执行，暂不支持单独调整。', time: '昨天 10:18' },
    { id: 'm3', from: 'user', text: '好的，谢谢', time: '昨天 10:20' },
  ],
  s3: [
    { id: 'm1', from: 'user', text: '物流单号能改吗', time: '周一 09:05' },
  ],
})

const activeId = ref(sessions.value[0]?.id ?? '')
const draft = ref('')

const activeSession = computed(() => sessions.value.find(s => s.id === activeId.value))
const currentMessages = computed(() => messagesBySession[activeId.value] ?? [])

function selectSession(id: string) {
  activeId.value = id
  const s = sessions.value.find(x => x.id === id)
  if (s && s.unread > 0)
    s.unread = 0
}

function mockSend() {
  const t = draft.value.trim()
  if (!t || !activeId.value)
    return
  const list = messagesBySession[activeId.value]
  if (!list)
    return
  list.push({
    id: `local-${Date.now()}`,
    from: 'agent',
    text: t,
    time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
  })
  draft.value = ''
  const s = sessions.value.find(x => x.id === activeId.value)
  if (s) {
    s.lastMessage = t
    s.lastAt = '刚刚'
  }
}
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
          以下为模拟界面：左侧会话、右侧聊天记录与输入区。后续可接入 WebSocket / 轮询与真实用户体系。
        </p>
      </div>
    </div>

    <div class="cs-shell">
      <aside class="cs-sessions">
        <div class="cs-sessions-head">
          会话列表
          <span class="cs-sessions-hint">演示数据</span>
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
        </ul>
      </aside>

      <section class="cs-chat">
        <header
          v-if="activeSession"
          class="cs-chat-head"
        >
          <div>
            <strong>{{ activeSession.userName }}</strong>
            <span
              class="cs-status-pill"
              :class="activeSession.online ? 'is-online' : 'is-offline'"
            >
              {{ activeSession.online ? '在线' : '离线' }}
            </span>
          </div>
          <span class="cs-chat-sub">会话 ID：{{ activeSession.id }}（模拟）</span>
        </header>
        <div class="cs-messages">
          <div
            v-for="m in currentMessages"
            :key="m.id"
            class="cs-msg"
            :class="m.from === 'user' ? 'cs-msg--user' : 'cs-msg--agent'"
          >
            <div class="cs-msg-bubble">
              {{ m.text }}
            </div>
            <div class="cs-msg-meta">
              {{ m.from === 'user' ? '客户' : '客服' }} · {{ m.time }}
            </div>
          </div>
          <p
            v-if="!currentMessages.length"
            class="cs-empty"
          >
            暂无消息
          </p>
        </div>
        <footer class="cs-composer">
          <el-input
            v-model="draft"
            type="textarea"
            :rows="2"
            maxlength="500"
            show-word-limit
            placeholder="输入回复（仅前端演示，不会真实发送）"
            @keydown.enter.exact.prevent="mockSend"
          />
          <el-button
            type="primary"
            :disabled="!draft.trim()"
            @click="mockSend"
          >
            发送（模拟）
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
