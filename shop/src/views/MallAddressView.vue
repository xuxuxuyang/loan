<script setup lang="ts">
import AppTabbar from '~/components/App/AppTabbar.vue'
import AddressIndex from '~/components/my/address/index.vue'
import AddressIndexM from '~/components/my/address/index-m.vue'

const device = useDevice()
</script>

<template>
  <div class="min-h-screen bg-[#f3f4f8] pb-16">
    <AddressIndexM v-if="device.isMobile" />
    <AddressIndex v-else />
    <AppTabbar />
  </div>
</template>
