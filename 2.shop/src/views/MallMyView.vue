<script setup lang="ts">
/**
 * 个人中心入口：卡包独立页 `/card-package`；其余跳转见组件内路由。
 */
import AppTabbar from '~/components/App/AppTabbar.vue'
import IosMyCenterMobile from '~/components/ios/my/IosMyCenterMobile.vue'
import { isIosNativeApp } from '~/utils/iosNativePlatform'

const MyCenterMobile = defineAsyncComponent(() => import('~/components/my/MyCenterMobile.vue'))
const useIosFlow = isIosNativeApp()
</script>

<template>
  <div class="min-h-screen bg-[#f3f4f8] pb-16">
    <IosMyCenterMobile v-if="useIosFlow" />
    <MyCenterMobile v-else />
    <AppTabbar />
  </div>
</template>
