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

const promos = [
  { title: '新人福利', desc: '首单满 299 减 30', tag: 'NEW' },
  { title: '满赠专区', desc: '满两件享精选赠品', tag: 'GIFT' },
  { title: '限时折扣', desc: '今晚 20:00 爆款 88 折', tag: 'SALE' },
]

const route = useRoute()
const { smartNavigate } = useCustomRouting(route)
const { ensureRegistered } = useMallAuth()

async function handleCart(productName: string) {
  const passed = await ensureRegistered()
  if (!passed) {
    return
  }
  ElMessage.success(`已加入购物车：${productName}`)
}

async function openProductDetail(productId: number) {
  await smartNavigate({
    path: `/product/${productId}`,
  })
}
</script>

<template>
  <section class="normal-font app-wrapper bg-[#f6f2f7] py-6 md:py-8">
    <div class="app-content">
      <div class="hero-card mb-6 rounded-2xl p-5 text-white md:p-7">
        <p class="mb-2 text-xs tracking-[0.22em] uppercase text-white/80">
          Mall
        </p>
        <h2 class="mb-2 text-2xl font-semibold md:text-3xl">
          品质生活商城
        </h2>
        <p class="text-sm text-white/85">
          手机数码、家用电器与美妆个护精选，支持先享后付与在线下单。
        </p>
      </div>

      <div class="mb-6 grid gap-3 md:grid-cols-3">
        <article
          v-for="item in promos"
          :key="item.title"
          class="promo-card rounded-xl p-4"
        >
          <p class="mb-1 text-xs font-semibold text-[#e7678f]">
            {{ item.tag }}
          </p>
          <h3 class="mb-1 text-base font-semibold">
            {{ item.title }}
          </h3>
          <p class="text-sm text-black/60">
            {{ item.desc }}
          </p>
        </article>
      </div>

      <div class="mb-5 flex flex-wrap gap-2">
        <button
          v-for="item in categories"
          :key="item.key"
          type="button"
          class="rounded-full border px-4 py-2 text-sm transition"
          :class="activeCategory === item.key ? 'category-active border-transparent bg-gradient-to-r from-[#ff8ea5] to-[#ff7bb0] text-white shadow-[0_8px_16px_rgba(236,117,151,0.35)]' : 'border-[#e9d7df] bg-white text-[#5a6072] hover:border-[#f19ab1] hover:text-[#d7658d]'"
          @click="emit('select-category', item.key)"
        >
          {{ item.name }}
        </button>
      </div>

      <div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <article
          v-for="item in products"
          :key="item.id"
          role="button"
          tabindex="0"
          class="product-card overflow-hidden rounded-2xl transition hover:-translate-y-1 cursor-pointer"
          @click="openProductDetail(item.id)"
          @keydown.enter.prevent="openProductDetail(item.id)"
        >
          <img
            :src="item.image"
            :alt="item.name"
            class="h-56 w-full object-cover pointer-events-none"
            loading="lazy"
            decoding="async"
            referrerpolicy="no-referrer"
            @error="onMallProductImageError($event, item.name)"
          >
          <div class="p-5">
            <div class="mb-2 flex items-center justify-between">
              <p class="text-xs text-black/50">
                产地：{{ item.origin }}
              </p>
              <span class="rounded-full bg-[#fef3e8] px-2 py-0.5 text-xs text-[#bf5a00]">
                精选
              </span>
            </div>
            <h4 class="mb-1 text-lg font-semibold">
              {{ item.name }}
            </h4>
            <p class="mb-3 text-sm text-black/70">
              {{ item.subtitle }}
            </p>
            <p class="mb-4 min-h-10 line-clamp-2 text-sm text-black/60">
              {{ item.description }}
            </p>
            <div class="flex items-center justify-between">
              <span class="text-xl font-semibold leading-6 text-[#df5b80]">￥{{ item.price }}</span>
              <div class="flex items-center gap-2">
                <button
                  type="button"
                  class="rounded-lg border border-[#efcfdb] px-3 py-2 text-sm text-[#5f6474] hover:border-[#e88dad] hover:text-[#d85f89]"
                  @click.stop="handleCart(item.name)"
                >
                  加入购物车
                </button>
                <span
                  class="buy-btn rounded-lg px-4 py-2 text-sm text-white pointer-events-none"
                  aria-hidden="true"
                >
                  立即购买
                </span>
              </div>
            </div>
          </div>
        </article>
      </div>

      <div class="mt-8 rounded-xl border border-dashed border-black/15 bg-white p-5 text-sm text-black/60">
        已展示 {{ products.length }} 款商品，更多品类持续上架。
      </div>
    </div>
  </section>
</template>

<style scoped>
.normal-font {
  font-family: "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
}

.hero-card {
  background: linear-gradient(135deg, #ff9eb1, #8ea8ff);
  box-shadow: 0 12px 24px rgba(145, 133, 222, 0.25);
}

.promo-card {
  border: 1px solid rgba(236, 194, 206, 0.55);
  background: linear-gradient(180deg, #fff, #fff8fb);
  box-shadow: 0 8px 16px rgba(214, 149, 172, 0.12);
}

.category-active {
  border-color: transparent;
}

.product-card {
  border: 1px solid rgba(236, 194, 206, 0.55);
  background: linear-gradient(180deg, #fff, #fff8fb);
  box-shadow: 0 10px 18px rgba(214, 149, 172, 0.14);
}

.buy-btn {
  background: linear-gradient(135deg, #ff8fa1, #ff6f94);
  box-shadow: 0 8px 14px rgba(232, 112, 145, 0.26);
}

section :is(p, span, button, h2, h3, h4) {
  font-family: "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
  line-height: 1.3;
}
</style>
