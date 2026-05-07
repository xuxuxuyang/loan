<script setup lang="ts">
import { isAdminTestAccount } from '~/composables/useMallAuth'

const products = useTeaProducts()
const route = useRoute()
const { smartNavigate } = useCustomRouting(route)
const { ensureRegistered, isLoggedIn, loginPhone, profile, syncFromStorage, logout } = useMallAuth()
const { summary, fetchSummary, cardPackages, fetchCardPackages } = useMallMy()

const orderStatus = [
  { title: '审核中', icon: '⏱️', key: 'reviewing' },
  { title: '待发货', icon: '🕘', key: 'shipping' },
  { title: '待收货', icon: '🚚', key: 'receiving' },
  { title: '已完成', icon: '📋', key: 'enjoying' },
]

const serviceList = [
  { key: 'address', title: '收货地址', icon: '📍' },
  { key: 'service', title: '在线客服', icon: '💬' },
  // { key: 'question', title: '常见问题', icon: '❓' },
  { key: 'privacy', title: '隐私政策', icon: '🔒' },
  { key: 'download', title: 'App下载', icon: '⬇️' },
  
]

const displayName = computed(() => {
  if (!isLoggedIn.value) {
    return '登录/注册'
  }
  if (profile.value?.name) {
    return profile.value.name
  }
  if (isAdminTestAccount(loginPhone.value)) {
    return '管理员账号'
  }
  return `用户${loginPhone.value.slice(-4)}`
})

const displaySubText = computed(() => {
  if (!isLoggedIn.value) {
    return '账户还款、资产信息登录后查看'
  }
  if (isAdminTestAccount(loginPhone.value)) {
    return '测试账号已登录，展示真实接口数据'
  }
  return `登录账号：${loginPhone.value}`
})

const displayOrderStatus = computed(() => {
  return orderStatus.map(item => ({
    ...item,
    count: isLoggedIn.value
      ? summary.value.orderCount[item.key as keyof typeof summary.value.orderCount]
      : 0,
  }))
})

if (import.meta.client) {
  syncFromStorage()
  if (isLoggedIn.value) {
    void fetchSummary(loginPhone.value)
    void fetchCardPackages(loginPhone.value)
  }
}

watch([isLoggedIn, loginPhone], async ([loggedIn, phone]) => {
  if (!loggedIn || !phone) {
    cardPackages.value = []
    return
  }
  await fetchSummary(phone)
  await fetchCardPackages(phone)
})

async function handleGoRegister() {
  await smartNavigate('/login')
}

async function handleBuy(productId: number, productName?: string) {
  const passed = await ensureRegistered()
  if (!passed) {
    return
  }
  await smartNavigate({
    path: '/order-create',
    query: {
      productId: String(productId),
      ...(productName ? { productName } : {}),
    },
  })
}

async function handleBankCard() {
  await smartNavigate('/bank-card')
}

async function handleBill() {
  await smartNavigate('/bill')
}

async function handleCardPackage() {
  await smartNavigate('/card-package')
}

function handleLogout() {
  logout()
  ElMessage.success('已退出登录')
}

async function handleService(key: string) {
  if (key === 'address') {
    await smartNavigate('/address')
    return
  }
  ElMessage.info('该功能开发中')
}
</script>

<template>
  <section class="app-wrapper bg-[#f3f4f8] py-6 md:py-8">
    <div class="app-content max-w-[920px]">
      <div class="mb-6 rounded-3xl bg-[#eaf2f5] p-6">
        <div class="mb-4 flex flex-wrap items-center justify-between gap-3 md:gap-4">
          <div class="flex min-w-0 flex-1 items-center gap-4">
            <div class="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-white text-4xl shadow-sm">
              👤
            </div>
            <div class="min-w-0">
              <button
                v-if="!isLoggedIn"
                type="button"
                class="text-left text-3xl font-semibold text-black/80"
                @click="handleGoRegister"
              >
                {{ displayName }}
              </button>
              <p
                v-else
                class="truncate text-3xl font-semibold text-black/80"
              >
                {{ displayName }}
              </p>
              <p class="mt-1 line-clamp-2 text-sm text-black/45">
                {{ displaySubText }}
              </p>
            </div>
          </div>
          <button
            v-if="isLoggedIn"
            type="button"
            class="inline-flex shrink-0 items-center gap-2 rounded-full border border-black/[0.08] bg-white px-4 py-2 text-sm font-medium text-black/70 shadow-sm transition hover:bg-black/[0.02]"
            @click="handleLogout"
          >
            <Icon
              name="tabler:logout"
              size="1.05rem"
            />
            退出登录
          </button>
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

        <div class="mb-4 grid grid-cols-3 gap-3 rounded-3xl bg-white p-4 text-center md:gap-4">
          <button
            type="button"
            class="flex flex-col items-center justify-center gap-2 rounded-xl bg-[#fff6f6] px-2 py-5 md:px-3 md:py-6"
            @click="handleBankCard"
          >
            <div class="flex items-center justify-center gap-2">
              <span class="text-lg font-semibold text-black/85 md:text-xl">
                银行卡
              </span>
              <span class="flex h-8 w-8 items-center justify-center rounded-full bg-[#ff8695] text-white md:h-9 md:w-9">
                <Icon
                  name="tabler:credit-card"
                  size="1.1rem"
                />
              </span>
            </div>
            <p class="text-center text-xs leading-snug text-black/50 md:text-sm">
              {{ isLoggedIn ? `已绑定 ${summary.bankCardCount} 张` : '登录后查看' }}
            </p>
          </button>
          <button
            type="button"
            class="flex flex-col items-center justify-center gap-2 rounded-xl bg-[#fff6f6] px-2 py-5 md:px-3 md:py-6"
            @click="handleBill"
          >
            <div class="flex items-center justify-center gap-2">
              <span class="text-lg font-semibold text-black/85 md:text-xl">
                账单
              </span>
              <span class="flex h-8 w-8 items-center justify-center rounded-full bg-[#ff8695] text-white md:h-9 md:w-9">
                <Icon
                  name="tabler:receipt-2"
                  size="1.1rem"
                />
              </span>
            </div>
            <p class="text-center text-xs leading-snug text-black/50 md:text-sm">
              {{ isLoggedIn ? `待还 ¥${summary.billPendingAmount}` : '登录后查看' }}
            </p>
          </button>
          <button
            type="button"
            class="flex flex-col items-center justify-center gap-2 rounded-xl bg-[#fff6f6] px-2 py-5 md:px-3 md:py-6"
            @click="handleCardPackage"
          >
            <div class="flex items-center justify-center gap-2">
              <span class="text-lg font-semibold text-black/85 md:text-xl">
                卡包
              </span>
              <span class="flex h-8 w-8 items-center justify-center rounded-full bg-[#ff8695] text-white md:h-9 md:w-9">
                <Icon
                  name="tabler:gift"
                  size="1.1rem"
                />
              </span>
            </div>
            <p class="text-center text-xs leading-snug text-black/50 md:text-sm">
              {{ isLoggedIn ? (cardPackages.length ? `${cardPackages.length} 个` : '暂无卡包') : '登录后查看' }}
            </p>
          </button>
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
            role="button"
            tabindex="0"
            class="overflow-hidden rounded-2xl bg-white cursor-pointer transition hover:shadow-md"
            @click="handleBuy(item.id, item.name)"
            @keydown.enter.prevent="handleBuy(item.id, item.name)"
          >
            <img
              :src="item.image"
              :alt="item.name"
              class="h-44 w-full object-cover pointer-events-none"
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
                <span
                  class="rounded-md bg-[var(--theme-color)] px-3 py-1.5 text-xs text-white pointer-events-none"
                  aria-hidden="true"
                >
                  购买
                </span>
              </div>
            </div>
          </article>
        </div>
      </div>
    </div>
  </section>
</template>
