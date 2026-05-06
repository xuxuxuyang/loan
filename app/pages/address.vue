<script setup lang="ts">
import AddressIndex from '~/components/my/address/index.vue'
import AddressIndexM from '~/components/my/address/index-m.vue'

definePageMeta({
  layout: false,
})

const device = useDevice()
</script>

<template>
  <div class="min-h-screen bg-[#f3f4f8] pb-16">
    <AddressIndexM v-if="device.isMobile" />
    <AddressIndex v-else />
    <AppTabbar />
  </div>
</template>
