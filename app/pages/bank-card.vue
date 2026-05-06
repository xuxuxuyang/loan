<script setup lang="ts">
import BankCardIndex from '~/components/my/bank-card/index.vue'
import BankCardIndexM from '~/components/my/bank-card/index-m.vue'

definePageMeta({
  layout: false,
})

const device = useDevice()
</script>

<template>
  <div class="min-h-screen bg-[#f3f4f8] pb-16">
    <BankCardIndexM v-if="device.isMobile" />
    <BankCardIndex v-else />
    <AppTabbar />
  </div>
</template>
