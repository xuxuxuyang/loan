<script setup lang="ts">
import IndexBanner from '~/components/index/banner.vue'
import IndexBannerM from '~/components/index/banner-m.vue'
import IndexList from '~/components/index/list.vue'
import IndexListM from '~/components/index/list-m.vue'

definePageMeta({
  layout: false,
})

const device = useDevice()
const products = useTeaProducts()
</script>

<template>
  <div class="bg-[#f7f7f5] min-h-screen pb-16">
    <IndexBannerM
      v-if="device.isMobile"
      :products="products"
    />
    <IndexBanner
      v-else
      :products="products"
    />

    <IndexListM
      v-if="device.isMobile"
      :products="products"
    />
    <IndexList
      v-else
      :products="products"
    />
    <AppTabbar />
  </div>
</template>
