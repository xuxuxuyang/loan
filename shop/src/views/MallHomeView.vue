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
  useTeaProducts,
  ensureShopHomeProductsLoaded,
} from '~/composables/useTeaProducts'

const device = useDevice()
const route = useRoute()
const installmentProducts = useTeaProducts()
const mallProducts = useMallShowcaseProducts()
const categories = useMallCategories().filter(item => item.key !== 'all')
const selectedCategory = ref<MallCategoryKey>('phones')
/** 首页默认展示先享后付；点「商城专区」再切商城数据 */
const activeHomeZone = ref<'installment' | 'mall'>('installment')

if (typeof route.query.category === 'string' && isMallCategoryKey(route.query.category) && route.query.category !== 'all') {
  selectedCategory.value = route.query.category
}

if (!import.meta.env.SSR) {
  void ensureShopHomeProductsLoaded()
}

const homeProductList = computed(() =>
  activeHomeZone.value === 'mall' ? mallProducts.value : installmentProducts.value,
)

/** 先享后付展示全部先享后付商品；商城专区按分类筛选 */
const filteredHomeProducts = computed(() => {
  const list = homeProductList.value
  if (activeHomeZone.value === 'installment') {
    return list
  }
  return list.filter(item => item.category === selectedCategory.value)
})

watch(
  [mallProducts, activeHomeZone],
  () => {
    if (activeHomeZone.value !== 'mall') {
      return
    }
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

function handleSelectZone(zone: 'installment' | 'mall') {
  activeHomeZone.value = zone
}
</script>

<template>
  <div
    class="bg-[#f7f7f5] min-h-screen"
    style="padding-bottom: calc(4rem + env(safe-area-inset-bottom));"
  >
    <IndexBannerM
      v-if="device.isMobile"
      :preview-products="filteredHomeProducts"
      :categories="categories"
      :active-category="selectedCategory"
      :home-product-zone="activeHomeZone"
      @select-category="handleSelectCategory"
      @select-zone="handleSelectZone"
    />
    <IndexBanner
      v-else
      :preview-products="filteredHomeProducts"
      :categories="categories"
      :active-category="selectedCategory"
      :home-product-zone="activeHomeZone"
      @select-category="handleSelectCategory"
      @select-zone="handleSelectZone"
    />

    <section id="mall-showcase">
      <IndexListM
        v-if="device.isMobile"
        :products="filteredHomeProducts"
        :list-zone="activeHomeZone"
      />
      <IndexList
        v-else
        :products="filteredHomeProducts"
        :list-zone="activeHomeZone"
      />
    </section>
    <AppTabbar />
  </div>
</template>
