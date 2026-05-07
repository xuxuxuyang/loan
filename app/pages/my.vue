<script setup lang="ts">
/**
 * 个人中心入口：卡包见 `/card-package`；其余见 `components/my`。
 */
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
