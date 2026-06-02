<script setup lang="ts">
import AppTabbar from '~/components/App/AppTabbar.vue'
const MyCardPackageMobile = defineAsyncComponent(() => import('~/components/my/card-package/MyCardPackageMobile.vue'))
</script>

<template>
  <div class="min-h-screen bg-[#f3f4f8] pb-16">
    <MyCardPackageMobile />
    <AppTabbar />
  </div>
</template>
