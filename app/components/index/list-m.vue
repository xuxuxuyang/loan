<script setup lang="ts">
import type { TeaProduct } from '~/composables/useTeaProducts'

defineProps<{
  products: TeaProduct[]
}>()

const route = useRoute()
const { smartNavigate } = useCustomRouting(route)
const { ensureRegistered } = useMallAuth()

async function handleBuy(productId: number) {
  const passed = await ensureRegistered()
  if (!passed) {
    return
  }
  await smartNavigate({
    path: '/order-create',
    query: { productId: String(productId) },
  })
}
</script>

<template>
  <section class="normal-font px-4 pb-5 pt-4">
    <div class="mb-4 text-center">
      <h3 class="text-2xl font-semibold text-black/85">
        推荐
      </h3>
      <div class="mx-auto mt-1 h-1 w-16 rounded-full bg-[#79d2c7]" />
    </div>

    <div class="grid grid-cols-2 gap-3">
      <article
        v-for="item in products"
        :key="item.id"
        class="overflow-hidden rounded-xl border border-black/10 bg-white"
      >
        <img
          :src="item.image"
          :alt="item.name"
          class="h-28 w-full object-cover"
        >
        <div class="p-3">
          <h4 class="line-clamp-1 text-sm font-semibold">
            {{ item.name }}
          </h4>
          <p class="mb-2 line-clamp-1 text-xs text-black/60">
            {{ item.subtitle }}
          </p>
          <div class="flex items-center justify-between">
            <span class="text-sm font-semibold leading-5 text-[var(--theme-color)]">￥{{ item.price }}</span>
            <button
              type="button"
              class="rounded-md bg-[var(--theme-color)] px-2.5 py-1 text-xs text-white"
              @click="handleBuy(item.id)"
            >
              购买
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

section :is(p, span, button, h3, h4) {
  font-family: "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
  line-height: 1.3;
}
</style>
