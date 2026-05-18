<script setup lang="ts">
import type { MallCategoryItem, MallCategoryKey, TeaProduct } from '~/composables/useTeaProducts'

const props = defineProps<{
  previewProducts: TeaProduct[]
  categories: MallCategoryItem[]
  activeCategory: MallCategoryKey
}>()

const emit = defineEmits<{
  'select-category': [category: MallCategoryKey]
}>()

const route = useRoute()
const { smartNavigate } = useCustomRouting(route)

function goCustomerService() {
  void smartNavigate('/cs-chat')
}

function goSearch() {
  void smartNavigate('/search')
}

function openMallListFor(item: TeaProduct) {
  void smartNavigate({
    path: '/list',
    query: { category: item.category },
  })
}
</script>

<template>
  <section class="normal-font bg-[#e9f1f3] px-4 pb-5 pt-3">
    <div class="mb-3 flex items-center gap-2">
      <button
        type="button"
        class="search-pill flex flex-1 items-center rounded-full px-3 py-2 text-left text-xs cursor-pointer transition active:opacity-85"
        aria-label="搜索商品"
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

    <div
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
          class="rounded-full px-2 py-0.5 text-[10px] text-white tag-pill-mall"
        >品类齐全 省钱省心</span>
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
            class="px-1 py-0.5 text-center text-[10px] font-semibold leading-4 text-white preview-price-mall"
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

.tag-pill-mall {
  background: linear-gradient(135deg, #ff8a5b, #ff5f6b);
}

.preview-price-mall {
  background: linear-gradient(135deg, #ff8a5b, #ff5f6b);
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
