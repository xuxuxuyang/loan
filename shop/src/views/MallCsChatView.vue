<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { CsChatMessage } from '~/composables/useMallCsChat'
import { resolveCsImageDisplayUrl, useMallCsChat } from '~/composables/useMallCsChat'

const router = useRouter()
const { syncFromStorage } = useMallAuth()
const {
  displayName,
  messages,
  loading,
  sending,
  errorText,
  openSession,
  pullMessages,
  sendUserMessage,
  sendUserImage,
  startPolling,
  stopPolling,
} = useMallCsChat()

const draft = ref('')
const imageInputRef = ref<HTMLInputElement | null>(null)
const listRef = ref<HTMLElement | null>(null)

function formatMsgTime(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) {
    return ''
  }
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

async function scrollToBottom() {
  await nextTick()
  const el = listRef.value
  if (el) {
    el.scrollTop = el.scrollHeight
  }
}

watch(
  () => messages.value.length,
  () => {
    void scrollToBottom()
  },
)

onMounted(async () => {
  try {
    await syncFromStorage()
    await openSession()
    await pullMessages()
    startPolling()
    await scrollToBottom()
  }
  catch {
    /* errorText 已由 composable 设置 */
  }
})

onUnmounted(() => {
  stopPolling()
})

async function onSend() {
  const t = draft.value.trim()
  if (!t || sending.value) {
    return
  }
  draft.value = ''
  await sendUserMessage(t)
  await scrollToBottom()
}

function isCsImageMessage(m: CsChatMessage) {
  return m.type === 'image' || Boolean(String(m.imageUrl || '').trim())
}

function csMessageImageSrc(m: CsChatMessage): string {
  if (!isCsImageMessage(m)) {
    return ''
  }
  return resolveCsImageDisplayUrl(m.imageUrl || '')
}

function openImagePicker() {
  imageInputRef.value?.click()
}

async function onImageSelected(ev: Event) {
  const el = ev.target as HTMLInputElement
  const file = el.files?.[0]
  el.value = ''
  if (!file || loading.value || sending.value) {
    return
  }
  await sendUserImage(file)
  await scrollToBottom()
}

function bubbleClass(m: CsChatMessage) {
  return m.role === 'user' ? 'bubble-user' : 'bubble-agent'
}
</script>

<template>
  <div class="cs-chat-page min-h-[100dvh] flex flex-col bg-[#f4f7fb]">
    <header class="cs-header flex shrink-0 items-center gap-3 px-3 py-3 text-white">
      <button
        type="button"
        class="tap flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-lg leading-none"
        aria-label="返回"
        @click="router.back()"
      >
        ‹
      </button>
      <div class="min-w-0 flex-1">
        <p class="truncate text-[15px] font-semibold">
          在线客服
        </p>
        <p class="truncate text-[11px] text-white/85">
          {{ displayName || '连接中…' }}
        </p>
      </div>
    </header>

    <div
      v-if="errorText && !loading"
      class="mx-3 mt-3 rounded-xl border border-amber-200/80 bg-amber-50 px-3 py-2 text-xs text-amber-900"
    >
      {{ errorText }}
    </div>

    <div
      v-if="loading"
      class="flex flex-1 items-center justify-center py-16 text-sm text-slate-500"
    >
      正在连接客服…
    </div>

    <div
      v-else
      ref="listRef"
      class="flex flex-1 flex-col gap-3 overflow-y-auto px-3 py-4"
    >
      <p
        v-if="!messages.length"
        class="mt-8 text-center text-xs text-slate-400"
      >
        有问题尽管问，客服会尽快回复您
      </p>
      <div
        v-for="m in messages"
        :key="m.id"
        class="flex flex-col"
        :class="m.role === 'user' ? 'items-end' : 'items-start'"
      >
        <div
          class="max-w-[85%] rounded-2xl text-[14px] leading-relaxed shadow-sm"
          :class="[bubbleClass(m), isCsImageMessage(m) ? 'p-1.5' : 'px-3 py-2']"
        >
          <img
            v-if="csMessageImageSrc(m)"
            :src="csMessageImageSrc(m)"
            alt="图片消息"
            class="cs-chat-img block max-h-[min(52vh,280px)] max-w-full rounded-xl object-contain"
            loading="lazy"
          >
          <span
            v-else-if="isCsImageMessage(m)"
            class="whitespace-pre-wrap text-slate-400"
          >[图片]</span>
          <span
            v-else
            class="whitespace-pre-wrap"
          >{{ m.text }}</span>
        </div>
        <p class="mt-1 px-1 text-[10px] text-slate-400">
          {{ m.role === 'user' ? '我' : '平台客服' }} · {{ formatMsgTime(m.createdAt) }}
        </p>
      </div>
    </div>

    <footer class="shrink-0 border-t border-slate-200/80 bg-white px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      <input
        ref="imageInputRef"
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        class="sr-only"
        tabindex="-1"
        aria-hidden="true"
        @change="onImageSelected"
      >
      <div class="flex items-center gap-2">
        <textarea
          v-model="draft"
          rows="1"
          maxlength="2000"
          class="composer-input box-border h-10 min-h-10 max-h-10 flex-1 resize-none overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 px-3 py-0 text-sm leading-10 outline-none focus:border-[#e06f8d] focus:ring-1 focus:ring-[#e06f8d]/30"
          placeholder="输入消息，Enter 发送"
          @keydown.enter.exact.prevent="onSend"
        />
        <button
          type="button"
          class="img-picker-btn tap flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#e8cad3]/90 bg-[#fffafb] text-[#b84562] shadow-sm disabled:pointer-events-none disabled:opacity-40"
          aria-label="发送图片"
          title="发送图片"
          :disabled="sending || loading"
          @click="openImagePicker"
        >
          <Icon
            name="tabler:photo"
            class="pointer-events-none text-[1.05rem]"
            aria-hidden="true"
          />
        </button>
        <button
          type="button"
          class="send-btn inline-flex h-10 shrink-0 items-center justify-center rounded-xl px-4 text-sm font-semibold text-white disabled:opacity-40"
          :disabled="sending || !draft.trim()"
          @click="onSend"
        >
          发送
        </button>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.cs-header {
  background: linear-gradient(120deg, #ff8fb3, #8ea8ff);
  padding-top: max(0.75rem, env(safe-area-inset-top));
}

.tap:active {
  opacity: 0.88;
}

.img-picker-btn:active:not(:disabled) {
  border-color: rgba(224, 111, 141, 0.45);
  background: linear-gradient(180deg, #fff5f8, #fff0f4);
}

.bubble-user {
  background: linear-gradient(135deg, #fff6f9, #fff);
  border: 1px solid rgba(240, 156, 173, 0.25);
  color: #2c3140;
  border-bottom-right-radius: 6px;
}

.bubble-agent {
  background: linear-gradient(135deg, #3b82f6, #2563eb);
  color: #fff;
  border-bottom-left-radius: 6px;
}

.send-btn {
  background: linear-gradient(135deg, #ff8fb3, #ff6e92);
  box-shadow: 0 6px 14px rgba(229, 120, 150, 0.35);
}
</style>
