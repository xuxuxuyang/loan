<script setup lang="ts">
import { h } from 'vue'
import type { TeaProduct } from '~/composables/useTeaProducts'
import IosAccountSecurity from '~/components/ios/my/IosAccountSecurity.vue'
import mallDefaultAvatarUrl from '~/assets/mall-default-avatar.png?url'
import { MALL_RUNTIME_CONFIG } from '~/config/mallRuntime'
import { useGuardedAppDownload } from '~/composables/useGuardedAppDownload'
import { alertDialog, notifyInfo, notifySuccess } from '~/utils/epFeedback'
import { isIosNativeApp } from '~/utils/iosNativePlatform'
import { isIosBnplReviewHidden } from '~/utils/iosBnplReviewVisibility'

const route = useRoute()
const mallSiteUrl = MALL_RUNTIME_CONFIG.siteUrl || (typeof window !== 'undefined' ? window.location.origin : '')
const { smartNavigate } = useCustomRouting(route)
const { isLoggedIn, loginPhone, profile, syncFromStorage, logout } = useMallAuth()
const { openGuardedAppDownload } = useGuardedAppDownload()
const { orders } = useMallOrders()
const {
  summary,
  addresses,
  bankCards,
  cardPackages,
  billSummary,
  bills,
  fetchSummary,
  fetchCardPackages,
} = useMallMy()
const useIosReviewFlow = isIosNativeApp()
const hideIosBnplForReview = isIosBnplReviewHidden()
const recommendProducts = useTeaProducts({ immediate: !hideIosBnplForReview })
const securityVisible = ref(false)

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

const baseServiceList = [
  { key: 'address', title: '收货地址', icon: 'tabler:map-pin' },
  { key: 'service', title: '在线客服', icon: 'tabler:message-dots' },
  // { key: 'question', title: '常见问题', icon: 'tabler:help-circle' },
  { key: 'privacy', title: '隐私政策', icon: 'tabler:lock' },
  { key: 'download', title: 'App下载', icon: 'tabler:download' },
]

const serviceList = computed(() => [
  ...baseServiceList,
  ...(useIosReviewFlow && isLoggedIn.value
    ? [{ key: 'account-security', title: '账号与安全', icon: 'tabler:shield-lock' }]
    : []),
])

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
    return hideIosBnplForReview ? '订单与账户信息登录后查看' : '账户还款、资产信息登录后查看'
  }
  return `登录账号：${loginPhone.value}`
})

const displayOrderStatus = computed(() => {
  const toneMap = {
    reviewing: 'wv-tone-reviewing',
    shipping: 'wv-tone-shipping',
    receiving: 'wv-tone-receiving',
    enjoying: 'wv-tone-enjoying',
  } as const
  return orderStatus.map(item => ({
    ...item,
    count: isLoggedIn.value
      ? hideIosBnplForReview
        ? orders.value.filter(order => order.payType !== 'installment' && order.status === item.key).length
        : summary.value.orderCount[item.key as keyof typeof summary.value.orderCount]
      : 0,
    tone: toneMap[item.key as keyof typeof toneMap],
  }))
})

if (!import.meta.env.SSR) {
  syncFromStorage()
  if (!hideIosBnplForReview) {
    void ensureMallProductsLoaded()
  }
  if (isLoggedIn.value) {
    void fetchSummary(loginPhone.value)
    if (!hideIosBnplForReview) {
      void fetchCardPackages(loginPhone.value)
    }
  }
}

watch([isLoggedIn, loginPhone], async ([loggedIn, phone]) => {
  if (!loggedIn || !phone) {
    cardPackages.value = []
    return
  }
  await fetchSummary(phone)
  if (!hideIosBnplForReview) {
    await fetchCardPackages(phone)
  }
  else {
    cardPackages.value = []
  }
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

async function onDeleted() {
  securityVisible.value = false
  logout()
  orders.value = []
  addresses.value = []
  bankCards.value = []
  cardPackages.value = []
  bills.value = []
  summary.value = {
    orderCount: { reviewing: 0, shipping: 0, receiving: 0, enjoying: 0 },
    bankCardCount: 0,
    billPendingAmount: 0,
  }
  billSummary.value = {
    shouldRepay: 0,
    totalPending: 0,
    availableQuota: 0,
    billDate: '每月 08 日',
    minRepayment: 0,
  }
  if (!import.meta.env.SSR) {
    localStorage.removeItem('mall-orders')
    localStorage.removeItem('mall_cs_visitor_key')
    localStorage.removeItem('mall_cs_session_id')
    localStorage.removeItem('mall_cs_secret')
    sessionStorage.removeItem('lakala_pending_pay')
  }
  notifySuccess('账号已注销并退出登录')
  await smartNavigate('/login')
}

function isSafariBrowser() {
  if (typeof navigator === 'undefined') {
    return false
  }
  const ua = navigator.userAgent || ''
  return /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|Chrome|Android/i.test(ua)
}

async function showIosPwaGuide() {
  const guideItems = isSafariBrowser()
    ? [
        '打开商城首页',
        '点击 Safari 右下角底部的...',
        '点击“共享”按钮',
        '选择“查看更多”',
        '选择“添加到主屏幕”',
        '桌面即可生成入口',
      ]
    : [
        '请先用 Safari 打开商城',
        `访问 ${mallSiteUrl}`,
        '点击右下角底部的...',
        '点击“共享”按钮',
        '选择“查看更多”',
        '选择“添加到主屏幕”',
        '桌面即可生成入口',
      ]

  await alertDialog(
    h('div', { class: 'mall-pwa-guide' }, [
      h('div', { class: 'mall-pwa-guide__hero' }, [
        h('span', { class: 'mall-pwa-guide__icon' }, '★'),
        h('div', null, [
          h('p', { class: 'mall-pwa-guide__eyebrow' }, '快速变成桌面 App'),
          h('p', { class: 'mall-pwa-guide__intro' }, '添加后，iPhone 桌面会生成“文硕商城”图标，下次打开更方便。'),
        ]),
      ]),
      h('div', { class: 'mall-pwa-guide__steps' }, guideItems.map((item, index) => h('div', { class: 'mall-pwa-guide__step' }, [
        h('span', { class: 'mall-pwa-guide__step-index' }, String(index + 1)),
        h('span', { class: 'mall-pwa-guide__step-text' }, item),
      ]))),
      h('div', { class: 'mall-pwa-guide__note' }, [
        h('span', { class: 'mall-pwa-guide__note-icon' }, '!'),
        h('span', null, '若没看到该选项，请确认是用 Safari 打开。'),
      ]),
    ]),
    'iPhone 添加到主屏幕',
    {
      confirmButtonText: '知道了',
      customClass: 'mall-pwa-guide-dialog',
    },
  )
}

async function handleService(key: string) {
  if (key === 'account-security' && useIosReviewFlow && isLoggedIn.value) {
    securityVisible.value = true
    return
  }
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
    await openGuardedAppDownload({ iosGuide: showIosPwaGuide })
    return
  }
  notifyInfo('该功能开发中')
}
</script>

<template>
  <section
    class="bg-[#f3f4f8] px-4 pb-5"
    style="padding-top: max(1rem, var(--app-safe-area-top));"
  >
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
              :class="item.tone"
            >
            <Icon
              :name="item.icon"
              size="1.2rem"
              class="wv-text-white"
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

    <div
      class="mb-3 grid gap-2 rounded-2xl bg-white p-2.5 sm:gap-3 sm:p-3"
      :class="hideIosBnplForReview ? 'grid-cols-1' : 'grid-cols-3'"
    >
      <!-- App Store 审核期仅在原生 iOS 隐藏；原账单入口继续服务 H5/Android。 -->
      <button
        v-if="!hideIosBnplForReview"
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
      <!-- App Store 审核期仅在原生 iOS 隐藏；原卡包入口继续服务 H5/Android。 -->
      <button
        v-if="!hideIosBnplForReview"
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

    <!-- App Store 审核期仅在原生 iOS 隐藏；原推荐区继续服务 H5/Android。 -->
    <div
      v-if="!hideIosBnplForReview"
      class="normal-font"
    >
      <div class="mb-4 text-center">
        <h3 class="text-2xl font-semibold text-black/85">
          先享后付
        </h3>
        <div class="section-accent-bnpl mx-auto mt-1 h-1 w-16 rounded-full" />
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
                class="wv-gradient-bnpl pointer-events-none shrink-0 rounded-md px-2.5 py-1 text-xs font-medium shadow-sm"
                aria-hidden="true"
              >先享后付</span>
            </div>
          </div>
        </article>
      </div>
    </div>

    <IosAccountSecurity
      v-if="useIosReviewFlow && securityVisible"
      :phone="loginPhone"
      @close="securityVisible = false"
      @deleted="onDeleted"
    />
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

.section-accent-bnpl {
  background: linear-gradient(90deg, #ff8fb3, #ff6e92);
}

section :is(h3, h4, p, button, span) {
  font-family: "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
  line-height: 1.3;
}
:global(.mall-pwa-guide-dialog) {
  width: min(86vw, 390px);
  border: 1px solid rgba(255, 179, 115, 0.3);
  border-radius: 18px;
  background: linear-gradient(180deg, #fffefd 0%, #fff8f1 100%);
  box-shadow: 0 18px 48px rgba(160, 80, 48, 0.2);
  overflow: hidden;
}

:global(.mall-pwa-guide-dialog .el-message-box__header) {
  padding: 18px 20px 8px;
}

:global(.mall-pwa-guide-dialog .el-message-box__title) {
  color: #2f3542;
  font-size: 17px;
  font-weight: 700;
}

:global(.mall-pwa-guide-dialog .el-message-box__content) {
  padding: 8px 20px 4px;
}

:global(.mall-pwa-guide-dialog .el-message-box__btns) {
  padding: 12px 20px 18px;
}

:global(.mall-pwa-guide-dialog .el-button--primary) {
  min-width: 96px;
  border: 0;
  border-radius: 12px;
  background: linear-gradient(135deg, #ff8a45, #ff4f46);
  box-shadow: 0 8px 18px rgba(255, 94, 67, 0.28);
  font-weight: 700;
}

:global(.mall-pwa-guide) {
  color: #3d4658;
  font-family: "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
}

:global(.mall-pwa-guide__hero) {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  border-radius: 14px;
  background: linear-gradient(135deg, rgba(255, 245, 218, 0.95), rgba(255, 237, 228, 0.92));
  padding: 12px;
}

:global(.mall-pwa-guide__icon) {
  display: inline-flex;
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: linear-gradient(135deg, #ffd56a, #ff8a3d);
  color: #fff;
  font-size: 15px;
  box-shadow: 0 7px 14px rgba(245, 142, 42, 0.28);
}

:global(.mall-pwa-guide__eyebrow) {
  margin: 0 0 4px;
  color: #d76b26;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.02em;
}

:global(.mall-pwa-guide__intro) {
  margin: 0;
  color: #596172;
  font-size: 13px;
  line-height: 1.65;
}

:global(.mall-pwa-guide__steps) {
  display: grid;
  gap: 8px;
  margin-top: 12px;
}

:global(.mall-pwa-guide__step) {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  border: 1px solid rgba(255, 152, 82, 0.18);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.78);
  padding: 9px 10px;
}

:global(.mall-pwa-guide__step-index) {
  display: inline-flex;
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: #fff0df;
  color: #f06b30;
  font-size: 12px;
  font-weight: 800;
}

:global(.mall-pwa-guide__step-text) {
  color: #303846;
  font-size: 13px;
  line-height: 1.65;
}

:global(.mall-pwa-guide__note) {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  margin-top: 12px;
  border-radius: 12px;
  background: #fff3e8;
  padding: 9px 10px;
  color: #b95d22;
  font-size: 12.5px;
  line-height: 1.55;
}

:global(.mall-pwa-guide__note-icon) {
  display: inline-flex;
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: #ffc86a;
  color: #fff;
  font-size: 12px;
  font-weight: 900;
}

</style>
