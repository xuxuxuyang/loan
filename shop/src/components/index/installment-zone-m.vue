<script setup lang="ts">
import type { TeaProduct } from '~/composables/useTeaProducts'
import {
  computeMallCreditOrderPrincipal,
  resolveMallCreditQuota,
} from '~/composables/mallCreditQuota'

const props = defineProps<{
  products: TeaProduct[]
}>()

/** 按订单金额（展示价 price）升序 */
const sortedProducts = computed(() => {
  const list = props.products ?? []
  return [...list].sort((a, b) => {
    const pa = Number(a.price)
    const pb = Number(b.price)
    const na = Number.isFinite(pa) ? pa : 0
    const nb = Number.isFinite(pb) ? pb : 0
    return na - nb
  })
})

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
  <section class="normal-font px-4 pb-6 pt-4">
    <div class="mb-5 text-center">
      <h3 class="text-xl font-semibold text-black/85">
        先享后付
      </h3>
      <div class="mx-auto mt-2 h-1 w-14 rounded-full bg-gradient-to-r from-[#ff8fb3] to-[#ff6e92]" />
    </div>

    <div
      v-if="sortedProducts.length === 0"
      class="rounded-xl border border-dashed border-black/12 bg-white/90 px-4 py-8 text-center text-xs text-black/45"
    >
      暂无商品
    </div>

    <div
      v-else
      class="grid grid-cols-2 gap-3"
    >
      <article
        v-for="item in sortedProducts"
        :key="item.id"
        :tabindex="isOverCredit(item) ? -1 : 0"
        :class="[
          'overflow-hidden rounded-xl border border-black/10 bg-white transition',
          isOverCredit(item) ? 'cursor-not-allowed opacity-80' : 'cursor-pointer active:scale-[0.99]',
        ]"
        role="button"
        @click="handleBuy(item)"
        @keydown.enter.prevent="handleBuy(item)"
      >
        <img
          :src="item.image"
          :alt="item.name"
          class="pointer-events-none h-28 w-full object-cover"
          loading="lazy"
          decoding="async"
          referrerpolicy="no-referrer"
          @error="onMallProductImageError($event, item.name)"
        >
        <div class="p-3">
          <h4 class="line-clamp-2 text-sm font-semibold leading-snug">
            {{ item.name }}
          </h4>
          <p class="mb-2 line-clamp-1 text-xs text-black/55">
            {{ item.subtitle }}
          </p>
          <div class="flex items-center justify-between gap-1">
            <span class="text-sm font-semibold text-[var(--theme-color)]">￥{{ item.price }}</span>
            <span
              :class="[
                'shrink-0 rounded-md px-2 py-1 text-[11px] font-medium pointer-events-none',
                isOverCredit(item)
                  ? 'bg-black/12 text-black/40'
                  : 'bg-gradient-to-r from-[#ff7b87] to-[#f06b81] text-white',
              ]"
              aria-hidden="true"
            >
              先享后付
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
</style>
