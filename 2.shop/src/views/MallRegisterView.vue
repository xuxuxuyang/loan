<script setup lang="ts">
import RegisterForm from '~/components/auth/RegisterForm.vue'
import IosRegisterForm from '~/components/ios/auth/IosRegisterForm.vue'
import { isIosNativeApp } from '~/utils/iosNativePlatform'

const useIosFlow = isIosNativeApp()
</script>

<template>
  <div
    class="min-h-screen bg-[#f4f6f8]"
    style="padding-top: var(--app-safe-area-top);"
  >
    <IosRegisterForm v-if="useIosFlow" />
    <RegisterForm v-else />
  </div>
</template>
