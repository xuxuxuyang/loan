<script setup lang="ts">
import type { TeaProduct } from '~/composables/useTeaProducts'

defineProps<{
  products: TeaProduct[]
}>()

const categoryList = [
  { name: '旅游产品', icon: 'tabler:plane' },
  { name: '字画定制', icon: 'tabler:photo' },
  { name: '手机通讯', icon: 'tabler:device-mobile' },
  { name: '珠宝黄金', icon: 'tabler:diamond' },
]
</script>

<template>
  <section class="normal-font bg-[#e9f1f3] px-4 pb-5 pt-3">
    <div class="mb-3 flex items-center gap-2">
      <div class="flex flex-1 items-center rounded-full bg-white px-3 py-2 text-xs text-black/45">
        <Icon
          name="local:menu"
          size="0.875rem"
          class="mr-2 rotate-90"
        />
        一站式购生活好物
      </div>
      <div class="flex h-9 w-9 items-center justify-center rounded-full bg-white text-sm">
        客服
      </div>
    </div>

    <div class="mb-3 rounded-2xl bg-[#f8ece7] p-3">
      <div class="mb-3 flex items-center gap-2">
        <p class="text-base font-semibold text-[#3a2b2b]">
          购物专享
        </p>
        <span class="rounded-full bg-[#ff6c70] px-2 py-0.5 text-[10px] text-white">灵活分期 轻松购物</span>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <article class="rounded-xl bg-white p-3 text-center shadow-sm">
          <p class="mb-1 text-sm font-semibold text-[#444]">
            商城专区
          </p>
          <div class="mx-auto flex h-10 w-10 items-center justify-center rounded-lg bg-[#ff744f] text-white">
            <Icon
              name="tabler:shopping-bag"
              size="1rem"
            />
          </div>
        </article>
        <article class="rounded-xl bg-white p-3 text-center shadow-sm">
          <p class="mb-1 text-sm font-semibold text-[#444]">
            分期专区
          </p>
          <div class="mx-auto flex h-10 w-10 items-center justify-center rounded-lg bg-[#ff8a90] text-white">
            <Icon
              name="tabler:wallet"
              size="1rem"
            />
          </div>
        </article>
      </div>
    </div>

    <div class="mb-3 grid grid-cols-4 gap-2 rounded-2xl bg-[#e9f1f3] py-1">
      <article
        v-for="item in categoryList"
        :key="item.name"
        class="text-center"
      >
        <div class="mx-auto mb-1 flex h-12 w-12 items-center justify-center rounded-full bg-white text-[#70727a]">
          <Icon
            :name="item.icon"
            size="1.2rem"
          />
        </div>
        <p class="text-xs text-black/75">
          {{ item.name }}
        </p>
      </article>
    </div>

    <div class="rounded-2xl bg-[#f8ece7] p-3">
      <div class="mb-2 flex items-center gap-2">
        <p class="text-base font-semibold text-[#3a2b2b]">
          精选好物
        </p>
        <span class="rounded-full bg-[#ff6c70] px-2 py-0.5 text-[10px] text-white">精选额度精选购物</span>
      </div>
      <div class="grid grid-cols-4 gap-2">
        <article
          v-for="item in products.slice(0, 4)"
          :key="item.id"
          class="overflow-hidden rounded-lg bg-white"
        >
          <img
            :src="item.image"
            :alt="item.name"
            class="h-14 w-full object-cover"
          >
          <p class="bg-[#ff6c54] px-1 py-0.5 text-center text-[10px] font-semibold leading-4 text-white">
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

section :is(p, span, button, h3) {
  font-family: "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
  line-height: 1.25;
}
</style>
