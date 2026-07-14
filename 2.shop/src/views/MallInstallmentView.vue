<script setup lang="ts">
import AppTabbar from '~/components/App/AppTabbar.vue'
import InstallmentZoneMobile from '~/components/index/InstallmentZoneMobile.vue'
import { useTeaProducts, ensureMallProductsLoaded } from '~/composables/useTeaProducts'

const installmentProducts = useTeaProducts()

if (!import.meta.env.SSR) {
  void ensureMallProductsLoaded()
}
</script>

<template>
  <div
    class="normal-font min-h-screen bg-[#f7f7f5]"
    style="padding-bottom: calc(4rem + var(--app-safe-area-bottom));"
  >
    <section id="installment-zone">
      <InstallmentZoneMobile :products="installmentProducts" />
    </section>
    <AppTabbar />
  </div>
</template>

<style scoped>
.normal-font {
  font-family: "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
}
</style>
