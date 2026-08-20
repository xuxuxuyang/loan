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
  ensureMallShowcaseProductsLoaded,
} from '~/composables/useTeaProducts'
import { isIosBnplReviewHidden } from '~/utils/iosBnplReviewVisibility'

const route = useRoute()
const hideIosBnplForReview = isIosBnplReviewHidden()
const installmentProducts = useTeaProducts({ immediate: !hideIosBnplForReview })
const mallProducts = useMallShowcaseProducts({ immediate: false })
/** 首页分类条仅展示商城品类；「先享后付」由顶部分区切换，避免与 installment 商品维度混淆 */
const categories = useMallCategories().filter(item => item.key !== 'all' && item.key !== 'installment')
const selectedCategory = ref<MallCategoryKey>('phones')
/** App Store 审核期原生 iOS 默认固定到商城专区，H5/Android 保持原默认分区。 */
const activeHomeZone = ref<'installment' | 'mall'>(hideIosBnplForReview ? 'mall' : 'installment')

if (typeof route.query.category === 'string' && isMallCategoryKey(route.query.category)) {
  if (route.query.category === 'installment' && !hideIosBnplForReview) {
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

watch(
  activeHomeZone,
  (zone) => {
    if (zone === 'mall') {
      void ensureMallShowcaseProductsLoaded()
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
  if (hideIosBnplForReview && zone === 'installment') {
    return
  }
  activeHomeZone.value = zone
  if (zone === 'mall') {
    void ensureMallShowcaseProductsLoaded()
  }
}
</script>

<template>
  <div
    class="bg-[#f7f7f5] min-h-screen"
    style="padding-bottom: calc(4rem + var(--app-safe-area-bottom));"
  >
    <HomeBannerMobile
      :preview-products="filteredHomeProducts"
      :categories="categories"
      :active-category="selectedCategory"
      :home-product-zone="activeHomeZone"
      :hide-installment-zone="hideIosBnplForReview"
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
