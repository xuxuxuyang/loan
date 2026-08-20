<script setup lang="ts">
import AppTabbar from '~/components/App/AppTabbar.vue'
import MallListMobile from '~/components/list/MallListMobile.vue'
import type { MallCategoryKey, TeaProduct } from '~/composables/useTeaProducts'
import {
  useMallCategories,
  isMallCategoryKey,
  useMallShowcaseProducts,
  useTeaProducts,
  ensureMallProductsLoaded,
  ensureMallShowcaseProductsLoaded,
  ensureShopHomeProductsLoaded,
} from '~/composables/useTeaProducts'
import { isIosBnplReviewHidden } from '~/utils/iosBnplReviewVisibility'

const hideIosBnplForReview = isIosBnplReviewHidden()
const mallProducts = useMallShowcaseProducts({ immediate: false })
const installmentProducts = useTeaProducts({ immediate: false })
const route = useRoute()
const categories = useMallCategories().filter(item => !hideIosBnplForReview || item.key !== 'installment')
const selectedCategory = ref<MallCategoryKey>(hideIosBnplForReview ? 'phones' : 'installment')

if (typeof route.query.category === 'string' && isMallCategoryKey(route.query.category)) {
  if (!hideIosBnplForReview || route.query.category !== 'installment') {
    selectedCategory.value = route.query.category
  }
}

async function ensureProductsForCategory(category: MallCategoryKey) {
  if (category === 'installment') {
    if (hideIosBnplForReview) {
      await ensureMallShowcaseProductsLoaded()
    }
    else {
      await ensureMallProductsLoaded()
    }
    return
  }
  if (category === 'all') {
    if (hideIosBnplForReview) {
      await ensureMallShowcaseProductsLoaded()
    }
    else {
      await ensureShopHomeProductsLoaded()
    }
    return
  }
  await ensureMallShowcaseProductsLoaded()
}

if (!import.meta.env.SSR) {
  watch(
    selectedCategory,
    (category) => {
      void ensureProductsForCategory(category)
    },
    { immediate: true },
  )
}

function sortByPriceAsc(a: { price: number, name: string, id: number }, b: { price: number, name: string, id: number }) {
  const d = a.price - b.price
  if (d !== 0) {
    return d
  }
  return String(a.name).localeCompare(String(b.name), 'zh-Hans-CN') || a.id - b.id
}

function sortedProducts(list: TeaProduct[]) {
  return [...list].sort(sortByPriceAsc)
}

const filteredProducts = computed(() => {
  const mode = selectedCategory.value
  if (mode === 'installment') {
    if (hideIosBnplForReview) {
      return []
    }
    return sortedProducts(installmentProducts.value)
  }
  if (mode === 'all') {
    if (hideIosBnplForReview) {
      return sortedProducts(mallProducts.value)
    }
    return [
      ...sortedProducts(installmentProducts.value),
      ...sortedProducts(mallProducts.value),
    ]
  }
  return sortedProducts(mallProducts.value.filter(item => item.category === mode))
})

function handleSelectCategory(category: MallCategoryKey) {
  if (hideIosBnplForReview && category === 'installment') {
    return
  }
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
