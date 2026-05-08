<script setup lang="ts">
import AppTabbar from '~/components/App/AppTabbar.vue'
import MyOrderIndex from '~/components/my/order/index.vue'
import MyOrderIndexM from '~/components/my/order/index-m.vue'

const device = useDevice()
const isMobileView = ref(device.isMobile)

const syncMobileView = () => {
  isMobileView.value = Boolean(device.isMobile) || window.innerWidth <= 1100
}

onMounted(() => {
  syncMobileView()
  window.addEventListener('resize', syncMobileView)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', syncMobileView)
})
</script>

<template>
  <div class="min-h-screen bg-[#f3f4f8] pb-16">
    <MyOrderIndexM v-if="isMobileView" />
    <MyOrderIndex v-else />
    <AppTabbar />
  </div>
</template>
