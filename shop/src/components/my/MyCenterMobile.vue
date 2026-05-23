<script setup lang="ts">
import type { TeaProduct } from '~/composables/useTeaProducts'
import mallDefaultAvatarUrl from '~/assets/mall-default-avatar.png?url'
import { notifyInfo, notifySuccess } from '~/utils/epFeedback'

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
  { title: '审核中', icon: 'tabler:clock-bolt', key: 'reviewing' },
  { title: '待发货', icon: 'tabler:clock-hour-4', key: 'shipping' },
  { title: '待收货', icon: 'tabler:truck-delivery', key: 'receiving' },
  { title: '已完成', icon: 'tabler:clipboard-check', key: 'enjoying' },
]

const serviceList = [
  { key: 'address', title: '收货地址', icon: 'tabler:map-pin' },
  { key: 'service', title: '在线客服', icon: 'tabler:message-dots' },
  // { key: 'question', title: '常见问题', icon: 'tabler:help-circle' },
  { key: 'privacy', title: '隐私政策', icon: 'tabler:lock' },
  { key: 'download', title: 'App下载', icon: 'tabler:download' },
  
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
  const toneMap = {
    reviewing: 'from-[#7f8cf6] to-[#6aa9ff]',
    shipping: 'from-[#f6a54e] to-[#ff7f63]',
    receiving: 'from-[#38b2ac] to-[#4fd1c5]',
    enjoying: 'from-[#e879f9] to-[#f472b6]',
  } as const
  return orderStatus.map(item => ({
    ...item,
    count: isLoggedIn.value
      ? summary.value.orderCount[item.key as keyof typeof summary.value.orderCount]
      : 0,
    tone: toneMap[item.key as keyof typeof toneMap],
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

async function handleGoRegister() {
  await smartNavigate('/login')
}

async function openProductDetail(item: TeaProduct) {
  await smartNavigate({
    path: `/product/${item.id}`,
  })
}

async function handleBankCard() {
  if (!isLoggedIn.value) {
    await smartNavigate('/login')
    return
  }
  await smartNavigate('/bank-card')
}

async function handleCardPackage() {
  if (!isLoggedIn.value) {
    await smartNavigate('/login')
    return
  }
  await smartNavigate('/card-package')
}

async function handleBill() {
  if (!isLoggedIn.value) {
    await smartNavigate('/login')
    return
  }
  await smartNavigate('/bill')
}

async function handleOrderAll() {
  if (!isLoggedIn.value) {
    await smartNavigate('/login')
    return
  }
  await smartNavigate('/orders')
}

async function handleOrderStatus(status: string) {
  if (!isLoggedIn.value) {
    await smartNavigate('/login')
    return
  }
  await smartNavigate({
    path: '/orders',
    query: { status },
  })
}

function handleLogout() {
  logout()
  notifySuccess('已退出登录')
}

async function handleService(key: string) {
  /** 收货地址需登录；在线客服允许访客会话，不校验 */
  if (key === 'address' && !isLoggedIn.value) {
    await smartNavigate('/login')
    return
  }
  if (key === 'address') {
    await smartNavigate('/address')
    return
  }
  if (key === 'service') {
    await smartNavigate('/cs-chat')
    return
  }
  if (key === 'privacy') {
    await smartNavigate('/privacy-policy')
    return
  }
  if (key === 'download') {
    const apkUrl = String(import.meta.env.VITE_MALL_APP_APK_URL || '').trim()
    if (!apkUrl) {
      notifyInfo('暂未配置安装包下载地址')
      return
    }
    window.open(apkUrl, '_blank', 'noopener,noreferrer')
    return
  }
  notifyInfo('该功能开发中')
}
</script>

<template>
  <section class="bg-[#f3f4f8] px-4 pb-5 pt-4">
    <div class="profile-card mb-3 flex items-center gap-2 sm:gap-3">
      <div class="flex min-w-0 flex-1 items-center gap-3">
        <div
          class="avatar-shell flex h-14 w-14 shrink-0 overflow-hidden rounded-full bg-white shadow-sm ring-1 ring-black/[0.06]"
          aria-hidden="true"
        >
          <img
            :src="mallDefaultAvatarUrl"
            alt=""
            width="56"
            height="56"
            class="h-full w-full object-cover"
            decoding="async"
          >
        </div>
        <div class="min-w-0 flex-1">
          <button
            v-if="!isLoggedIn"
            type="button"
            class="login-entry flex w-full min-w-0 items-center justify-between gap-3 py-1 text-left transition [--login-cta-shadow:0_4px_14px_rgba(232,90,122,0.32)] active:scale-[0.99] active:[--login-cta-shadow:0_2px_8px_rgba(232,90,122,0.28)]"
            aria-label="去登录或注册"
            @click="handleGoRegister"
          >
            <div class="min-w-0 flex-1 pr-1">
              <span class="block text-[1.4rem] font-semibold leading-tight tracking-tight text-[#2a2f3c] sm:text-[1.5rem]">
                {{ displayName }}
              </span>
              <span class="mt-1.5 block line-clamp-2 text-[13px] leading-snug text-[#5f6a82]">
                {{ displaySubText }}
              </span>
            </div>
            <span
              class="login-entry-cta flex shrink-0 items-center gap-0.5 pl-3 pr-2.5 py-2"
              aria-hidden="true"
            >
              <span class="text-[13px] font-semibold leading-none tracking-wide">去登录</span>
              <Icon
                name="tabler:chevron-right"
                size="1.05rem"
                class="shrink-0 opacity-95"
                stroke-width="2.25"
              />
            </span>
          </button>
          <template v-else>
            <p class="truncate text-[1.55rem] font-semibold leading-none text-[#2a2f3c]">
              {{ displayName }}
            </p>
            <p class="mt-1 line-clamp-2 text-xs text-[#4e5974]">
              {{ displaySubText }}
            </p>
          </template>
        </div>
      </div>
      <button
        v-if="isLoggedIn"
        type="button"
        class="flex shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl px-2.5 py-2 text-[#e46a84] transition active:scale-[0.98] hover:bg-white/60"
        @click="handleLogout"
      >
        <Icon
          name="tabler:logout"
          size="1.25rem"
        />
        <span class="text-[10px] font-medium leading-none">退出</span>
      </button>
    </div>

    <div class="order-card mb-3 rounded-2xl p-4">
      <div class="mb-4 flex items-center justify-between">
        <h3 class="text-[1.75rem] font-semibold text-[#2a2f3c]">
          商城订单
        </h3>
        <button
          type="button"
          class="text-lg text-[#727f96]"
          @click="handleOrderAll"
        >
          全部 >
        </button>
      </div>
      <div class="grid grid-cols-4 gap-2 text-center">
        <button
          v-for="item in displayOrderStatus"
          :key="item.title"
          type="button"
          class="order-status-item py-2"
          @click="handleOrderStatus(item.key)"
        >
          <div class="mb-1 flex justify-center">
            <span
              class="status-icon"
              :class="`bg-gradient-to-br ${item.tone}`"
            >
            <Icon
              :name="item.icon"
              size="1.2rem"
              class="text-white"
            />
            </span>
          </div>
          <p class="text-[15px] text-[#48546b]">
            {{ item.title }}
          </p>
          <p class="mt-0.5 text-xs font-semibold text-[#e46a7f]">
            {{ item.count }}
          </p>
        </button>
      </div>
    </div>

    <div class="mb-3 grid grid-cols-3 gap-2 rounded-2xl bg-white p-2.5 sm:gap-3 sm:p-3">
      <button
        type="button"
        class="flex min-h-[5rem] flex-col items-center justify-center gap-1.5 rounded-xl bg-[#fff6f6] px-1.5 py-3 text-center active:opacity-90 sm:min-h-[5.25rem] sm:py-3.5"
        @click="handleBankCard"
      >
        <div class="flex items-center justify-center gap-1.5">
          <span class="text-sm font-semibold leading-none text-black/85 sm:text-[0.95rem]">
            银行卡
          </span>
          <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#ff8695] text-white">
            <Icon
              name="tabler:credit-card"
              size="0.95rem"
            />
          </span>
        </div>
        <p class="max-w-full px-0.5 text-center text-[11px] leading-snug text-black/50 sm:text-xs">
          {{ isLoggedIn ? `已绑定 ${summary.bankCardCount} 张` : '登录后查看' }}
        </p>
      </button>
      <button
        type="button"
        class="flex min-h-[5rem] flex-col items-center justify-center gap-1.5 rounded-xl bg-[#fff6f6] px-1.5 py-3 text-center active:opacity-90 sm:min-h-[5.25rem] sm:py-3.5"
        @click="handleBill"
      >
        <div class="flex items-center justify-center gap-1.5">
          <span class="text-sm font-semibold leading-none text-black/85 sm:text-[0.95rem]">
            账单
          </span>
          <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#ff8695] text-white">
            <Icon
              name="tabler:receipt-2"
              size="0.95rem"
            />
          </span>
        </div>
        <p class="max-w-full px-0.5 text-center text-[11px] leading-snug text-black/50 sm:text-xs">
          {{ isLoggedIn ? `待还 ¥${Number(summary.billPendingAmount ?? 0).toFixed(2)}` : '登录后查看' }}
        </p>
      </button>
      <button
        type="button"
        class="flex min-h-[5rem] flex-col items-center justify-center gap-1.5 rounded-xl bg-[#fff6f6] px-1.5 py-3 text-center active:opacity-90 sm:min-h-[5.25rem] sm:py-3.5"
        @click="handleCardPackage"
      >
        <div class="flex items-center justify-center gap-1.5">
          <span class="text-sm font-semibold leading-none text-black/85 sm:text-[0.95rem]">
            卡包
          </span>
          <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#ff8695] text-white">
            <Icon
              name="tabler:gift"
              size="0.95rem"
            />
          </span>
        </div>
        <p class="max-w-full px-0.5 text-center text-[11px] leading-snug text-black/50 sm:text-xs">
          {{ isLoggedIn ? (cardPackages.length ? `${cardPackages.length} 个` : '暂无卡包') : '登录后查看' }}
        </p>
      </button>
    </div>

    <div class="mb-3 rounded-2xl bg-white p-4">
      <h3 class="mb-3 flex items-center text-[1.75rem] font-semibold text-black/85">
        <span class="mr-2 h-3 w-1 rounded bg-[#ff9ea9]" />
        其他服务
      </h3>
      <div class="grid grid-cols-4 gap-3">
        <button
          v-for="item in serviceList"
          :key="item.title"
          type="button"
          class="text-center"
          @click="handleService(item.key)"
        >
          <div class="mx-auto mb-1 flex h-10 w-10 items-center justify-center rounded-lg bg-[#ff6678] text-white">
            <Icon
              :name="item.icon"
              size="1rem"
            />
          </div>
          <p class="text-[14px] text-black/75">
            {{ item.title }}
          </p>
        </button>
      </div>
    </div>

    <!-- <div class="mb-4 rounded-2xl bg-white px-3 py-4 text-center normal-font">
      <p class="text-lg leading-6 text-black/65">
        客服电话：<span class="font-semibold text-[#c06b37]">18968327662</span>
      </p>
      <p class="mt-1 text-lg leading-6 text-black/45">
        9:00-18:00
      </p>
    </div> -->

    <div class="normal-font">
      <div class="mb-4 text-center">
        <h3 class="text-2xl font-semibold text-black/85">
          先享后付
        </h3>
        <div class="mx-auto mt-1 h-1 w-16 rounded-full bg-gradient-to-r from-[#ff8fb3] to-[#ff6e92]" />
      </div>
      <div class="grid grid-cols-2 items-stretch gap-3">
        <article
          v-for="item in sortedRecommendProducts.slice(0, 4)"
          :key="item.id"
          role="button"
          tabindex="0"
          class="product-card flex h-full flex-col cursor-pointer overflow-hidden rounded-xl border border-black/10 bg-white transition active:scale-[0.99]"
          @click="openProductDetail(item)"
          @keydown.enter.prevent="openProductDetail(item)"
        >
          <div class="product-card-media relative aspect-[4/3] w-full shrink-0 overflow-hidden bg-[#f6f8fb]">
            <img
              :src="item.image"
              :alt="item.name"
              class="pointer-events-none absolute inset-0 h-full w-full object-cover"
              loading="lazy"
              decoding="async"
              referrerpolicy="no-referrer"
              @error="onMallProductImageError($event, item.name)"
            >
          </div>
          <div class="flex flex-1 flex-col p-3">
            <h4 class="line-clamp-1 min-h-[1.25rem] text-sm font-semibold leading-5 text-black/85">
              {{ item.name }}
            </h4>
            <p class="mb-2 line-clamp-1 min-h-[1.125rem] text-xs leading-[1.125rem] text-black/60">
              {{ item.subtitle }}
            </p>
            <div class="mt-auto flex items-center justify-between gap-1">
              <span class="text-sm font-semibold leading-5 text-[#e85a7a]">￥{{ item.price }}</span>
              <span
                class="pointer-events-none shrink-0 rounded-md bg-gradient-to-br from-[#ff8fb3] to-[#ff6e92] px-2.5 py-1 text-xs font-medium text-white shadow-sm"
                aria-hidden="true"
              >先享后付</span>
            </div>
          </div>
        </article>
      </div>
    </div>
  </section>
</template>

<style scoped>
.normal-font {
  font-family: "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
}

.profile-card {
  padding: 14px 12px;
  border-radius: 16px;
  background: linear-gradient(135deg, #fff4f7, #eef6ff);
  border: 1px solid rgba(236, 141, 164, 0.22);
  box-shadow: 0 10px 24px rgba(120, 140, 220, 0.12);
}

.login-entry:focus-visible {
  outline: 2px solid rgba(228, 106, 132, 0.5);
  outline-offset: 2px;
}

.login-entry-cta {
  border-radius: 999px;
  color: #fff;
  background: linear-gradient(135deg, #ff93a8 0%, #ff6e8e 48%, #ff5c7c 100%);
  box-shadow: var(--login-cta-shadow);
  border: 1px solid rgba(255, 255, 255, 0.35);
}

.avatar-shell {
  position: relative;
}

.avatar-shell::after {
  content: "";
  position: absolute;
  inset: -3px;
  border-radius: 999px;
  background: linear-gradient(135deg, rgba(248, 145, 174, 0.45), rgba(126, 196, 255, 0.45));
  z-index: -1;
}

.order-card {
  background: linear-gradient(180deg, #ffffff, #fff8fb);
  border: 1px solid rgba(235, 139, 167, 0.2);
  box-shadow: 0 8px 22px rgba(222, 131, 161, 0.1);
}

.order-status-item {
  border-radius: 12px;
  transition: all 0.2s ease;
}

.order-status-item:active {
  transform: scale(0.98);
}

.status-icon {
  display: flex;
  width: 34px;
  height: 34px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  box-shadow: 0 6px 12px rgba(118, 132, 210, 0.25);
}

section :is(h3, h4, p, button, span) {
  font-family: "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
  line-height: 1.3;
}
</style>
