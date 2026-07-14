<script setup lang="ts">
import type { MallCategoryItem, MallCategoryKey, TeaProduct } from '~/composables/useTeaProducts'

const props = defineProps<{
  products: TeaProduct[]
  categories: MallCategoryItem[]
  activeCategory: MallCategoryKey
}>()

const emit = defineEmits<{
  'select-category': [category: MallCategoryKey]
}>()

const banner = computed(() => {
  const row = props.categories.find(c => c.key === props.activeCategory)
  if (row) {
    return { title: row.heroTitle, subtitle: row.heroSubtitle }
  }
  return {
    title: '商城精选',
    subtitle: '好物汇聚 · 正品速达',
  }
})

/** 全部商品里混合展示两类商品时，CTA 按商品自身 salesMode 显示。 */
function productCtaLabel(item: TeaProduct) {
  return item.salesMode === 'installment' ? '先享后付' : '购买'
}

const route = useRoute()
const { smartNavigate } = useCustomRouting(route)

async function openProductDetail(item: TeaProduct) {
  await smartNavigate({
    path: `/product/${item.id}`,
  })
}
</script>

<template>
  <section
    class="normal-font px-4 pb-5"
    style="padding-top: max(1rem, var(--app-safe-area-top));"
  >
    <div class="hero-card mb-4 rounded-2xl p-4 text-white">
      <p class="mb-1 text-[11px] tracking-[0.16em] uppercase text-white/80">
        Mall
      </p>
      <h2 class="hero-title mb-1 text-xl font-semibold transition-opacity duration-200">
        {{ banner.title }}
      </h2>
      <p class="hero-sub text-xs text-white/85 transition-opacity duration-200">
        {{ banner.subtitle }}
      </p>
    </div>

    <div
      class="category-scroll mb-4 flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none]"
      role="tablist"
      aria-label="商品分类"
    >
      <button
        v-for="item in categories"
        :key="item.key"
        type="button"
        role="tab"
        :aria-selected="activeCategory === item.key"
        class="shrink-0 snap-start rounded-full border px-3 py-1.5 text-xs transition"
        :class="activeCategory === item.key ? 'wv-gradient-category-active category-active shadow-[0_6px_14px_rgba(237,116,152,0.35)]' : 'border-[#e9d7df] bg-white text-[#5a6072]'"
        @click="emit('select-category', item.key)"
      >
        {{ item.name }}
      </button>
    </div>

    <div class="space-y-3">
      <article
        v-for="item in products"
        :key="item.id"
        role="button"
        tabindex="0"
        class="product-card flex gap-3 rounded-xl p-3 cursor-pointer transition active:scale-[0.99]"
        @click="openProductDetail(item)"
        @keydown.enter.prevent="openProductDetail(item)"
      >
        <div
          class="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg bg-[#f6f8fb]"
        >
          <img
            :src="item.image"
            :alt="item.name"
            class="max-h-full max-w-full rounded-lg object-contain p-1.5 pointer-events-none"
            loading="lazy"
            decoding="async"
            @error="onMallProductImageError($event, item.name)"
          >
        </div>
        <div class="min-w-0 flex-1">
          <h3 class="line-clamp-1 text-sm font-semibold">
            {{ item.name }}
          </h3>
          <p class="line-clamp-1 text-xs text-black/60">
            {{ item.subtitle }}
          </p>
          <p class="mb-2 line-clamp-1 text-xs text-black/50">
            产地：{{ item.origin }}
          </p>
          <div class="flex items-center justify-between">
            <span class="text-base font-semibold leading-5 text-[#df5b80]">￥{{ item.price }}</span>
            <span
              class="buy-btn rounded-md px-2.5 py-1 text-xs text-white pointer-events-none"
              aria-hidden="true"
            >
              {{ productCtaLabel(item) }}
            </span>
          </div>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.normal-font {
  font-family: "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
}

.hero-card {
  background: linear-gradient(135deg, #ff9eb1, #8ea8ff);
  box-shadow: 0 10px 22px rgba(145, 133, 222, 0.28);
}

.category-active {
  border-color: transparent;
}

.category-scroll {
  scroll-snap-type: x proximity;
}

.category-scroll::-webkit-scrollbar {
  display: none;
}

.product-card {
  border: 1px solid rgba(238, 194, 206, 0.55);
  background: linear-gradient(180deg, #fff, #fff8fb);
  box-shadow: 0 8px 16px rgba(214, 149, 172, 0.12);
}

.buy-btn {
  background: linear-gradient(135deg, #ff8fa1, #ff6f94);
  box-shadow: 0 6px 12px rgba(232, 112, 145, 0.25);
}

section :is(p, span, button, h2, h3) {
  font-family: "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
  line-height: 1.3;
}
</style>
