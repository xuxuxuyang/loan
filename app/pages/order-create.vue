<script setup lang="ts">
import OrderCreate from '~/components/order/create.vue'

definePageMeta({
  layout: false,
})
</script>

<template>
  <div class="min-h-screen bg-[#f3f4f8] pb-16">
    <OrderCreate />
    <AppTabbar />
  </div>
</template>
