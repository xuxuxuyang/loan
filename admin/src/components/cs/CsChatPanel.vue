<script setup lang="ts">
import { ref } from 'vue'
import { Picture } from '@element-plus/icons-vue'

export interface CsChatMessage {
  id: string
  role: 'user' | 'agent'
  text: string
  createdAt: string
  agentName?: string
  type?: 'text' | 'image'
  imageUrl?: string
}

defineProps<{
  activeId: string
  activeSessionUserName?: string
  activeSessionId?: string
  detailTitle: string
  detailOnline: boolean
  detailMessages: CsChatMessage[]
  loadingDetail: boolean
  sending: boolean
  draft: string
  isCsImageMessage: (m: CsChatMessage) => boolean
  csChatImageSrc: (m: CsChatMessage) => string
  formatMsgTime: (iso: string) => string
}>()

const emit = defineEmits<{
  draftChange: [value: string]
  sendReply: []
  imageChange: [ev: Event]
}>()

const fileInputRef = ref<HTMLInputElement | null>(null)

function pickImage() {
  fileInputRef.value?.click()
}

function onFileChange(ev: Event) {
  emit('imageChange', ev)
}

function onDraftInput(value: string) {
  emit('draftChange', value)
}
</script>

<template>
  <section class="cs-chat">
    <header
      v-if="activeSessionUserName || detailTitle"
      class="cs-chat-head"
    >
      <div>
        <strong>{{ detailTitle || activeSessionUserName || '—' }}</strong>
        <span
          class="cs-status-pill"
          :class="detailOnline ? 'is-online' : 'is-offline'"
        >
          {{ detailOnline ? '在线' : '离线' }}
        </span>
      </div>
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
              v-if="csChatImageSrc(m)"
              :src="csChatImageSrc(m)"
              alt=""
              class="cs-msg-img"
              loading="lazy"
            >
            <template v-else-if="isCsImageMessage(m)">
              [图片]
            </template>
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
        ref="fileInputRef"
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        class="cs-hidden-file"
        tabindex="-1"
        aria-hidden="true"
        @change="onFileChange"
      >
      <el-input
        :model-value="draft"
        type="textarea"
        :rows="2"
        maxlength="2000"
        show-word-limit
        placeholder="输入回复后发送给用户"
        :disabled="!activeId"
        @update:model-value="onDraftInput"
        @keydown.enter.exact.prevent="$emit('sendReply')"
      />
      <el-button
        class="cs-composer-img-btn"
        :disabled="!activeId || sending"
        aria-label="发送图片"
        @click="pickImage"
      >
        <el-icon><Picture /></el-icon>
      </el-button>
      <el-button
        type="primary"
        :loading="sending"
        :disabled="!draft.trim() || !activeId"
        @click="$emit('sendReply')"
      >
        发送
      </el-button>
    </footer>
  </section>
</template>

<style scoped>
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
  color: #a8a1a1;
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

.cs-composer-img-btn.el-button {
  flex-shrink: 0;
  width: var(--el-component-size);
  height: var(--el-component-size);
  min-height: var(--el-component-size);
  padding: 0;
  align-self: flex-end;
}

.cs-composer-img-btn.el-button .el-icon {
  font-size: calc(var(--el-component-size) * 0.42);
}
</style>
