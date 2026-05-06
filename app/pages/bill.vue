<script setup lang="ts">
import BillIndex from '~/components/my/bill/index.vue'
import BillIndexM from '~/components/my/bill/index-m.vue'

definePageMeta({
  layout: false,
})

const device = useDevice()
</script>

<template>
  <div class="min-h-screen bg-[#f3f4f8] pb-16">
    <BillIndexM v-if="device.isMobile" />
    <BillIndex v-else />
    <AppTabbar />
  </div>
</template>
