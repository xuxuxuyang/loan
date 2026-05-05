<script setup lang="ts">
interface TeaProduct {
  id: number
  name: string
  subtitle: string
  image: string
  price: number
}

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
  <section class="normal-font app-wrapper bg-[#e9f1f3] py-8 md:py-10">
    <div class="app-content">
      <div class="mb-5 flex items-center gap-3">
        <div class="flex flex-1 items-center rounded-full bg-white px-4 py-3 text-sm text-black/45">
          <Icon
            name="local:menu"
            size="0.95rem"
            class="mr-2 rotate-90"
          />
          一站式购生活好物
        </div>
        <div class="flex h-11 w-11 items-center justify-center rounded-full bg-white text-sm">
          客服
        </div>
      </div>

      <div class="mb-5 rounded-3xl bg-[#f8ece7] p-5">
        <div class="mb-4 flex items-center gap-3">
          <p class="text-2xl font-semibold text-[#3a2b2b]">
            购物专享
          </p>
          <span class="rounded-full bg-[#ff6c70] px-3 py-1 text-xs text-white">灵活分期 轻松购物</span>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <article class="rounded-2xl bg-white p-5 shadow-sm">
            <p class="mb-2 text-lg font-semibold text-[#444]">
              商城专区
            </p>
            <div class="flex h-14 w-14 items-center justify-center rounded-xl bg-[#ff744f] text-white">
              <Icon
                name="tabler:shopping-bag"
                size="1.35rem"
              />
            </div>
          </article>
          <article class="rounded-2xl bg-white p-5 shadow-sm">
            <p class="mb-2 text-lg font-semibold text-[#444]">
              分期专区
            </p>
            <div class="flex h-14 w-14 items-center justify-center rounded-xl bg-[#ff8a90] text-white">
              <Icon
                name="tabler:wallet"
                size="1.35rem"
              />
            </div>
          </article>
        </div>
      </div>

      <div class="mb-5 grid grid-cols-4 gap-4">
        <article
          v-for="item in categoryList"
          :key="item.name"
          class="text-center"
        >
          <div class="mx-auto mb-2 flex h-16 w-16 items-center justify-center rounded-full bg-white text-[#70727a]">
            <Icon
              :name="item.icon"
              size="1.7rem"
            />
          </div>
          <p class="text-sm text-black/75">
            {{ item.name }}
          </p>
        </article>
      </div>

      <div class="rounded-3xl bg-[#f8ece7] p-5">
        <div class="mb-3 flex items-center gap-3">
          <p class="text-2xl font-semibold text-[#3a2b2b]">
            精选好物
          </p>
          <span class="rounded-full bg-[#ff6c70] px-3 py-1 text-xs text-white">精选额度精选购物</span>
        </div>
        <div class="grid grid-cols-4 gap-3">
          <article
            v-for="item in products.slice(0, 4)"
            :key="item.id"
            class="overflow-hidden rounded-xl bg-white"
          >
            <img
              :src="item.image"
              :alt="item.name"
              class="h-28 w-full object-cover"
            >
            <p class="bg-[#ff6c54] px-2 py-1 text-center text-sm font-semibold leading-5 text-white">
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

section :is(p, span, button, h2, h3) {
  font-family: "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
  line-height: 1.28;
}
</style>
