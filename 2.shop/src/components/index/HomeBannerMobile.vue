<script setup lang="ts">
import type { MallCategoryItem, MallCategoryKey, TeaProduct } from '~/composables/useTeaProducts'

const props = defineProps<{
  previewProducts: TeaProduct[]
  categories: MallCategoryItem[]
  activeCategory: MallCategoryKey
  /** 首页当前展示的商品分区：默认先享后付；点「商城专区」切为 mall */
  homeProductZone: 'installment' | 'mall'
}>()

const emit = defineEmits<{
  'select-category': [category: MallCategoryKey]
  'select-zone': [zone: 'installment' | 'mall']
}>()

const route = useRoute()
const { smartNavigate } = useCustomRouting(route)

function goCustomerService() {
  void smartNavigate('/cs-chat')
}

function goSearch() {
  void smartNavigate('/search')
}

const featuredPillText = computed(() =>
  props.homeProductZone === 'installment'
    ? '信誉购物 早下单早享受'
    : '品类齐全 省钱省心',
)

function openMallListFor(item: TeaProduct) {
  if (props.homeProductZone === 'installment') {
    void smartNavigate('/installment')
    return
  }
  void smartNavigate({
    path: '/list',
    query: { category: item.category },
  })
}
</script>

<template>
  <section
    class="normal-font bg-[#e9f1f3] px-4 pb-5"
    style="padding-top: max(0.75rem, env(safe-area-inset-top));"
  >
    <div class="mb-3 flex items-center gap-2">
      <button
        type="button"
        class="search-pill flex flex-1 items-center rounded-full px-3 py-2 text-left text-xs cursor-pointer transition active:opacity-85"
        aria-label="搜索商品"
        @click="goSearch"
      >
        <Icon
          name="local:menu"
          size="0.875rem"
          class="mr-2 rotate-90 shrink-0"
        />
        <span class="min-w-0 truncate text-[rgba(45,58,83,0.72)]">一站式购手机数码家电美妆</span>
      </button>
      <button
        type="button"
        class="service-pill flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm cursor-pointer transition active:opacity-85"
        aria-label="在线客服"
        @click="goCustomerService"
      >
        客服
      </button>
    </div>

    <div class="feature-card mb-3 rounded-2xl p-3">
      <div class="mb-3 flex items-center gap-2">
        <p class="text-base font-semibold text-[#2c3140]">
          购物专享
        </p>
        <span class="tag-pill rounded-full px-2 py-0.5 text-[10px] text-white">正品保障 极速发货</span>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <article
          role="button"
          tabindex="0"
          class="quick-entry quick-entry-installment rounded-xl p-3 text-center cursor-pointer transition-all duration-200"
          :class="
            homeProductZone === 'installment'
              ? 'quick-entry--active quick-entry--active-installment'
              : 'quick-entry--inactive'
          "
          :aria-selected="homeProductZone === 'installment'"
          @click="emit('select-zone', 'installment')"
          @keydown.enter.prevent="emit('select-zone', 'installment')"
        >
          <p
            class="mb-1 text-sm transition-colors duration-200"
            :class="homeProductZone === 'installment' ? 'quick-entry-title--on' : 'quick-entry-title--off'"
          >
            先享后付
          </p>
          <div
            class="quick-entry-icon mx-auto flex h-10 w-10 items-center justify-center rounded-lg text-white transition-transform duration-200"
            :class="{ 'quick-entry-icon--pop': homeProductZone === 'installment' }"
          >
            <Icon
              name="tabler:wallet"
              size="1rem"
            />
          </div>
        </article>
        <article
          role="button"
          tabindex="0"
          class="quick-entry quick-entry-mall rounded-xl p-3 text-center cursor-pointer transition-all duration-200"
          :class="
            homeProductZone === 'mall'
              ? 'quick-entry--active quick-entry--active-mall'
              : 'quick-entry--inactive'
          "
          :aria-selected="homeProductZone === 'mall'"
          @click="emit('select-zone', 'mall')"
          @keydown.enter.prevent="emit('select-zone', 'mall')"
        >
          <p
            class="mb-1 text-sm transition-colors duration-200"
            :class="homeProductZone === 'mall' ? 'quick-entry-title--on' : 'quick-entry-title--off'"
          >
            商城专区
          </p>
          <div
            class="quick-entry-icon mx-auto flex h-10 w-10 items-center justify-center rounded-lg text-white transition-transform duration-200"
            :class="{ 'quick-entry-icon--pop': homeProductZone === 'mall' }"
          >
            <Icon
              name="tabler:shopping-bag"
              size="1rem"
            />
          </div>
        </article>
      </div>
    </div>

    <div
      v-if="homeProductZone === 'mall'"
      class="mb-3 grid grid-cols-4 gap-2 rounded-2xl bg-[#edf5fb] px-1 py-2"
    >
      <button
        v-for="item in categories"
        :key="item.name"
        type="button"
        class="category-item text-center"
        :class="{ 'category-item-active': item.key === activeCategory }"
        @click="emit('select-category', item.key)"
      >
        <div class="category-icon mx-auto mb-1 flex h-12 w-12 items-center justify-center rounded-full">
          <Icon
            :name="item.icon"
            size="1.2rem"
          />
        </div>
        <p class="text-xs text-black/75">
          {{ item.name }}
        </p>
      </button>
    </div>

    <div class="feature-card rounded-2xl p-3">
      <div class="mb-2 flex items-center gap-2">
        <p class="text-base font-semibold text-[#2c3140]">
          精选好物
        </p>
        <span
          class="rounded-full px-2 py-0.5 text-[10px] text-white"
          :class="homeProductZone === 'installment' ? 'tag-pill' : 'tag-pill-mall'"
        >{{ featuredPillText }}</span>
      </div>
      <div class="grid grid-cols-4 gap-2">
        <article
          v-for="item in previewProducts.slice(0, 4)"
          :key="item.id"
          role="button"
          tabindex="0"
          class="overflow-hidden rounded-lg bg-white cursor-pointer transition active:opacity-85"
          @click="openMallListFor(item)"
          @keydown.enter.prevent="openMallListFor(item)"
        >
          <div class="relative aspect-[5/4] w-full overflow-hidden rounded-t-lg bg-[#f6f8fb]">
            <img
              :src="item.image"
              :alt="item.name"
              class="pointer-events-none absolute inset-0 h-full w-full object-cover"
              loading="lazy"
              decoding="async"
              @error="onMallProductImageError($event, item.name)"
            >
          </div>
          <p
            class="px-1 py-0.5 text-center text-[10px] font-semibold leading-4 text-white"
            :class="homeProductZone === 'installment' ? 'preview-price-bnpl' : 'preview-price-mall'"
          >
            ￥{{ item.price }}
          </p>
        </article>
      </div>
    </div>
  </section>
</template>

<style scoped>
.normal-font {
  font-family: "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
}

.search-pill {
  background: linear-gradient(120deg, #ffffff, #f5faff);
  border: 1px solid rgba(128, 182, 255, 0.2);
  color: rgba(45, 58, 83, 0.72);
  box-shadow: 0 6px 14px rgba(118, 148, 214, 0.1);
}

.service-pill {
  background: linear-gradient(120deg, #fff3f6, #fff);
  border: 1px solid rgba(242, 143, 169, 0.22);
  color: #e06f8d;
  box-shadow: 0 6px 14px rgba(229, 120, 150, 0.12);
}

.feature-card {
  background: linear-gradient(135deg, #fff6f3, #fff8fc);
  border: 1px solid rgba(240, 156, 173, 0.2);
  box-shadow: 0 10px 20px rgba(224, 136, 159, 0.1);
}

.tag-pill {
  background: linear-gradient(90deg, #ff7b87, #ff6a9e);
}

.tag-pill-mall {
  background: linear-gradient(135deg, #ff8a5b, #ff5f6b);
}

/* 精选好物价格条：与分区主色一致 */
.preview-price-bnpl {
  background: linear-gradient(135deg, #ff8fb3, #ff6e92);
}

.preview-price-mall {
  background: linear-gradient(135deg, #ff8a5b, #ff5f6b);
}

.quick-entry {
  background: linear-gradient(180deg, #fff, #fff7f9);
  border: 2px solid transparent;
  box-shadow: 0 8px 16px rgba(224, 146, 166, 0.12);
}

/* 未选中：弱化边框与阴影，与选中态形成对比（边框恒为 2px，避免切换跳动） */
.quick-entry--inactive {
  background: linear-gradient(180deg, #fffcfc, #faf8f9);
  border-color: rgba(200, 180, 186, 0.45);
  box-shadow: 0 4px 10px rgba(180, 160, 170, 0.08);
}

.quick-entry-title--off {
  color: #6b6f7a;
  font-weight: 500;
}

.quick-entry-title--on {
  color: #2c3140;
  font-weight: 700;
}

.quick-entry--active {
  box-shadow:
    0 10px 22px rgba(0, 0, 0, 0.06),
    0 0 0 1px rgba(255, 255, 255, 0.6) inset;
}

.quick-entry--active-installment {
  background: linear-gradient(165deg, #fff 0%, #fff0f4 55%, #ffe8ef 100%);
  border-color: #e85a7c;
}

.quick-entry--active-mall {
  background: linear-gradient(165deg, #fff 0%, #fff6f0 55%, #ffede4 100%);
  border-color: #ff5f47;
}

.quick-entry-icon {
  box-shadow: 0 8px 14px rgba(219, 121, 144, 0.28);
}

.quick-entry-icon--pop {
  transform: scale(1.06);
}

.quick-entry-installment .quick-entry-icon {
  background: linear-gradient(135deg, #ff8fb3, #ff6e92);
}

.quick-entry-installment .quick-entry-icon--pop {
  box-shadow: 0 10px 18px rgba(232, 90, 124, 0.38);
}

.quick-entry-mall .quick-entry-icon {
  background: linear-gradient(135deg, #ff8a5b, #ff5f6b);
}

.quick-entry-mall .quick-entry-icon--pop {
  box-shadow: 0 10px 18px rgba(255, 107, 80, 0.38);
}

.category-item {
  border-radius: 12px;
  padding: 4px 0;
}

.category-item-active {
  background: linear-gradient(180deg, #fff, #fdf1f7);
}

.category-item-active .category-icon {
  background: linear-gradient(135deg, #ff9eb1, #8ea8ff);
  color: #fff;
  border-color: transparent;
}

.category-item-active p {
  color: #c85f86;
  font-weight: 600;
}

.category-icon {
  background: linear-gradient(135deg, #ffffff, #f4f8ff);
  color: #607189;
  border: 1px solid rgba(133, 178, 240, 0.22);
  box-shadow: 0 6px 12px rgba(125, 162, 220, 0.12);
}

section :is(p, span, button, h3) {
  font-family: "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
  line-height: 1.25;
}
</style>
