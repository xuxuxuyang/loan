<script setup lang="ts">
import type { TeaProduct } from '~/composables/useTeaProducts'
import {
  computeMallCreditOrderPrincipal,
  resolveMallCreditQuota,
} from '~/composables/mallCreditQuota'

defineProps<{
  products: TeaProduct[]
}>()

const { smartNavigate } = useCustomRouting(useRoute())
const { ensureRegistered, profile, syncFromStorage } = useMallAuth()

const creditQuota = computed(() => resolveMallCreditQuota(profile.value))

function isOverCredit(item: TeaProduct) {
  return computeMallCreditOrderPrincipal(item.price, 1) > creditQuota.value
}

async function handleBuy(item: TeaProduct) {
  if (isOverCredit(item)) {
    ElMessage.warning(
      `该商品金额（￥${computeMallCreditOrderPrincipal(item.price, 1).toFixed(2)}）已超过您的授信额度（￥${creditQuota.value}）`,
    )
    return
  }
  const passed = await ensureRegistered()
  if (!passed) {
    return
  }
  await smartNavigate({
    path: '/order-create',
    query: { productId: String(item.id), productName: item.name },
  })
}

if (!import.meta.env.SSR) {
  void syncFromStorage()
}
</script>

<template>
  <section class="app-wrapper bg-[#f0f5f4] pb-10 pt-4 md:pb-14 md:pt-6">
    <div class="app-content">
      <div class="mb-8 text-center md:mb-10 md:text-left">
        <h3 class="text-2xl font-semibold text-[#2c3140] md:inline-block">
          先享后付
        </h3>
        <div class="mx-auto mt-3 h-1 w-16 rounded-full bg-gradient-to-r from-[#ff8fb3] to-[#ff6e92] md:mx-0" />
      </div>

      <div
        v-if="products.length === 0"
        class="rounded-2xl border border-dashed border-black/15 bg-white/80 px-6 py-10 text-center text-sm text-black/50"
      >
        暂无商品，请稍后再试。
      </div>

      <div
        v-else
        class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3"
      >
        <article
          v-for="item in products"
          :key="item.id"
          :tabindex="isOverCredit(item) ? -1 : 0"
          :class="[
            'overflow-hidden rounded-2xl border border-black/10 bg-white transition',
            isOverCredit(item) ? 'cursor-not-allowed opacity-80' : 'cursor-pointer hover:-translate-y-1 hover:shadow-xl',
          ]"
          role="button"
          @click="handleBuy(item)"
          @keydown.enter.prevent="handleBuy(item)"
        >
          <img
            :src="item.image"
            :alt="item.name"
            class="pointer-events-none h-56 w-full object-cover"
          >
          <div class="p-5">
            <p class="mb-2 text-xs text-black/50">
              产地：{{ item.origin }}
            </p>
            <h4 class="mb-1 text-lg font-semibold">
              {{ item.name }}
            </h4>
            <p class="mb-3 text-sm text-black/70">
              {{ item.subtitle }}
            </p>
            <p class="mb-4 line-clamp-2 min-h-10 text-sm text-black/60">
              {{ item.description }}
            </p>
            <div class="flex items-center justify-between">
              <span class="text-xl font-semibold text-[var(--theme-color)]">￥{{ item.price }}</span>
              <span
                :class="[
                  'rounded-lg px-4 py-2 text-sm font-medium shadow-sm pointer-events-none',
                  isOverCredit(item)
                    ? 'bg-black/12 text-black/40'
                    : 'bg-gradient-to-r from-[#ff7b87] to-[#e84d7a] text-white',
                ]"
                aria-hidden="true"
              >
                先享后付
              </span>
            </div>
          </div>
        </article>
      </div>
    </div>
  </section>
</template>
