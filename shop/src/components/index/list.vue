<script setup lang="ts">
import type { TeaProduct } from '~/composables/useTeaProducts'

const props = withDefaults(
  defineProps<{
    products: TeaProduct[]
    listZone?: 'installment' | 'mall'
  }>(),
  { listZone: 'mall' },
)

const listEyebrow = computed(() =>
  props.listZone === 'installment' ? 'Installment' : 'Mall',
)
const listTitle = computed(() =>
  props.listZone === 'installment' ? '先享后付' : '商城精选',
)

const isBnplZone = computed(() => props.listZone === 'installment')

const ctaLabel = computed(() =>
  isBnplZone.value ? '先享后付' : '购买',
)

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
    query: { productId: String(item.id), productName: item.name },
  })
}
</script>

<template>
  <section class="app-wrapper pb-12 md:pb-16">
    <div class="app-content">
      <div class="mb-6 flex items-end justify-between">
        <div>
          <p
            class="mb-2 text-sm tracking-[0.2em] uppercase"
            :class="isBnplZone ? 'text-[#e85a7a]' : 'text-[#ff5f47]'"
          >
            {{ listEyebrow }}
          </p>
          <h3 class="text-2xl font-semibold">
            {{ listTitle }}
          </h3>
        </div>
      </div>

      <div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <article
          v-for="item in products"
          :key="item.id"
          role="button"
          tabindex="0"
          class="rounded-2xl border border-black/10 bg-white overflow-hidden transition hover:-translate-y-1 hover:shadow-xl cursor-pointer"
          @click="handleBuy(item)"
          @keydown.enter.prevent="handleBuy(item)"
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
            <p class="text-xs text-black/50 mb-2">
              产地：{{ item.origin }}
            </p>
            <h4 class="text-lg font-semibold mb-1">
              {{ item.name }}
            </h4>
            <p class="text-sm text-black/70 mb-3">
              {{ item.subtitle }}
            </p>
            <p class="text-sm text-black/60 line-clamp-2 min-h-10 mb-4">
              {{ item.description }}
            </p>
            <div class="flex items-center justify-between">
              <span
                class="text-xl font-semibold"
                :class="isBnplZone ? 'text-[#e85a7a]' : 'text-[#ff5f47]'"
              >￥{{ item.price }}</span>
              <span
                class="px-4 py-2 rounded-lg text-white text-sm pointer-events-none shadow-sm"
                :class="isBnplZone ? 'card-cta-bnpl' : 'card-cta-mall'"
                aria-hidden="true"
              >
                {{ ctaLabel }}
              </span>
            </div>
          </div>
        </article>
      </div>
    </div>
  </section>
</template>

<style scoped>
.card-cta-bnpl {
  background: linear-gradient(135deg, #ff8fb3, #ff6e92);
}

.card-cta-mall {
  background: linear-gradient(135deg, #ff8a5b, #ff5f6b);
}
</style>
