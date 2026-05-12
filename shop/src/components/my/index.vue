<script setup lang="ts">
import type { TeaProduct } from '~/composables/useTeaProducts'

const route = useRoute()
const { smartNavigate } = useCustomRouting(route)
const { isLoggedIn, loginPhone, profile, syncFromStorage, logout } = useMallAuth()
const { summary, fetchSummary, cardPackages, fetchCardPackages } = useMallMy()
const recommendProducts = useTeaProducts()

/** 「我的」页先享后付推荐：按订单展示价（price）升序，再取前 4 个 */
const sortedRecommendProducts = computed(() => {
  const list = recommendProducts.value ?? []
  return [...list].sort((a, b) => {
    const pa = Number(a.price)
    const pb = Number(b.price)
    return (Number.isFinite(pa) ? pa : 0) - (Number.isFinite(pb) ? pb : 0)
  })
})

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
  return `用户${loginPhone.value.slice(-4)}`
})

const displaySubText = computed(() => {
  if (!isLoggedIn.value) {
    return '账户还款、资产信息登录后查看'
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

if (!import.meta.env.SSR) {
  syncFromStorage()
  void ensureMallProductsLoaded()
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

async function openProductDetail(item: TeaProduct) {
  await smartNavigate({
    path: `/product/${item.id}`,
  })
}

async function handleGoRegister() {
  await smartNavigate('/login')
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

      <div class="normal-font">
        <div class="mb-6 md:mb-8">
          <p class="mb-2 text-sm uppercase tracking-[0.2em] text-[#e85a7a]">
            Installment
          </p>
          <h3 class="text-2xl font-semibold text-black/85 md:text-3xl">
            先享后付
          </h3>
        </div>
        <div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <article
            v-for="item in sortedRecommendProducts.slice(0, 4)"
            :key="item.id"
            role="button"
            tabindex="0"
            class="cursor-pointer overflow-hidden rounded-2xl border border-black/10 bg-white transition hover:-translate-y-1 hover:shadow-xl"
            @click="openProductDetail(item)"
            @keydown.enter.prevent="openProductDetail(item)"
          >
            <img
              :src="item.image"
              :alt="item.name"
              class="pointer-events-none h-56 w-full object-cover"
              loading="lazy"
              decoding="async"
              referrerpolicy="no-referrer"
              @error="onMallProductImageError($event, item.name)"
            >
            <div class="p-5">
              <p class="mb-2 text-xs text-black/50">
                产地：{{ item.origin }}
              </p>
              <h4 class="mb-1 text-lg font-semibold text-black/85">
                {{ item.name }}
              </h4>
              <p class="mb-3 text-sm text-black/70">
                {{ item.subtitle }}
              </p>
              <p class="mb-4 line-clamp-2 min-h-10 text-sm text-black/60">
                {{ item.description }}
              </p>
              <div class="flex items-center justify-between">
                <span class="text-xl font-semibold text-[#e85a7a]">￥{{ item.price }}</span>
                <span
                  class="pointer-events-none rounded-lg bg-gradient-to-br from-[#ff8fb3] to-[#ff6e92] px-4 py-2 text-sm font-medium text-white shadow-sm"
                  aria-hidden="true"
                >先享后付</span>
              </div>
            </div>
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
</style>
