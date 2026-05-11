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
  <section class="normal-font bg-[#e9f1f3] px-4 pb-5 pt-3">
    <div class="mb-3 flex items-center gap-2">
      <div class="search-pill flex flex-1 items-center rounded-full px-3 py-2 text-xs">
        <Icon
          name="local:menu"
          size="0.875rem"
          class="mr-2 rotate-90"
        />
        一站式购手机数码家电美妆
      </div>
      <div class="service-pill flex h-9 w-9 items-center justify-center rounded-full text-sm">
        客服
      </div>
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
          class="quick-entry quick-entry-installment rounded-xl p-3 text-center cursor-pointer transition"
          :class="homeProductZone === 'installment' ? 'ring-2 ring-[#f06b81] ring-offset-2 ring-offset-[#fff6f3]' : ''"
          @click="emit('select-zone', 'installment')"
          @keydown.enter.prevent="emit('select-zone', 'installment')"
        >
          <p class="mb-1 text-sm font-semibold text-[#444]">
            先享后付
          </p>
          <div class="quick-entry-icon mx-auto flex h-10 w-10 items-center justify-center rounded-lg text-white">
            <Icon
              name="tabler:wallet"
              size="1rem"
            />
          </div>
        </article>
        <article
          role="button"
          tabindex="0"
          class="quick-entry quick-entry-mall rounded-xl p-3 text-center cursor-pointer transition"
          :class="homeProductZone === 'mall' ? 'ring-2 ring-[#ff5f6b] ring-offset-2 ring-offset-[#fff6f3]' : ''"
          @click="emit('select-zone', 'mall')"
          @keydown.enter.prevent="emit('select-zone', 'mall')"
        >
          <p class="mb-1 text-sm font-semibold text-[#444]">
            商城专区
          </p>
          <div class="quick-entry-icon mx-auto flex h-10 w-10 items-center justify-center rounded-lg text-white">
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
          <img
            :src="item.image"
            :alt="item.name"
            class="h-14 w-full object-cover"
            loading="lazy"
            decoding="async"
            referrerpolicy="no-referrer"
            @error="onMallProductImageError($event, item.name)"
          >
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
  border: 1px solid rgba(241, 163, 179, 0.18);
  box-shadow: 0 8px 16px rgba(224, 146, 166, 0.12);
}

.quick-entry-icon {
  box-shadow: 0 8px 14px rgba(219, 121, 144, 0.28);
}

.quick-entry-mall .quick-entry-icon {
  background: linear-gradient(135deg, #ff8a5b, #ff5f6b);
}

.quick-entry-installment .quick-entry-icon {
  background: linear-gradient(135deg, #ff8fb3, #ff6e92);
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
