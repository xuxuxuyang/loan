<script setup lang="ts">
import AppTabbar from '~/components/App/AppTabbar.vue'
import MallProductDetailGallery from '~/components/mall/MallProductDetailGallery.vue'
import {
  computeMallCreditOrderPrincipal,
  resolveMallCreditQuota,
} from '~/composables/mallCreditQuota'
import type { TeaProduct } from '~/composables/useTeaProducts'
import {
  normalizeApiProduct,
  useMallShowcaseProducts,
  useTeaProducts,
} from '~/composables/useTeaProducts'
import { notifyWarning } from '~/utils/epFeedback'

const route = useRoute()
const { smartNavigate } = useCustomRouting(route)
const runtimeConfig = useRuntimeConfig()
const { ensureRegistered, profile, syncFromStorage } = useMallAuth()

const product = ref<TeaProduct | null>(null)
const loadError = ref(false)
const loading = ref(true)

const installmentProducts = useTeaProducts({ immediate: false })
const mallProducts = useMallShowcaseProducts({ immediate: false })

const creditQuota = computed(() => resolveMallCreditQuota(profile.value))

const exceedsCredit = computed(() => {
  if (!product.value) {
    return false
  }
  return computeMallCreditOrderPrincipal(product.value.price, 1) > creditQuota.value
})

const galleryUrls = computed(() => {
  const p = product.value
  if (!p) {
    return []
  }
  const out: string[] = []
  const main = String(p.image || '').trim()
  if (main) {
    out.push(main)
  }
  for (const u of p.detailImages ?? []) {
    const s = String(u || '').trim()
    if (s && !out.includes(s)) {
      out.push(s)
    }
  }
  return out
})

const detailOnlyImages = computed(() => {
  const p = product.value
  if (!p) {
    return []
  }
  const main = String(p.image || '').trim()
  return (p.detailImages ?? [])
    .map(u => String(u || '').trim())
    .filter(Boolean)
    .filter(u => u !== main)
})

const isBnpl = computed(() => product.value?.salesMode === 'installment')

async function resolveProduct(id: number) {
  loadError.value = false
  loading.value = true
  product.value = null
  const hit = [...mallProducts.value, ...installmentProducts.value].find(p => p.id === id)
  if (hit) {
    product.value = hit
    loading.value = false
    return
  }
  const base = String(runtimeConfig.public.mallApiBase || '/api').replace(/\/$/, '')
  try {
    const res = await $fetch<{ success: boolean, data: Record<string, unknown> }>(`${base}/products/${id}`)
    if (res?.success && res.data) {
      product.value = normalizeApiProduct(res.data as Partial<TeaProduct>)
    }
    else {
      loadError.value = true
    }
  }
  catch {
    loadError.value = true
  }
  finally {
    loading.value = false
  }
}

watch(
  () => route.params.id,
  (id) => {
    const n = Number.parseInt(String(id), 10)
    if (!id || Number.isNaN(n) || n <= 0) {
      loadError.value = true
      loading.value = false
      return
    }
    void resolveProduct(n)
  },
  { immediate: true },
)

async function goBuy() {
  if (!product.value) {
    return
  }
  const passed = await ensureRegistered()
  if (!passed) {
    return
  }
  if (isBnpl.value && exceedsCredit.value) {
    notifyWarning(
      `该商品金额（￥${computeMallCreditOrderPrincipal(product.value.price, 1).toFixed(2)}）已超过您的授信额度（￥${creditQuota.value}）`,
    )
    return
  }
  await smartNavigate({
    path: '/order-create',
    query: { productId: String(product.value.id), productName: product.value.name },
  })
}

function goBack() {
  if (typeof window !== 'undefined' && window.history.length > 1) {
    window.history.back()
    return
  }
  void smartNavigate({ path: isBnpl.value ? '/installment' : '/list' })
}

if (!import.meta.env.SSR) {
  void syncFromStorage()
}
</script>

<template>
  <div
    class="normal-font min-h-screen bg-[#f3f4f8] pb-[calc(8rem+env(safe-area-inset-bottom))]"
  >
    <header
      class="sticky top-0 z-20 flex items-center gap-2 border-b border-black/6 bg-[#f3f4f8]/95 px-3 pb-2.5 backdrop-blur supports-[backdrop-filter]:bg-[#f3f4f8]/80"
      style="padding-top: max(0.625rem, env(safe-area-inset-top));"
    >
      <button
        type="button"
        class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-black/70 active:bg-black/6"
        aria-label="返回"
        @click="goBack"
      >
        <Icon
          name="tabler:chevron-left"
          size="1.15rem"
        />
      </button>
      <h1 class="min-w-0 flex-1 truncate text-center text-sm font-semibold text-black/82">
        商品详情
      </h1>
      <span class="w-9 shrink-0" />
    </header>

    <template v-if="loading">
      <div class="mx-4 mt-8 rounded-2xl bg-white p-8 text-center text-sm text-black/50 shadow-[0_8px_18px_rgba(24,39,75,0.05)]">
        加载中…
      </div>
    </template>

    <template v-else-if="loadError || !product">
      <div class="mx-4 mt-6 rounded-2xl border border-dashed border-black/12 bg-white p-8 text-center shadow-[0_8px_18px_rgba(24,39,75,0.05)]">
        <p class="text-sm text-black/65 leading-relaxed">
          未找到该商品，或商品已下架。
        </p>
        <button
          type="button"
          class="mt-4 rounded-full bg-[var(--theme-color)] px-5 py-2 text-sm font-medium text-white active:opacity-90"
          @click="goBack"
        >
          返回
        </button>
      </div>
    </template>

    <template v-else>
      <MallProductDetailGallery
        :urls="galleryUrls"
        :alt-base="product.name"
      />

      <div class="mx-3 mt-3 space-y-3">
        <section class="rounded-2xl bg-white p-4 shadow-[0_8px_18px_rgba(24,39,75,0.05)]">
          <h2 class="text-base font-semibold leading-snug text-black/88">
            {{ product.name }}
          </h2>
          <p
            v-if="product.subtitle"
            class="mt-1.5 text-sm text-black/55"
          >
            {{ product.subtitle }}
          </p>
          <div class="mt-3 flex flex-wrap items-center gap-2">
            <span class="text-xl font-semibold tabular-nums text-[#e35f82]">￥{{ product.price }}</span>
            <span
              v-if="isBnpl"
              class="wv-gradient-mall-h shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium"
            >
              先享后付
            </span>
          </div>
        </section>

        <section class="rounded-2xl bg-white p-4 shadow-[0_8px_18px_rgba(24,39,75,0.05)]">
          <h3 class="mb-2 text-sm font-semibold text-black/82">
            规格与发货
          </h3>
          <p class="text-sm text-black/60">
            发货地：{{ product.origin }}
          </p>
        </section>

        <section
          v-if="product.description?.trim() || detailOnlyImages.length"
          class="rounded-2xl bg-white p-4 shadow-[0_8px_18px_rgba(24,39,75,0.05)]"
        >
          <h3 class="mb-2 text-sm font-semibold text-black/82">
            商品详情
          </h3>
          <p
            v-if="product.description?.trim()"
            class="whitespace-pre-wrap text-sm leading-relaxed text-black/68"
          >
            {{ product.description }}
          </p>
          <div
            v-if="detailOnlyImages.length"
            class="mt-3 space-y-2"
          >
            <img
              v-for="(url, i) in detailOnlyImages"
              :key="`detail-${i}-${url.slice(0, 40)}`"
              :src="url"
              :alt="`${product.name} 详情图 ${i + 1}`"
              class="w-full rounded-xl bg-[#f6f8fb] object-contain p-3"
              loading="lazy"
              decoding="async"
              @error="onMallProductImageError($event, product.name)"
            >
          </div>
        </section>
      </div>
    </template>

    <div
      v-if="product"
      class="fixed bottom-16 left-0 right-0 z-[1210] border-t border-black/8 bg-white/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-white/90"
      style="padding-bottom: calc(0.75rem + env(safe-area-inset-bottom));"
    >
      <div class="mx-auto flex max-w-[980px] items-center gap-3">
        <div class="min-w-0 flex-1">
          <p class="text-xs text-black/50">
            合计
          </p>
          <p class="text-lg font-semibold tabular-nums text-[#e35f82]">
            ￥{{ Number(product.price).toFixed(2) }}
          </p>
        </div>
        <button
          type="button"
          class="min-h-[44px] shrink-0 rounded-xl bg-[var(--theme-color)] px-6 text-sm font-semibold text-white shadow-sm active:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="isBnpl && exceedsCredit"
          @click="goBuy"
        >
          {{ isBnpl ? '提交订单' : '立即购买' }}
        </button>
      </div>
    </div>

    <AppTabbar />
  </div>
</template>

<style scoped>
.normal-font {
  font-family: "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
}
</style>
