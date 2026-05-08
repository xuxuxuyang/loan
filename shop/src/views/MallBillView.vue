<script setup lang="ts">
import AppTabbar from '~/components/App/AppTabbar.vue'
import BillIndex from '~/components/my/bill/index.vue'
import BillIndexM from '~/components/my/bill/index-m.vue'

const device = useDevice()
</script>

<template>
  <div class="min-h-screen bg-[#f3f4f8] pb-16">
    <BillIndexM v-if="device.isMobile" />
    <BillIndex v-else />
    <AppTabbar />
  </div>
</template>
