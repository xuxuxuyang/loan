<script setup lang="ts">
import AppTabbar from '~/components/App/AppTabbar.vue'
import IndexBanner from '~/components/index/banner.vue'
import IndexBannerM from '~/components/index/banner-m.vue'
import IndexList from '~/components/index/list.vue'
import IndexListM from '~/components/index/list-m.vue'
import type { MallCategoryKey } from '~/composables/useTeaProducts'
import { useMallCategories, isMallCategoryKey, useTeaProducts } from '~/composables/useTeaProducts'

const device = useDevice()
const route = useRoute()
const products = useTeaProducts()
const categories = useMallCategories().filter(item => item.key !== 'all')
const selectedCategory = ref<MallCategoryKey>('travel')

if (typeof route.query.category === 'string' && isMallCategoryKey(route.query.category) && route.query.category !== 'all') {
  selectedCategory.value = route.query.category
}

/** 当前选中类目若无商品但总列表有商品，退回第一个有货的类目（与默认 travel 对上） */
watch(
  products,
  (list) => {
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

const filteredProducts = computed(() => {
  return products.value.filter(item => item.category === selectedCategory.value)
})

function handleSelectCategory(category: MallCategoryKey) {
  if (category === 'all') {
    return
  }
  selectedCategory.value = category
}
</script>

<template>
  <div
    class="bg-[#f7f7f5] min-h-screen"
    style="padding-bottom: calc(4rem + env(safe-area-inset-bottom));"
  >
    <IndexBannerM
      v-if="device.isMobile"
      :products="filteredProducts"
      :categories="categories"
      :active-category="selectedCategory"
      @select-category="handleSelectCategory"
    />
    <IndexBanner
      v-else
      :products="filteredProducts"
      :categories="categories"
      :active-category="selectedCategory"
      @select-category="handleSelectCategory"
    />

    <IndexListM
      v-if="device.isMobile"
      :products="filteredProducts"
    />
    <IndexList
      v-else
      :products="filteredProducts"
    />
    <AppTabbar />
  </div>
</template>
