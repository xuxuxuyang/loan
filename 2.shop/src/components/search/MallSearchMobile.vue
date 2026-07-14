<script setup lang="ts">
import type { TeaProduct } from '~/composables/useTeaProducts'
import {
  ensureShopHomeProductsLoaded,
  useMallShowcaseProducts,
  useTeaProducts,
} from '~/composables/useTeaProducts'

const route = useRoute()
const router = useRouter()
const { smartNavigate } = useCustomRouting(route)

const installmentProducts = useTeaProducts({ immediate: false })
const mallProducts = useMallShowcaseProducts({ immediate: false })

const keyword = ref('')
const loading = ref(true)
const catalogLoaded = ref(false)

const catalog = computed(() => {
  const map = new Map<number, TeaProduct>()
  for (const p of installmentProducts.value) {
    map.set(p.id, p)
  }
  for (const p of mallProducts.value) {
    map.set(p.id, p)
  }
  return [...map.values()]
})

const trimmedKeyword = computed(() => keyword.value.trim())

const searchResults = computed(() => {
  const k = trimmedKeyword.value
  if (!k) {
    return []
  }
  const lower = k.toLowerCase()
  return catalog.value.filter((p) => {
    const blob = [p.name, p.subtitle, p.description, p.origin].join(' ').toLowerCase()
    return blob.includes(lower)
  })
})

const hasSearched = computed(() => trimmedKeyword.value.length > 0 && catalogLoaded.value)

function readQueryToKeyword() {
  const q = route.query.q
  keyword.value = typeof q === 'string' ? q : ''
}

async function loadCatalog() {
  if (catalogLoaded.value) {
    loading.value = false
    return
  }
  loading.value = true
  try {
    await ensureShopHomeProductsLoaded()
    catalogLoaded.value = true
  }
  finally {
    loading.value = false
  }
}

function syncQueryUrl() {
  const q = trimmedKeyword.value
  void router.replace({ path: '/search', query: q ? { q } : {} })
}

async function onSubmitSearch() {
  syncQueryUrl()
  if (trimmedKeyword.value) {
    await loadCatalog()
  }
}

function goBack() {
  if (typeof window !== 'undefined' && window.history.length > 1) {
    window.history.back()
    return
  }
  void smartNavigate('/')
}

async function openProductDetail(item: TeaProduct) {
  await smartNavigate({ path: `/product/${item.id}` })
}

watch(
  () => route.query.q,
  () => {
    readQueryToKeyword()
    if (trimmedKeyword.value) {
      void loadCatalog()
    }
  },
)

onMounted(async () => {
  readQueryToKeyword()
  if (trimmedKeyword.value) {
    await loadCatalog()
  }
  else {
    loading.value = false
  }
  await nextTick()
  const input = document.querySelector<HTMLInputElement>('[data-mall-search-input]')
  input?.focus()
})
</script>

<template>
  <div class="mall-search normal-font flex min-h-[100dvh] flex-col bg-[#e9f1f3]">
    <header
      class="search-header sticky top-0 z-20 shrink-0 px-3 pb-3 pt-[max(0.5rem,var(--app-safe-area-top))]"
    >
      <div class="mb-2 flex items-center gap-2">
        <button
          type="button"
          class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#2c3140]/75 active:bg-white/50"
          aria-label="返回"
          @click="goBack"
        >
          <Icon
            name="tabler:chevron-left"
            size="1.15rem"
          />
        </button>
        <form
          class="flex min-w-0 flex-1 items-center gap-2"
          @submit.prevent="onSubmitSearch"
        >
          <div class="search-pill flex min-w-0 flex-1 items-center rounded-full px-3 py-2">
            <Icon
              name="tabler:search"
              size="1rem"
              class="mr-2 shrink-0 text-[#607189]"
            />
            <input
              v-model="keyword"
              data-mall-search-input
              type="search"
              enterkeyhint="search"
              autocomplete="off"
              class="search-input min-w-0 flex-1 bg-transparent text-sm text-[#2c3140] outline-none placeholder:text-[#607189]/65"
              placeholder="一站式购手机数码家电美妆"
              maxlength="80"
            >
          </div>
          <button
            type="submit"
            class="search-submit shrink-0 rounded-full px-3 py-2 text-sm font-semibold text-white active:opacity-90"
          >
            搜索
          </button>
        </form>
      </div>
    </header>

    <main class="flex-1 px-3 pb-[max(1rem,var(--app-safe-area-bottom))]">
      <div
        v-if="loading"
        class="mx-auto mt-10 max-w-md rounded-2xl bg-white/90 px-6 py-10 text-center text-sm text-[#5a6072] shadow-sm"
      >
        商品加载中…
      </div>

      <template v-else>
        <div
          v-if="!hasSearched"
          class="mx-auto mt-8 max-w-md rounded-2xl border border-dashed border-[#b8cce8]/45 bg-white/85 px-5 py-10 text-center shadow-sm"
        >
          <Icon
            name="tabler:shopping-search"
            class="mx-auto mb-3 text-[#8ea8ff]"
            size="2.25rem"
          />
          <p class="text-sm font-medium text-[#2c3140]/85">
            输入商品名称或关键词
          </p>
          <p class="mt-2 text-xs leading-relaxed text-[#5a6072]/85">
            将搜索先享后付与商城专区的全部商品，找到心仪好物。
          </p>
        </div>

        <div
          v-else-if="searchResults.length === 0"
          class="mx-auto mt-8 max-w-md rounded-2xl border border-dashed border-[#e8cad3]/45 bg-white/95 px-5 py-10 text-center shadow-sm"
        >
          <Icon
            name="tabler:mood-empty"
            class="mx-auto mb-3 text-[#e06f8d]/75"
            size="2.25rem"
          />
          <p class="text-sm font-medium text-[#2c3140]/88">
            未搜索到相关商品
          </p>
          <p class="mt-2 text-xs leading-relaxed text-[#5a6072]/85">
            没有找到与「{{ trimmedKeyword }}」匹配的商品，请试试其他关键词或检查输入是否正确。
          </p>
        </div>

        <div
          v-else
          class="space-y-3 pb-4"
        >
          <p class="px-1 text-xs text-[#5a6072]">
            共 {{ searchResults.length }} 件相关商品
          </p>
          <article
            v-for="item in searchResults"
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
              <div class="mb-1 flex flex-wrap items-center gap-1.5">
                <h3 class="line-clamp-2 text-sm font-semibold text-[#2c3140]">
                  {{ item.name }}
                </h3>
                <span
                  v-if="item.salesMode === 'installment'"
                  class="wv-gradient-mall-h shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium"
                >先享后付</span>
                <span
                  v-else
                  class="wv-gradient-mall shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium"
                >商城</span>
              </div>
              <p class="line-clamp-1 text-xs text-black/55">
                {{ item.subtitle }}
              </p>
              <p class="mb-2 line-clamp-1 text-xs text-black/45">
                发货：{{ item.origin }}
              </p>
              <div class="flex items-center justify-between">
                <span class="text-base font-semibold leading-5 text-[#df5b80]">￥{{ item.price }}</span>
                <span
                  class="buy-btn rounded-md px-2.5 py-1 text-xs text-white pointer-events-none"
                  aria-hidden="true"
                >查看</span>
              </div>
            </div>
          </article>
        </div>
      </template>
    </main>
  </div>
</template>

<style scoped>
.normal-font {
  font-family: "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
}

.search-header {
  background: linear-gradient(180deg, #e9f1f3 0%, #e9f1f3ee 100%);
  border-bottom: 1px solid rgba(128, 182, 255, 0.12);
}

.search-pill {
  background: linear-gradient(120deg, #ffffff, #f5faff);
  border: 1px solid rgba(128, 182, 255, 0.22);
  box-shadow: 0 6px 14px rgba(118, 148, 214, 0.1);
}

.search-input {
  -webkit-appearance: none;
  appearance: none;
}

.search-input::-webkit-search-cancel-button {
  -webkit-appearance: none;
  appearance: none;
}

.search-submit {
  background: linear-gradient(135deg, #ff8fb3, #ff6e92);
  box-shadow: 0 6px 14px rgba(229, 120, 150, 0.28);
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

.mall-search :is(p, span, button, h3, input) {
  font-family: "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
  line-height: 1.3;
}
</style>
