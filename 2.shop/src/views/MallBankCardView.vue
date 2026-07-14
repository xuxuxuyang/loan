<script setup lang="ts">
import AppTabbar from '~/components/App/AppTabbar.vue'
const MyBankCardMobile = defineAsyncComponent(() => import('~/components/my/bank-card/MyBankCardMobile.vue'))
</script>

<template>
  <div
    class="min-h-screen bg-[#f3f4f8] pb-16"
    style="padding-top: var(--app-safe-area-top);"
  >
    <MyBankCardMobile />
    <AppTabbar />
  </div>
</template>
