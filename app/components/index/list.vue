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

defineProps<{
  products: TeaProduct[]
}>()

const { ensureRegistered } = useMallAuth()

async function handleBuy(productName: string) {
  const passed = await ensureRegistered()
  if (!passed) {
    return
  }
  ElMessage.success(`已选购：${productName}`)
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
            高端茶叶精选
          </h3>
        </div>
      </div>

      <div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <article
          v-for="item in products"
          :key="item.id"
          class="rounded-2xl border border-black/10 bg-white overflow-hidden transition hover:-translate-y-1 hover:shadow-xl"
        >
          <img
            :src="item.image"
            :alt="item.name"
            class="h-56 w-full object-cover"
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
              <button
                type="button"
                class="px-4 py-2 rounded-lg bg-[var(--theme-color)] text-white text-sm hover:opacity-90"
                @click="handleBuy(item.name)"
              >
                立即购买
              </button>
            </div>
          </div>
        </article>
      </div>
    </div>
  </section>
</template>
