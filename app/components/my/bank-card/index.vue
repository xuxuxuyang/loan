<script setup lang="ts">
const route = useRoute()
const { smartNavigate } = useCustomRouting(route)

const cards = [
  {
    id: 1,
    bankName: '中国建设银行',
    cardType: '储蓄卡',
    cardNo: '**** **** **** 6218',
    owner: '张**',
    theme: 'from-[#2468f2] to-[#2e8cff]',
  },
  {
    id: 2,
    bankName: '招商银行',
    cardType: '储蓄卡',
    cardNo: '**** **** **** 8893',
    owner: '张**',
    theme: 'from-[#ff6b7f] to-[#ff8b6b]',
  },
]

const tips = [
  '为保障资金安全，修改银行卡前需进行短信验证。',
  '分期订单优先使用默认银行卡自动扣款。',
  '银行卡有效期临近时请提前更新，避免还款失败。',
]

async function goBack() {
  await smartNavigate('/my')
}

function handleAddCard() {
  ElMessage.success('新增银行卡功能开发中')
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
          我的银行卡
        </h1>
        <button
          type="button"
          class="rounded-full bg-[var(--theme-color)] px-4 py-2 text-sm text-white"
          @click="handleAddCard"
        >
          + 添加银行卡
        </button>
      </div>

      <div class="grid gap-5 md:grid-cols-2">
        <article
          v-for="item in cards"
          :key="item.id"
          class="overflow-hidden rounded-3xl p-6 text-white shadow-[0_12px_30px_rgba(26,55,99,0.18)]"
          :class="`bg-gradient-to-r ${item.theme}`"
        >
          <p class="mb-4 text-base text-white/90">
            {{ item.bankName }}
          </p>
          <p class="mb-7 text-[1.65rem] tracking-[0.16em]">
            {{ item.cardNo }}
          </p>
          <div class="flex items-center justify-between text-sm text-white/90">
            <span>{{ item.cardType }}</span>
            <span>持卡人 {{ item.owner }}</span>
          </div>
        </article>
      </div>

      <div class="mt-5 rounded-3xl bg-white p-6">
        <h2 class="mb-4 text-2xl font-semibold text-black/85">
          使用提示
        </h2>
        <ul class="space-y-2 text-base text-black/60">
          <li
            v-for="item in tips"
            :key="item"
            class="rounded-xl bg-[#f7f8fb] px-4 py-3"
          >
            {{ item }}
          </li>
        </ul>
      </div>
    </div>
  </section>
</template>
