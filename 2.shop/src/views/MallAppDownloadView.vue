<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useGuardedAppDownload } from '../composables/useGuardedAppDownload'

const { openGuardedAppDownload } = useGuardedAppDownload()
const loading = ref(false)

async function startDownload() {
  if (loading.value) {
    return
  }
  loading.value = true
  try {
    await openGuardedAppDownload()
  }
  finally {
    loading.value = false
  }
}

onMounted(() => {
  void startDownload()
})
</script>

<template>
  <section
    class="min-h-screen bg-[#f4f6f8] px-5 pb-10"
    style="padding-top: max(2.5rem, var(--app-safe-area-top));"
  >
    <div class="mx-auto max-w-[390px] rounded-[28px] bg-white p-6 text-center shadow-sm">
      <div class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-2xl">
        ↓
      </div>
      <h1 class="text-[1.55rem] font-semibold text-[#1f2430]">
        App 下载
      </h1>
      <p class="mt-3 text-sm leading-7 text-black/55">
        正在为您启动 App 下载，如未自动开始，请点击下方按钮重试。
      </p>
      <button
        type="button"
        class="wv-gradient-primary mt-6 w-full rounded-full py-3 text-base font-semibold transition hover:brightness-105 disabled:opacity-60"
        :disabled="loading"
        @click="startDownload"
      >
        {{ loading ? '正在开始下载...' : '继续下载 App' }}
      </button>
    </div>
  </section>
</template>
