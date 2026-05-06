<script setup lang="ts">
import { isAdminTestAccount } from '~/composables/useMallAuth'

const products = useTeaProducts()
const route = useRoute()
const { smartNavigate } = useCustomRouting(route)

const orderStatus = [
  { title: '审核中', icon: 'tabler:clock-bolt', key: 'reviewing' },
  { title: '待发货', icon: 'tabler:clock-hour-4', key: 'shipping' },
  { title: '待收货', icon: 'tabler:truck-delivery', key: 'receiving' },
  { title: '享用中', icon: 'tabler:clipboard-check', key: 'enjoying' },
]

const serviceList = [
  { key: 'address', title: '收货地址', icon: 'tabler:map-pin' },
  { key: 'service', title: '在线客服', icon: 'tabler:message-dots' },
  { key: 'question', title: '常见问题', icon: 'tabler:help-circle' },
  { key: 'download', title: 'App下载', icon: 'tabler:download' },
  { key: 'privacy', title: '隐私政策', icon: 'tabler:lock' },
  { key: 'logout', title: '注销', icon: 'tabler:circle-x' },
]

const { ensureRegistered, isLoggedIn, loginPhone, profile, syncFromStorage, logout } = useMallAuth()
const { summary, fetchSummary } = useMallMy()

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

if (import.meta.client) {
  syncFromStorage()
  if (isLoggedIn.value) {
    void fetchSummary(loginPhone.value)
  }
}

watch([isLoggedIn, loginPhone], async ([loggedIn, phone]) => {
  if (!loggedIn || !phone) {
    return
  }
  await fetchSummary(phone)
})

async function handleGoRegister() {
  await smartNavigate('/login')
}

async function handleBuy(productId: number) {
  const passed = await ensureRegistered()
  if (!passed) {
    return
  }
  await smartNavigate({
    path: '/order-create',
    query: { productId: String(productId) },
  })
}

async function handleBankCard() {
  await smartNavigate('/bank-card')
}

async function handleBill() {
  await smartNavigate('/bill')
}

async function handleOrderAll() {
  await smartNavigate('/orders')
}

async function handleOrderStatus(status: string) {
  await smartNavigate({
    path: '/orders',
    query: { status },
  })
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
  <section class="bg-[#f3f4f8] px-4 pb-5 pt-4">
    <div class="profile-card mb-3 flex items-center gap-3">
      <div class="avatar-shell flex h-14 w-14 items-center justify-center rounded-full bg-white shadow-sm">
        <Icon
          name="tabler:user-filled"
          size="2rem"
          class="text-[#e4869b]"
        />
      </div>
      <div>
        <button
          v-if="!isLoggedIn"
          type="button"
          class="text-[1.55rem] font-semibold leading-none text-[#2a2f3c]"
          @click="handleGoRegister"
        >
          {{ displayName }}
        </button>
        <p
          v-else
          class="text-[1.55rem] font-semibold leading-none text-[#2a2f3c]"
        >
          {{ displayName }}
        </p>
        <p class="mt-1 text-xs text-[#4e5974]">
          {{ displaySubText }}
        </p>
      </div>
    </div>

    <div class="order-card relative mb-3 rounded-2xl p-4">
      <div class="absolute right-0 top-0 rounded-bl-xl rounded-tr-2xl bg-[#ffe4ea] px-3 py-1 text-[11px] text-[#e46a84]">
        {{ isLoggedIn ? '已同步接口账单数据' : '账单还款 请在登录后查看' }}
      </div>
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

    <div class="mb-3 grid grid-cols-2 gap-3 rounded-2xl bg-white p-3 text-center">
      <button
        type="button"
        class="flex items-center justify-between rounded-xl bg-[#fff6f6] px-4 py-3 text-left"
        @click="handleBankCard"
      >
        <p class="text-lg font-semibold text-black/80">
          我的银行卡
        </p>
        <p class="text-xs text-black/50">
          {{ isLoggedIn ? `已绑定 ${summary.bankCardCount} 张` : '登录后查看' }}
        </p>
        <span class="flex h-7 w-7 items-center justify-center rounded-full bg-[#ff8695] text-white">
          <Icon
            name="tabler:credit-card"
            size="0.9rem"
          />
        </span>
      </button>
      <button
        type="button"
        class="flex items-center justify-between rounded-xl bg-[#fff6f6] px-4 py-3 text-left"
        @click="handleBill"
      >
        <p class="text-lg font-semibold text-black/80">
          全部账单
        </p>
        <p class="text-xs text-black/50">
          {{ isLoggedIn ? `待还 ¥${summary.billPendingAmount}` : '登录后查看' }}
        </p>
        <span class="flex h-7 w-7 items-center justify-center rounded-full bg-[#ff8695] text-white">
          <Icon
            name="tabler:receipt-2"
            size="0.9rem"
          />
        </span>
      </button>
    </div>

    <div class="mb-3 rounded-2xl bg-white px-4 py-3">
      <div class="flex items-center justify-between">
        <p class="text-sm text-black/75">
          积分
          <span class="ml-1 font-semibold text-[#dd667d]">{{ isLoggedIn ? summary.points : '--' }}</span>
        </p>
        <p class="text-sm text-black/75">
          优惠券
          <span class="ml-1 font-semibold text-[#dd667d]">{{ isLoggedIn ? `${summary.couponCount}张` : '--' }}</span>
        </p>
      </div>
      <p class="mt-2 line-clamp-1 text-xs text-black/55">
        默认地址：{{ isLoggedIn ? (summary.defaultAddress || '暂未设置默认收货地址') : '登录后查看默认收货地址' }}
      </p>
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

    <div class="mb-4 rounded-2xl bg-white px-3 py-4 text-center normal-font">
      <p class="text-lg leading-6 text-black/65">
        客服电话：<span class="font-semibold text-[#c06b37]">13008962100</span>
      </p>
      <p class="mt-1 text-lg leading-6 text-black/45">
        9:00-18:00
      </p>
    </div>

    <div>
      <div class="mb-3 text-center">
        <h3 class="text-2xl font-semibold text-black/85">
          推荐商品
        </h3>
        <div class="mx-auto mt-1 h-1 w-16 rounded-full bg-[#79d2c7]" />
      </div>
      <div class="grid grid-cols-2 gap-3">
        <article
          v-for="item in products.slice(0, 4)"
          :key="item.id"
          class="overflow-hidden rounded-2xl bg-white"
        >
          <img
            :src="item.image"
            :alt="item.name"
            class="h-28 w-full object-cover"
          >
          <div class="p-2.5">
            <p class="line-clamp-1 text-sm font-semibold text-black/85">
              {{ item.name }}
            </p>
            <p class="mt-1 text-xs text-black/55">
              {{ item.subtitle }}
            </p>
            <div class="mt-2 flex items-center justify-between">
              <p class="text-sm font-semibold text-[#d45a33]">
                ￥{{ item.price }}
              </p>
              <button
                type="button"
                class="rounded-md bg-[var(--theme-color)] px-2 py-1 text-[11px] text-white"
                @click="handleBuy(item.id)"
              >
                购买
              </button>
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

section :is(h3, p, button, span) {
  font-family: "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
  line-height: 1.3;
}
</style>
