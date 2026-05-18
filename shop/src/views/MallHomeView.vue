<script setup lang="ts">
import AppTabbar from '~/components/App/AppTabbar.vue'
import HomeBannerMobile from '~/components/index/HomeBannerMobile.vue'
import HomeListMobile from '~/components/index/HomeListMobile.vue'
import type { MallCategoryKey } from '~/composables/useTeaProducts'
import {
  useMallCategories,
  isMallCategoryKey,
  useMallShowcaseProducts,
  ensureShopHomeProductsLoaded,
} from '~/composables/useTeaProducts'

const route = useRoute()
const mallProducts = useMallShowcaseProducts()
const categories = useMallCategories().filter(item => item.key !== 'all')
const selectedCategory = ref<MallCategoryKey>('phones')

if (typeof route.query.category === 'string' && isMallCategoryKey(route.query.category) && route.query.category !== 'all') {
  selectedCategory.value = route.query.category
}

if (!import.meta.env.SSR) {
  void ensureShopHomeProductsLoaded()
}

const filteredHomeProducts = computed(() =>
  mallProducts.value.filter(item => item.category === selectedCategory.value),
)

watch(
  [mallProducts],
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
    <HomeBannerMobile
      :preview-products="filteredHomeProducts"
      :categories="categories"
      :active-category="selectedCategory"
      @select-category="handleSelectCategory"
    />

    <section id="mall-showcase">
      <HomeListMobile
        :products="filteredHomeProducts"
      />
    </section>
    <AppTabbar />
  </div>
</template>
