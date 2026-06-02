<script setup lang="ts">
import AppBeianFooter from '~/components/App/AppBeianFooter.vue'
import AppTabbar from '~/components/App/AppTabbar.vue'
import HomeBannerMobile from '~/components/index/HomeBannerMobile.vue'
import HomeListMobile from '~/components/index/HomeListMobile.vue'
import type { MallCategoryKey } from '~/composables/useTeaProducts'
import {
  useMallCategories,
  isMallCategoryKey,
  useMallShowcaseProducts,
  useTeaProducts,
} from '~/composables/useTeaProducts'

const route = useRoute()
const installmentProducts = useTeaProducts()
const mallProducts = useMallShowcaseProducts()
/** 首页分类条仅展示商城品类；「先享后付」由顶部分区切换，避免与 installment 商品维度混淆 */
const categories = useMallCategories().filter(item => item.key !== 'all' && item.key !== 'installment')
const selectedCategory = ref<MallCategoryKey>('phones')
/** 首页默认展示先享后付；点「商城专区」再切商城数据 */
const activeHomeZone = ref<'installment' | 'mall'>('installment')

if (typeof route.query.category === 'string' && isMallCategoryKey(route.query.category)) {
  if (route.query.category === 'installment') {
    activeHomeZone.value = 'installment'
  }
  else if (route.query.category !== 'all') {
    activeHomeZone.value = 'mall'
    selectedCategory.value = route.query.category
  }
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
    if (first) {
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
    <HomeBannerMobile
      :preview-products="filteredHomeProducts"
      :categories="categories"
      :active-category="selectedCategory"
      :home-product-zone="activeHomeZone"
      @select-category="handleSelectCategory"
      @select-zone="handleSelectZone"
    />

    <section id="mall-showcase">
      <HomeListMobile
        :products="filteredHomeProducts"
        :list-zone="activeHomeZone"
      />
    </section>

    <AppBeianFooter />
    <AppTabbar />
  </div>
</template>
