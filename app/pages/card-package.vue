<script setup lang="ts">
import CardPackageIndex from '~/components/my/card-package/index.vue'
import CardPackageIndexM from '~/components/my/card-package/index-m.vue'

definePageMeta({
  layout: false,
})

const device = useDevice()
</script>

<template>
  <div class="min-h-screen bg-[#f3f4f8] pb-16">
    <CardPackageIndexM v-if="device.isMobile" />
    <CardPackageIndex v-else />
    <AppTabbar />
  </div>
</template>
