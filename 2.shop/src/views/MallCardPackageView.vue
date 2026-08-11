<script setup lang="ts">
import AppTabbar from '~/components/App/AppTabbar.vue'

const MyCardPackageMobile = defineAsyncComponent(() => import('~/components/my/card-package/MyCardPackageMobile.vue'))
</script>

<template>
  <div
    class="min-h-screen bg-[#f3f4f8] pb-16"
    style="padding-top: var(--app-safe-area-top);"
  >
    <MyCardPackageMobile />
    <AppTabbar />
  </div>
</template>
