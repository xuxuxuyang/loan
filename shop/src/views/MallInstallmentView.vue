<script setup lang="ts">
import AppTabbar from '~/components/App/AppTabbar.vue'
import IndexInstallmentZone from '~/components/index/installment-zone.vue'
import IndexInstallmentZoneM from '~/components/index/installment-zone-m.vue'
import { useTeaProducts, ensureMallProductsLoaded } from '~/composables/useTeaProducts'

const device = useDevice()
const installmentProducts = useTeaProducts()

if (!import.meta.env.SSR) {
  void ensureMallProductsLoaded()
}
</script>

<template>
  <div
    class="normal-font min-h-screen bg-[#f7f7f5]"
    style="padding-bottom: calc(4rem + env(safe-area-inset-bottom));"
  >
    <section id="installment-zone">
      <IndexInstallmentZoneM
        v-if="device.isMobile"
        :products="installmentProducts"
      />
      <IndexInstallmentZone
        v-else
        :products="installmentProducts"
      />
    </section>
    <AppTabbar />
  </div>
</template>

<style scoped>
.normal-font {
  font-family: "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
}
</style>
