<script setup lang="ts">
import AppTabbar from '~/components/App/AppTabbar.vue'
import MallListMobile from '~/components/list/MallListMobile.vue'
import type { MallCategoryKey } from '~/composables/useTeaProducts'
import {
  useMallCategories,
  isMallCategoryKey,
  useMallShowcaseProducts,
  useTeaProducts,
  ensureShopHomeProductsLoaded,
} from '~/composables/useTeaProducts'

const mallProducts = useMallShowcaseProducts()
const installmentProducts = useTeaProducts()
const route = useRoute()
const categories = useMallCategories()
const selectedCategory = ref<MallCategoryKey>('installment')

if (typeof route.query.category === 'string' && isMallCategoryKey(route.query.category)) {
  selectedCategory.value = route.query.category
}

if (!import.meta.env.SSR) {
  void ensureShopHomeProductsLoaded()
}

function sortByPriceAsc(a: { price: number, name: string, id: number }, b: { price: number, name: string, id: number }) {
  const d = a.price - b.price
  if (d !== 0) {
    return d
  }
  return String(a.name).localeCompare(String(b.name), 'zh-Hans-CN') || a.id - b.id
}

const filteredProducts = computed(() => {
  const mode = selectedCategory.value
  let list
  if (mode === 'installment') {
    list = installmentProducts.value
  }
  else if (mode === 'all') {
    list = mallProducts.value
  }
  else {
    list = mallProducts.value.filter(item => item.category === mode)
  }
  return [...list].sort(sortByPriceAsc)
})

function handleSelectCategory(category: MallCategoryKey) {
  selectedCategory.value = category
}
</script>

<template>
  <div class="min-h-screen pb-16">
    <MallListMobile
      :products="filteredProducts"
      :categories="categories"
      :active-category="selectedCategory"
      @select-category="handleSelectCategory"
    />
    <AppTabbar />
  </div>
</template>
