<script setup lang="ts">
const route = useRoute()
const { smartNavigate } = useCustomRouting(route)

const billItems = [
  { label: '本月应还', value: '￥2,480.00' },
  { label: '可用额度', value: '￥18,600.00' },
  { label: '账单日', value: '每月 08 日' },
]

const billList = [
  { id: 1, title: '茶叶分期订单 #A20260508', amount: '-￥620.00', time: '2026-05-02 11:32', status: '待还款' },
  { id: 2, title: '商城支付（乌龙礼盒）', amount: '-￥288.00', time: '2026-04-27 09:16', status: '已完成' },
  { id: 3, title: '还款入账', amount: '+￥1,000.00', time: '2026-04-20 20:08', status: '已到账' },
]

async function goBack() {
  await smartNavigate('/my')
}
</script>

<template>
  <section class="px-4 pb-5 pt-4">
    <div class="mb-3 flex items-center justify-between">
      <button
        type="button"
        class="flex h-9 w-9 items-center justify-center rounded-full bg-white text-black/60"
        @click="goBack"
      >
        <Icon
          name="tabler:chevron-left"
          size="1.15rem"
        />
      </button>
      <h1 class="text-xl font-semibold text-black/85">
        全部账单
      </h1>
      <div class="w-9" />
    </div>

    <div class="mb-3 rounded-2xl bg-white p-4">
      <h2 class="mb-3 text-base font-semibold text-black/85">
        账单概览
      </h2>
      <div class="space-y-2">
        <div
          v-for="item in billItems"
          :key="item.label"
          class="flex items-center justify-between rounded-xl bg-[#f7f8fb] px-3 py-2.5"
        >
          <span class="text-sm text-black/55">{{ item.label }}</span>
          <span class="text-sm font-semibold text-black/80">{{ item.value }}</span>
        </div>
      </div>
    </div>

    <div class="rounded-2xl bg-white p-4">
      <h2 class="mb-3 text-base font-semibold text-black/85">
        最近记录
      </h2>
      <div class="space-y-2.5">
        <article
          v-for="item in billList"
          :key="item.id"
          class="rounded-xl bg-[#f7f8fb] px-3 py-2.5"
        >
          <div class="mb-1 flex items-center justify-between">
            <p class="line-clamp-1 text-sm font-medium text-black/80">
              {{ item.title }}
            </p>
            <p class="text-sm font-semibold" :class="item.amount.startsWith('+') ? 'text-[#0f8b6f]' : 'text-[#d45a33]'">
              {{ item.amount }}
            </p>
          </div>
          <div class="flex items-center justify-between text-xs text-black/45">
            <span>{{ item.time }}</span>
            <span>{{ item.status }}</span>
          </div>
        </article>
      </div>
    </div>
  </section>
</template>
