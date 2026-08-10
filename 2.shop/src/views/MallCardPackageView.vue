<script setup lang="ts">
import AppTabbar from '~/components/App/AppTabbar.vue'
import IosCardPackageMobile from '~/components/ios/my/IosCardPackageMobile.vue'
import { isIosNativeApp } from '~/utils/iosNativePlatform'

const MyCardPackageMobile = defineAsyncComponent(() => import('~/components/my/card-package/MyCardPackageMobile.vue'))
const useIosFlow = isIosNativeApp()
</script>

<template>
  <div
    class="min-h-screen bg-[#f3f4f8] pb-16"
    style="padding-top: var(--app-safe-area-top);"
  >
    <IosCardPackageMobile v-if="useIosFlow" />
    <MyCardPackageMobile v-else />
    <AppTabbar />
  </div>
</template>
