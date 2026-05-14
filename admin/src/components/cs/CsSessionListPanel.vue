<script setup lang="ts">
export interface CsSessionRow {
  id: string
  userName: string
  lastMessage: string
  lastAt: string
  online: boolean
  unread: number
}

defineProps<{
  sessions: CsSessionRow[]
  activeId: string
  loadingList: boolean
}>()

const emit = defineEmits<{
  select: [id: string]
}>()

function onSelect(id: string) {
  emit('select', id)
}
</script>

<template>
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
        @click="onSelect(s.id)"
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
</template>

<style scoped>
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
  color: #a8a1a1;
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
</style>
