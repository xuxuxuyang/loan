<script setup lang="ts">
import UserAgreementContent from '~/components/my/user-agreement/UserAgreementContent.vue'

const route = useRoute()
const router = useRouter()
const { smartNavigate } = useCustomRouting(route)

async function goBack() {
  if (import.meta.env.SSR) {
    return
  }
  if (window.history.length > 1) {
    router.back()
    return
  }
  await smartNavigate('/my')
}
</script>

<template>
  <div class="agreement-page min-h-[100dvh] flex flex-col bg-[#f3f4f8]">
    <header class="agreement-header flex shrink-0 items-center gap-3 px-3 py-3 text-white">
      <button
        type="button"
        class="tap flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-lg leading-none"
        aria-label="返回"
        @click="goBack"
      >
        ‹
      </button>
      <div class="min-w-0 flex-1">
        <p class="truncate text-[15px] font-semibold md:text-base">
          用户注册协议
        </p>
        <p class="truncate text-[11px] text-white/85 md:text-xs">
          注册与使用本服务前请阅读
        </p>
      </div>
    </header>

    <main class="flex-1 overflow-y-auto px-4 py-4 pb-[max(1rem,var(--app-safe-area-bottom))] md:px-6 md:py-6">
      <div class="mx-auto max-w-[720px] rounded-2xl bg-white p-5 shadow-sm md:p-8">
        <UserAgreementContent />
      </div>
    </main>
  </div>
</template>

<style scoped>
.agreement-header {
  background: linear-gradient(120deg, #8ea8ff, #ff8fb3);
  padding-top: max(0.75rem, var(--app-safe-area-top));
}

.tap:active {
  opacity: 0.88;
}
</style>
