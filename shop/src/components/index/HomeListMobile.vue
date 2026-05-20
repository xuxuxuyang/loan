<script setup lang="ts">
import type { TeaProduct } from '~/composables/useTeaProducts'

const props = withDefaults(
  defineProps<{
    products: TeaProduct[]
    /** 与首页分区一致，用于区块标题 */
    listZone?: 'installment' | 'mall'
  }>(),
  { listZone: 'mall' },
)

const listTitle = computed(() =>
  props.listZone === 'installment' ? '先享后付' : '商城精选',
)

const isBnplZone = computed(() => props.listZone === 'installment')

/** 按订单金额（展示价 price）升序，与接口顺序解耦 */
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

const ctaLabel = computed(() =>
  isBnplZone.value ? '先享后付' : '购买',
)

const route = useRoute()
const { smartNavigate } = useCustomRouting(route)

async function openProductDetail(item: TeaProduct) {
  await smartNavigate({
    path: `/product/${item.id}`,
  })
}
</script>

<template>
  <section class="normal-font px-4 pb-5 pt-4">
    <div class="mb-4 text-center">
      <h3 class="text-2xl font-semibold text-black/85">
        {{ listTitle }}
      </h3>
      <div
        class="mx-auto mt-1 h-1 w-16 rounded-full"
        :class="isBnplZone ? 'section-accent-bnpl' : 'section-accent-mall'"
      />
    </div>

    <div class="grid grid-cols-2 gap-3">
      <article
        v-for="item in sortedProducts"
        :key="item.id"
        role="button"
        tabindex="0"
        class="overflow-hidden rounded-xl border border-black/10 bg-white cursor-pointer transition active:scale-[0.99]"
        @click="openProductDetail(item)"
        @keydown.enter.prevent="openProductDetail(item)"
      >
        <div
          class="flex aspect-[4/3] w-full items-center justify-center rounded-t-xl bg-[#f6f8fb]"
        >
          <img
            :src="item.image"
            :alt="item.name"
            class="max-h-full w-full max-w-full object-contain p-2 pointer-events-none"
            loading="lazy"
            decoding="async"
            @error="onMallProductImageError($event, item.name)"
          >
        </div>
        <div class="p-3">
          <h4 class="line-clamp-1 text-sm font-semibold">
            {{ item.name }}
          </h4>
          <p class="mb-2 line-clamp-1 text-xs text-black/60">
            {{ item.subtitle }}
          </p>
          <div class="flex items-center justify-between">
            <span
              class="text-sm font-semibold leading-5"
              :class="isBnplZone ? 'text-[#e85a7a]' : 'text-[#ff5f47]'"
            >￥{{ item.price }}</span>
            <span
              class="rounded-md px-2.5 py-1 text-xs text-white pointer-events-none shadow-sm"
              :class="isBnplZone ? 'card-cta-bnpl' : 'card-cta-mall'"
              aria-hidden="true"
            >
              {{ ctaLabel }}
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

section :is(p, span, button, h3, h4) {
  font-family: "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
  line-height: 1.3;
}

/* 与 banner 分区图标色一致：先享后付粉、商城橙渐变 */
.section-accent-bnpl {
  background: linear-gradient(90deg, #ff8fb3, #ff6e92);
}

.section-accent-mall {
  background: linear-gradient(90deg, #ff8a5b, #ff5f6b);
}

.card-cta-bnpl {
  background: linear-gradient(135deg, #ff8fb3, #ff6e92);
}

.card-cta-mall {
  background: linear-gradient(135deg, #ff8a5b, #ff5f6b);
}
</style>
