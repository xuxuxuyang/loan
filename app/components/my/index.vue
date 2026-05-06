<script setup lang="ts">
const products = useTeaProducts()
const route = useRoute()
const { smartNavigate } = useCustomRouting(route)
const { ensureRegistered, isLoggedIn, loginPhone, profile, syncFromStorage, logout } = useMallAuth()

const orderStatus = [
  { title: '审核中', icon: '⏱️', key: 'reviewing' },
  { title: '待发货', icon: '🕘', key: 'shipping' },
  { title: '待收货', icon: '🚚', key: 'receiving' },
  { title: '享用中', icon: '📋', key: 'enjoying' },
]

const serviceList = [
  { key: 'address', title: '收货地址', icon: '📍' },
  { key: 'service', title: '在线客服', icon: '💬' },
  { key: 'question', title: '常见问题', icon: '❓' },
  { key: 'download', title: 'App下载', icon: '⬇️' },
  { key: 'privacy', title: '隐私政策', icon: '🔒' },
  { key: 'logout', title: '注销', icon: '✖️' },
]

const mockSummary = {
  orderCount: {
    reviewing: 1,
    shipping: 2,
    receiving: 3,
    enjoying: 5,
  },
  bankCardCount: 2,
  billPendingAmount: 2368.5,
  points: 1280,
  couponCount: 6,
  defaultAddress: '广东省广州市天河区珠江新城花城大道88号',
}

const displayName = computed(() => {
  if (!isLoggedIn.value) {
    return '登录/注册'
  }
  if (profile.value?.name) {
    return profile.value.name
  }
  if (loginPhone.value === 'admin') {
    return '管理员账号'
  }
  return `用户${loginPhone.value.slice(-4)}`
})

const displaySubText = computed(() => {
  if (!isLoggedIn.value) {
    return '账户还款、资产信息登录后查看'
  }
  if (loginPhone.value === 'admin') {
    return '测试账号已登录，展示模拟完整数据'
  }
  return `登录账号：${loginPhone.value}`
})

const displayOrderStatus = computed(() => {
  return orderStatus.map(item => ({
    ...item,
    count: isLoggedIn.value
      ? mockSummary.orderCount[item.key as keyof typeof mockSummary.orderCount]
      : 0,
  }))
})

if (import.meta.client) {
  syncFromStorage()
}

async function handleGoRegister() {
  await smartNavigate('/login')
}

async function handleBuy(productName: string) {
  const passed = await ensureRegistered()
  if (!passed) {
    return
  }
  ElMessage.success(`下单成功：${productName}`)
}

async function handleBankCard() {
  await smartNavigate('/bank-card')
}

async function handleBill() {
  await smartNavigate('/bill')
}

async function handleService(key: string) {
  if (key === 'address') {
    await smartNavigate('/address')
    return
  }
  if (key === 'logout') {
    logout()
    ElMessage.success('已退出登录')
    return
  }
  ElMessage.info('该功能开发中')
}
</script>

<template>
  <section class="app-wrapper bg-[#f3f4f8] py-6 md:py-8">
    <div class="app-content max-w-[920px]">
      <div class="mb-6 rounded-3xl bg-[#eaf2f5] p-6">
        <div class="mb-4 flex items-center gap-4">
          <div class="flex h-16 w-16 items-center justify-center rounded-full bg-white text-4xl shadow-sm">
            👤
          </div>
          <div>
            <button
              v-if="!isLoggedIn"
              type="button"
              class="text-3xl font-semibold text-black/80"
              @click="handleGoRegister"
            >
              {{ displayName }}
            </button>
            <p
              v-else
              class="text-3xl font-semibold text-black/80"
            >
              {{ displayName }}
            </p>
            <p class="text-sm text-black/45">
              {{ displaySubText }}
            </p>
          </div>
        </div>

        <div class="mb-4 rounded-3xl bg-white p-5">
          <div class="mb-4 flex items-center justify-between">
            <h3 class="text-3xl font-semibold text-black/85">
              商城订单
            </h3>
            <button
              type="button"
              class="text-lg text-black/50"
            >
              全部 >
            </button>
          </div>
          <div class="grid grid-cols-4 gap-3 text-center">
            <article
              v-for="item in displayOrderStatus"
              :key="item.title"
              class="py-1"
            >
              <p class="mb-1 text-3xl">
                {{ item.icon }}
              </p>
              <p class="text-base text-black/70">
                {{ item.title }}
              </p>
              <p class="text-sm text-[#e46a7f]">
                {{ item.count }}
              </p>
            </article>
          </div>
        </div>

        <div class="mb-4 grid grid-cols-2 gap-4 rounded-3xl bg-white p-4 text-center">
          <button
            type="button"
            class="rounded-xl bg-[#fff6f6] px-3 py-4 text-center"
            @click="handleBankCard"
          >
            <p class="text-2xl font-semibold text-black/80">
              我的银行卡
            </p>
            <p class="mt-1 text-sm text-black/50">
              {{ isLoggedIn ? `已绑定 ${mockSummary.bankCardCount} 张` : '登录后查看' }}
            </p>
          </button>
          <button
            type="button"
            class="rounded-xl bg-[#fff6f6] px-3 py-4 text-center"
            @click="handleBill"
          >
            <p class="text-2xl font-semibold text-black/80">
              全部账单
            </p>
            <p class="mt-1 text-sm text-black/50">
              {{ isLoggedIn ? `待还 ¥${mockSummary.billPendingAmount}` : '登录后查看' }}
            </p>
          </button>
        </div>

        <div class="mb-4 rounded-3xl bg-white p-5">
          <div class="flex items-center justify-between text-base text-black/75">
            <p>
              积分
              <span class="ml-1 font-semibold text-[#dd667d]">{{ isLoggedIn ? mockSummary.points : '--' }}</span>
            </p>
            <p>
              优惠券
              <span class="ml-1 font-semibold text-[#dd667d]">{{ isLoggedIn ? `${mockSummary.couponCount}张` : '--' }}</span>
            </p>
          </div>
          <p class="mt-3 line-clamp-1 text-sm text-black/55">
            默认地址：{{ isLoggedIn ? mockSummary.defaultAddress : '登录后查看默认收货地址' }}
          </p>
        </div>

        <div class="mb-4 rounded-3xl bg-white p-5">
          <h3 class="mb-4 text-3xl font-semibold text-black/85">
            其他服务
          </h3>
          <div class="grid grid-cols-6 gap-4">
            <button
              v-for="item in serviceList"
              :key="item.title"
              type="button"
              class="text-center"
              @click="handleService(item.key)"
            >
              <div class="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-[#ff6b75] text-lg text-white">
                {{ item.icon }}
              </div>
              <p class="text-sm text-black/75">
                {{ item.title }}
              </p>
            </button>
          </div>
        </div>

        <div class="rounded-3xl bg-white px-3 py-4 text-center">
          <p class="text-xl text-black/65">
            客服电话：<span class="font-semibold text-[#c06b37]">13008962100</span>
          </p>
          <p class="mt-1 text-lg text-black/45">
            9:00-18:00
          </p>
        </div>
      </div>

      <div>
        <div class="mb-4 text-center">
          <h3 class="text-4xl font-semibold text-black/85">
            推荐商品
          </h3>
          <div class="mx-auto mt-2 h-1 w-20 rounded-full bg-[#79d2c7]" />
        </div>
        <div class="grid grid-cols-2 gap-4">
          <article
            v-for="item in products.slice(0, 4)"
            :key="item.id"
            class="overflow-hidden rounded-2xl bg-white"
          >
            <img
              :src="item.image"
              :alt="item.name"
              class="h-44 w-full object-cover"
            >
            <div class="p-3">
              <p class="line-clamp-1 text-base font-semibold text-black/85">
                {{ item.name }}
              </p>
              <p class="mt-1 text-sm text-black/55">
                {{ item.subtitle }}
              </p>
              <div class="mt-2 flex items-center justify-between">
                <p class="text-base font-semibold text-[#d45a33]">
                  ￥{{ item.price }}
                </p>
                <button
                  type="button"
                  class="rounded-md bg-[var(--theme-color)] px-3 py-1.5 text-xs text-white"
                  @click="handleBuy(item.name)"
                >
                  购买
                </button>
              </div>
            </div>
          </article>
        </div>
      </div>
    </div>
  </section>
</template>
