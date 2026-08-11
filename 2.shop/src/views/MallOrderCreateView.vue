<script setup lang="ts">
import AppTabbar from '~/components/App/AppTabbar.vue'
import OrderCreate from '~/components/order/create.vue'
</script>

<template>
  <div
    class="min-h-screen bg-[#f3f4f8] pb-16"
    style="padding-top: var(--app-safe-area-top);"
  >
    <OrderCreate />
    <AppTabbar />
  </div>
</template>
