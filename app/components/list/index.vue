<script setup lang="ts">
import type { TeaProduct } from '~/composables/useTeaProducts'

defineProps<{
  products: TeaProduct[]
}>()

const categories = ['全部', '绿茶', '乌龙茶', '白茶', '普洱', '礼盒']
const promos = [
  { title: '新人福利', desc: '首单满 299 减 30', tag: 'NEW' },
  { title: '满赠专区', desc: '购买两件赠茶具礼盒', tag: 'GIFT' },
  { title: '限时折扣', desc: '今晚 20:00 爆款 88 折', tag: 'SALE' },
]

const { ensureRegistered } = useMallAuth()

async function handleCart(productName: string) {
  const passed = await ensureRegistered()
  if (!passed) {
    return
  }
  ElMessage.success(`已加入购物车：${productName}`)
}

async function handleBuy(productName: string) {
  const passed = await ensureRegistered()
  if (!passed) {
    return
  }
  ElMessage.success(`下单成功：${productName}`)
}
</script>

<template>
  <section class="normal-font app-wrapper bg-[#f7f7f5] py-6 md:py-8">
    <div class="app-content">
      <div class="mb-6 rounded-2xl bg-gradient-to-r from-[#0e5c4f] to-[#158072] p-5 text-white md:p-7">
        <p class="mb-2 text-xs tracking-[0.22em] uppercase text-emerald-100">
          Tea Mall
        </p>
        <h2 class="mb-2 text-2xl font-semibold md:text-3xl">
          高端茶叶商城
        </h2>
        <p class="text-sm text-white/85">
          核心产区甄选，传统工艺监制，支持礼盒定制与企业采购。
        </p>
      </div>

      <div class="mb-6 grid gap-3 md:grid-cols-3">
        <article
          v-for="item in promos"
          :key="item.title"
          class="rounded-xl border border-black/10 bg-white p-4"
        >
          <p class="mb-1 text-xs font-semibold text-[var(--theme-color)]">
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
          v-for="(item, index) in categories"
          :key="item"
          type="button"
          class="rounded-full border px-4 py-2 text-sm transition"
          :class="index === 0 ? 'border-[var(--theme-color)] bg-[var(--theme-color)] text-white' : 'border-black/10 bg-white text-black/70 hover:border-[var(--theme-color)] hover:text-[var(--theme-color)]'"
        >
          {{ item }}
        </button>
      </div>

      <div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <article
          v-for="item in products"
          :key="item.id"
          class="overflow-hidden rounded-2xl border border-black/10 bg-white transition hover:-translate-y-1 hover:shadow-xl"
        >
          <img
            :src="item.image"
            :alt="item.name"
            class="h-56 w-full object-cover"
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
              <span class="text-xl font-semibold leading-6 text-[var(--theme-color)]">￥{{ item.price }}</span>
              <div class="flex items-center gap-2">
                <button
                  type="button"
                  class="rounded-lg border border-black/10 px-3 py-2 text-sm text-black/70 hover:border-[var(--theme-color)] hover:text-[var(--theme-color)]"
                  @click="handleCart(item.name)"
                >
                  加入购物车
                </button>
                <button
                  type="button"
                  class="rounded-lg bg-[var(--theme-color)] px-4 py-2 text-sm text-white hover:opacity-90"
                  @click="handleBuy(item.name)"
                >
                  立即购买
                </button>
              </div>
            </div>
          </div>
        </article>
      </div>

      <div class="mt-8 rounded-xl border border-dashed border-black/15 bg-white p-5 text-sm text-black/60">
        已展示 {{ products.length }} 款高端茶叶商品，更多新品将持续上架。
      </div>
    </div>
  </section>
</template>

<style scoped>
.normal-font {
  font-family: "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
}

section :is(p, span, button, h2, h3, h4) {
  font-family: "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
  line-height: 1.3;
}
</style>
