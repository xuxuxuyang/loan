<script setup lang="ts">
import AppTabbar from '~/components/App/AppTabbar.vue'
import IosOrderCreate from '~/components/ios/order/IosOrderCreate.vue'
import OrderCreate from '~/components/order/create.vue'
import { isIosNativeApp } from '~/utils/iosNativePlatform'

const useIosFlow = isIosNativeApp()
</script>

<template>
  <div
    class="min-h-screen bg-[#f3f4f8] pb-16"
    style="padding-top: var(--app-safe-area-top);"
  >
    <IosOrderCreate v-if="useIosFlow" />
    <OrderCreate v-else />
    <AppTabbar />
  </div>
</template>
