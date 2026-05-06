<script setup lang="ts">
const route = useRoute()
const { smartNavigate } = useCustomRouting(route)

const summaryItems = [
  { label: '本月应还', value: '￥2,480.00' },
  { label: '可用额度', value: '￥18,600.00' },
  { label: '账单日', value: '每月 08 日' },
  { label: '最低还款', value: '￥248.00' },
]

const billList = [
  { id: 1, title: '茶叶分期订单 #A20260508', amount: '-￥620.00', time: '2026-05-02 11:32', status: '待还款' },
  { id: 2, title: '商城支付（乌龙礼盒）', amount: '-￥288.00', time: '2026-04-27 09:16', status: '已完成' },
  { id: 3, title: '还款入账', amount: '+￥1,000.00', time: '2026-04-20 20:08', status: '已到账' },
  { id: 4, title: '授信额度调整', amount: '+￥3,000.00', time: '2026-04-11 14:05', status: '系统调整' },
]

async function goBack() {
  await smartNavigate('/my')
}
</script>

<template>
  <section class="app-wrapper bg-[#f3f4f8] py-7">
    <div class="app-content max-w-[920px]">
      <div class="mb-5 flex items-center justify-between">
        <button
          type="button"
          class="flex items-center gap-1 rounded-full bg-white px-4 py-2 text-sm text-black/65"
          @click="goBack"
        >
          <Icon
            name="tabler:chevron-left"
            size="1rem"
          />
          返回我的
        </button>
        <h1 class="text-3xl font-semibold text-black/85">
          全部账单
        </h1>
        <div class="w-[106px]" />
      </div>

      <div class="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <article
          v-for="item in summaryItems"
          :key="item.label"
          class="rounded-2xl bg-white p-4"
        >
          <p class="mb-2 text-sm text-black/50">
            {{ item.label }}
          </p>
          <p class="text-xl font-semibold text-black/80">
            {{ item.value }}
          </p>
        </article>
      </div>

      <div class="rounded-3xl bg-white p-6">
        <h2 class="mb-4 text-2xl font-semibold text-black/85">
          账单明细
        </h2>
        <div class="space-y-3">
          <article
            v-for="item in billList"
            :key="item.id"
            class="rounded-2xl bg-[#f7f8fb] px-4 py-3"
          >
            <div class="mb-1 flex items-center justify-between">
              <p class="text-base font-medium text-black/80">
                {{ item.title }}
              </p>
              <p class="text-base font-semibold" :class="item.amount.startsWith('+') ? 'text-[#0f8b6f]' : 'text-[#d45a33]'">
                {{ item.amount }}
              </p>
            </div>
            <div class="flex items-center justify-between text-sm text-black/45">
              <span>{{ item.time }}</span>
              <span>{{ item.status }}</span>
            </div>
          </article>
        </div>
      </div>
    </div>
  </section>
</template>
