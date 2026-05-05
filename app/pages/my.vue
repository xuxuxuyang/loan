<script setup lang="ts">
import MyIndex from '~/components/my/index.vue'
import MyIndexM from '~/components/my/index-m.vue'

definePageMeta({
  layout: false,
})

const device = useDevice()
</script>

<template>
  <div class="min-h-screen bg-[#f3f4f8] pb-16">
    <MyIndexM v-if="device.isMobile" />
    <MyIndex v-else />
    <AppTabbar />
  </div>
</template>
