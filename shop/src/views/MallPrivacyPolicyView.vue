<script setup lang="ts">
import PrivacyPolicyContent from '~/components/my/privacy-policy/PrivacyPolicyContent.vue'

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
  <div class="privacy-page min-h-[100dvh] flex flex-col bg-[#f3f4f8]">
    <header class="privacy-header flex shrink-0 items-center gap-3 px-3 py-3 text-white">
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
          隐私政策
        </p>
        <p class="truncate text-[11px] text-white/85 md:text-xs">
          了解我们如何收集与使用您的信息
        </p>
      </div>
    </header>

    <!-- <main class="flex-1 overflow-y-auto px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:px-6 md:py-6">
      <div class="mx-auto max-w-[720px] rounded-2xl bg-white p-5 shadow-sm md:p-8">
        <PrivacyPolicyContent />
      </div>
    </main> -->
  </div>
</template>

<style scoped>
.privacy-header {
  background: linear-gradient(120deg, #ff8fb3, #8ea8ff);
  padding-top: max(0.75rem, env(safe-area-inset-top));
}

.tap:active {
  opacity: 0.88;
}
</style>
