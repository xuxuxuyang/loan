<script setup lang="ts">
import AppTabbar from '~/components/App/AppTabbar.vue'
const MyOrderMobile = defineAsyncComponent(() => import('~/components/my/order/MyOrderMobile.vue'))
</script>

<template>
  <div class="min-h-screen bg-[#f3f4f8] pb-16">
    <MyOrderMobile />
    <AppTabbar />
  </div>
</template>
