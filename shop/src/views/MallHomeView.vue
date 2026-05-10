<script setup lang="ts">
import AppTabbar from '~/components/App/AppTabbar.vue'
import IndexBanner from '~/components/index/banner.vue'
import IndexBannerM from '~/components/index/banner-m.vue'
import IndexList from '~/components/index/list.vue'
import IndexListM from '~/components/index/list-m.vue'
import type { MallCategoryKey } from '~/composables/useTeaProducts'
import {
  useMallCategories,
  isMallCategoryKey,
  useMallShowcaseProducts,
  ensureMallShowcaseProductsLoaded,
} from '~/composables/useTeaProducts'

const device = useDevice()
const route = useRoute()
const mallProducts = useMallShowcaseProducts()
const categories = useMallCategories().filter(item => item.key !== 'all')
const selectedCategory = ref<MallCategoryKey>('travel')

if (typeof route.query.category === 'string' && isMallCategoryKey(route.query.category) && route.query.category !== 'all') {
  selectedCategory.value = route.query.category
}

if (!import.meta.env.SSR) {
  void ensureMallShowcaseProductsLoaded()
}

watch(
  mallProducts,
  () => {
    const list = mallProducts.value
    if (list.length === 0) {
      return
    }
    const sel = selectedCategory.value
    if (list.some(p => p.category === sel)) {
      return
    }
    const first = list[0]?.category
    if (first && isMallCategoryKey(first)) {
      selectedCategory.value = first
    }
  },
  { immediate: true },
)

const filteredMall = computed(() =>
  mallProducts.value.filter(item => item.category === selectedCategory.value),
)

function handleSelectCategory(category: MallCategoryKey) {
  if (category === 'all') {
    return
  }
  selectedCategory.value = category
}

function scrollToAnchor(id: string) {
  if (import.meta.env.SSR) {
    return
  }
  const el = document.getElementById(id)
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
</script>

<template>
  <div
    class="bg-[#f7f7f5] min-h-screen"
    style="padding-bottom: calc(4rem + env(safe-area-inset-bottom));"
  >
    <IndexBannerM
      v-if="device.isMobile"
      :preview-products="filteredMall"
      :categories="categories"
      :active-category="selectedCategory"
      @select-category="handleSelectCategory"
      @go-mall-zone="scrollToAnchor('mall-showcase')"
    />
    <IndexBanner
      v-else
      :preview-products="filteredMall"
      :categories="categories"
      :active-category="selectedCategory"
      @select-category="handleSelectCategory"
      @go-mall-zone="scrollToAnchor('mall-showcase')"
    />

    <section id="mall-showcase">
      <IndexListM
        v-if="device.isMobile"
        :products="filteredMall"
        display-only
      />
      <IndexList
        v-else
        :products="filteredMall"
        display-only
      />
    </section>
    <AppTabbar />
  </div>
</template>
