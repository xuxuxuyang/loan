<script setup lang="ts">
import AppTabbar from '~/components/App/AppTabbar.vue'
import MallListMobile from '~/components/list/MallListMobile.vue'
import type { MallCategoryKey } from '~/composables/useTeaProducts'
import { useMallCategories, isMallCategoryKey, useMallShowcaseProducts } from '~/composables/useTeaProducts'

const products = useMallShowcaseProducts()
const route = useRoute()
const categories = useMallCategories()
const selectedCategory = ref<MallCategoryKey>('all')

if (typeof route.query.category === 'string' && isMallCategoryKey(route.query.category)) {
  selectedCategory.value = route.query.category
}

const filteredProducts = computed(() => {
  if (selectedCategory.value === 'all') {
    return products.value
  }
  return products.value.filter(item => item.category === selectedCategory.value)
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
