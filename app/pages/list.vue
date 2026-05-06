<script setup lang="ts">
import ListIndex from '~/components/list/index.vue'
import ListIndexM from '~/components/list/index-m.vue'
import type { MallCategoryKey } from '~/composables/useTeaProducts'

definePageMeta({
  layout: false,
})

const device = useDevice()
const products = useTeaProducts()
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
    <ListIndexM
      v-if="device.isMobile"
      :products="filteredProducts"
      :categories="categories"
      :active-category="selectedCategory"
      @select-category="handleSelectCategory"
    />
    <ListIndex
      v-else
      :products="filteredProducts"
      :categories="categories"
      :active-category="selectedCategory"
      @select-category="handleSelectCategory"
    />
    <AppTabbar />
  </div>
</template>
