<script setup lang="ts">
import type { TeaProduct } from '~/composables/useTeaProducts'

defineProps<{
  products: TeaProduct[]
}>()

const categories = ['全部', '绿茶', '乌龙', '白茶', '普洱']

const { ensureRegistered } = useMallAuth()

async function handleCart(productName: string) {
  const passed = await ensureRegistered()
  if (!passed) {
    return
  }
  ElMessage.success(`已加购：${productName}`)
}
</script>

<template>
  <section class="normal-font px-4 pb-5 pt-4">
    <div class="mb-4 rounded-2xl bg-gradient-to-r from-[#0e5c4f] to-[#158072] p-4 text-white">
      <p class="mb-1 text-[11px] tracking-[0.16em] uppercase text-emerald-100">
        Product Zone
      </p>
      <h2 class="mb-1 text-xl font-semibold">
        全部商品
      </h2>
      <p class="text-xs text-white/80">
        今日上新 3 款，支持礼盒定制
      </p>
    </div>

    <div class="mb-4 flex gap-2 overflow-x-auto pb-1">
      <button
        v-for="(item, index) in categories"
        :key="item"
        type="button"
        class="shrink-0 rounded-full border px-3 py-1.5 text-xs"
        :class="index === 0 ? 'border-[var(--theme-color)] bg-[var(--theme-color)] text-white' : 'border-black/10 bg-white text-black/70'"
      >
        {{ item }}
      </button>
    </div>

    <div class="space-y-3">
      <article
        v-for="item in products"
        :key="item.id"
        class="flex gap-3 rounded-xl border border-black/10 bg-white p-3"
      >
        <img
          :src="item.image"
          :alt="item.name"
          class="h-20 w-20 rounded-lg object-cover"
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
            <span class="text-base font-semibold leading-5 text-[var(--theme-color)]">￥{{ item.price }}</span>
            <button
              type="button"
              class="rounded-md bg-[var(--theme-color)] px-2.5 py-1 text-xs text-white"
              @click="handleCart(item.name)"
            >
              加购
            </button>
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

section :is(p, span, button, h2, h3) {
  font-family: "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
  line-height: 1.3;
}
</style>
