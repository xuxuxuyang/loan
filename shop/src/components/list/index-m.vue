<script setup lang="ts">
import type { MallCategoryItem, MallCategoryKey, TeaProduct } from '~/composables/useTeaProducts'

defineProps<{
  products: TeaProduct[]
  categories: MallCategoryItem[]
  activeCategory: MallCategoryKey
}>()

const emit = defineEmits<{
  'select-category': [category: MallCategoryKey]
}>()

const route = useRoute()
const { smartNavigate } = useCustomRouting(route)
const { ensureRegistered } = useMallAuth()

async function handleBuy(item: TeaProduct) {
  const passed = await ensureRegistered()
  if (!passed) {
    return
  }
  await smartNavigate({
    path: '/order-create',
    query: {
      productId: String(item.id),
      productName: item.name,
    },
  })
}
</script>

<template>
  <section class="normal-font px-4 pb-5 pt-4">
    <div class="hero-card mb-4 rounded-2xl p-4 text-white">
      <p class="mb-1 text-[11px] tracking-[0.16em] uppercase text-white/80">
        Product Zone
      </p>
      <h2 class="mb-1 text-xl font-semibold">
        全部商品
      </h2>
      <p class="text-xs text-white/85">
        今日上新 3 款，支持礼盒定制
      </p>
    </div>

    <div class="mb-4 flex gap-2 overflow-x-auto pb-1">
      <button
        v-for="item in categories"
        :key="item.key"
        type="button"
        class="shrink-0 rounded-full border px-3 py-1.5 text-xs transition"
        :class="activeCategory === item.key ? 'category-active border-[#f07b98] bg-gradient-to-r from-[#ff8ea5] to-[#ff7bb0] text-white shadow-[0_6px_14px_rgba(237,116,152,0.35)]' : 'border-[#e9d7df] bg-white text-[#5a6072]'"
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
        @click="handleBuy(item)"
        @keydown.enter.prevent="handleBuy(item)"
      >
        <img
          :src="item.image"
          :alt="item.name"
          class="h-20 w-20 shrink-0 rounded-lg object-cover pointer-events-none"
        >
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
              购买
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
