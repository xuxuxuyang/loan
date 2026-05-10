<script setup lang="ts">
interface TeaProduct {
  id: number
  name: string
  subtitle: string
  image: string
  description: string
  origin: string
  price: number
}

const props = withDefaults(
  defineProps<{
    products: TeaProduct[]
    /** 仅展示，不可跳转下单 */
    displayOnly?: boolean
  }>(),
  { displayOnly: false },
)

const route = useRoute()
const { smartNavigate } = useCustomRouting(route)
const { ensureRegistered } = useMallAuth()

async function handleBuy(item: TeaProduct) {
  if (props.displayOnly) {
    ElMessage.info('该商品仅供展示，请前往分期专区页面选购可下单商品')
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
</script>

<template>
  <section class="app-wrapper pb-12 md:pb-16">
    <div class="app-content">
      <div class="mb-6 flex items-end justify-between">
        <div>
          <p class="text-sm tracking-[0.2em] uppercase text-[var(--theme-color)] mb-2">
            Tea Mall
          </p>
          <h3 class="text-2xl font-semibold">
            {{ props.displayOnly ? '商城精选 · 展示专区' : '高端茶叶精选' }}
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
              <span class="text-xl font-semibold text-[var(--theme-color)]">￥{{ item.price }}</span>
              <span
                class="px-4 py-2 rounded-lg bg-[var(--theme-color)] text-white text-sm pointer-events-none"
                aria-hidden="true"
              >
                {{ props.displayOnly ? '仅展示' : '立即购买' }}
              </span>
            </div>
          </div>
        </article>
      </div>
    </div>
  </section>
</template>
