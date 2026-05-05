<script setup lang="ts">
import ListIndex from '~/components/list/index.vue'
import ListIndexM from '~/components/list/index-m.vue'

definePageMeta({
  layout: false,
})

const device = useDevice()
const products = useTeaProducts()
</script>

<template>
  <div class="min-h-screen pb-16">
    <ListIndexM
      v-if="device.isMobile"
      :products="products"
    />
    <ListIndex
      v-else
      :products="products"
    />
    <AppTabbar />
  </div>
</template>
