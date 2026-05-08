<script setup lang="ts">
/**
 * 个人中心入口：卡包独立页 `/card-package`；其余跳转见组件内路由。
 */
import AppTabbar from '~/components/App/AppTabbar.vue'
import MyIndex from '~/components/my/index.vue'
import MyIndexM from '~/components/my/index-m.vue'

const device = useDevice()
</script>

<template>
  <div class="min-h-screen bg-[#f3f4f8] pb-16">
    <MyIndexM v-if="device.isMobile" />
    <MyIndex v-else />
    <AppTabbar />
  </div>
</template>
