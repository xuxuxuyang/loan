<script setup lang="ts">
import type { MallCategoryItem, MallCategoryKey, TeaProduct } from '~/composables/useTeaProducts'

const props = defineProps<{
  /** 商城仅展示商品，用于「精选好物」预览 */
  previewProducts: TeaProduct[]
  categories: MallCategoryItem[]
  activeCategory: MallCategoryKey
  homeProductZone: 'installment' | 'mall'
}>()

const emit = defineEmits<{
  'select-category': [category: MallCategoryKey]
  'select-zone': [zone: 'installment' | 'mall']
}>()

const route = useRoute()
const router = useRouter()
const { smartNavigate } = useCustomRouting(route)

function goCustomerService() {
  void router.push('/cs-chat')
}

const featuredPillText = computed(() =>
  props.homeProductZone === 'installment'
    ? '信誉购物 早下单早享受'
    : '精选额度精选购物',
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
  <section class="normal-font app-wrapper bg-[#e9f1f3] py-8 md:py-10">
    <div class="app-content">
      <div class="mb-5 flex items-center gap-3">
        <div class="search-pill flex flex-1 items-center rounded-full px-4 py-3 text-sm">
          <Icon
            name="local:menu"
            size="0.95rem"
            class="mr-2 rotate-90"
          />
          一站式购手机数码家电美妆
        </div>
        <button
          type="button"
          class="service-pill flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm cursor-pointer transition active:opacity-85"
          aria-label="在线客服"
          @click="goCustomerService"
        >
          客服
        </button>
      </div>

      <div class="feature-card mb-5 rounded-3xl p-5">
        <div class="mb-4 flex items-center gap-3">
          <p class="text-2xl font-semibold text-[#2c3140]">
            购物专享
          </p>
          <span class="tag-pill rounded-full px-3 py-1 text-xs text-white">灵活先享后付 轻松购物</span>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <article
            role="button"
            tabindex="0"
            class="quick-entry quick-entry-installment rounded-2xl p-5 cursor-pointer transition"
            :class="homeProductZone === 'installment' ? 'ring-2 ring-[#f06b81] ring-offset-2 ring-offset-[#fff6f3]' : ''"
            @click="emit('select-zone', 'installment')"
            @keydown.enter.prevent="emit('select-zone', 'installment')"
          >
            <p class="mb-2 text-lg font-semibold text-[#444]">
              先享后付
            </p>
            <div class="quick-entry-icon flex h-14 w-14 items-center justify-center rounded-xl text-white">
              <Icon
                name="tabler:wallet"
                size="1.35rem"
              />
            </div>
          </article>
          <article
            role="button"
            tabindex="0"
            class="quick-entry quick-entry-mall rounded-2xl p-5 cursor-pointer transition"
            :class="homeProductZone === 'mall' ? 'ring-2 ring-[#ff5f6b] ring-offset-2 ring-offset-[#fff6f3]' : ''"
            @click="emit('select-zone', 'mall')"
            @keydown.enter.prevent="emit('select-zone', 'mall')"
          >
            <p class="mb-2 text-lg font-semibold text-[#444]">
              商城专区
            </p>
            <div class="quick-entry-icon flex h-14 w-14 items-center justify-center rounded-xl text-white">
              <Icon
                name="tabler:shopping-bag"
                size="1.35rem"
              />
            </div>
          </article>
        </div>
      </div>

      <div
        v-if="homeProductZone === 'mall'"
        class="mb-5 grid grid-cols-4 gap-4 rounded-3xl bg-[#edf5fb] px-3 py-4"
      >
        <button
          v-for="item in categories"
          :key="item.name"
          type="button"
          class="category-item text-center"
          :class="{ 'category-item-active': item.key === activeCategory }"
          @click="emit('select-category', item.key)"
        >
          <div class="category-icon mx-auto mb-2 flex h-16 w-16 items-center justify-center rounded-full">
            <Icon
              :name="item.icon"
              size="1.7rem"
            />
          </div>
          <p class="text-sm text-black/75">
            {{ item.name }}
          </p>
        </button>
      </div>

      <div class="feature-card rounded-3xl p-5">
        <div class="mb-3 flex items-center gap-3">
          <p class="text-2xl font-semibold text-[#2c3140]">
            精选好物
          </p>
          <span
            class="rounded-full px-3 py-1 text-xs text-white"
            :class="homeProductZone === 'installment' ? 'tag-pill' : 'tag-pill-mall'"
          >{{ featuredPillText }}</span>
        </div>
        <div class="grid grid-cols-4 gap-3">
          <article
            v-for="item in previewProducts.slice(0, 4)"
            :key="item.id"
            role="button"
            tabindex="0"
            class="overflow-hidden rounded-xl bg-white cursor-pointer transition hover:shadow-md active:opacity-90"
            @click="openMallListFor(item)"
            @keydown.enter.prevent="openMallListFor(item)"
          >
            <img
              :src="item.image"
              :alt="item.name"
              class="h-28 w-full object-cover"
              loading="lazy"
              decoding="async"
              referrerpolicy="no-referrer"
              @error="onMallProductImageError($event, item.name)"
            >
            <p
              class="px-2 py-1 text-center text-sm font-semibold leading-5 text-white"
              :class="homeProductZone === 'installment' ? 'preview-price-bnpl' : 'preview-price-mall'"
            >
              ￥{{ item.price }}
            </p>
          </article>
        </div>
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
  border-radius: 16px;
  padding: 8px 0;
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

section :is(p, span, button, h2, h3) {
  font-family: "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
  line-height: 1.28;
}
</style>
