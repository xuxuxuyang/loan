<script setup lang="ts">
import IosAccountSecurity from './IosAccountSecurity.vue'
import mallDefaultAvatarUrl from '~/assets/mall-default-avatar.png?url'
import { notifySuccess } from '~/utils/epFeedback'

const route = useRoute()
const { smartNavigate } = useCustomRouting(route)
const { isLoggedIn, loginPhone, profile, syncFromStorage, logout } = useMallAuth()
const { orders } = useMallOrders()
const { summary, addresses, bankCards, cardPackages, billSummary, bills } = useMallMy()
const securityVisible = ref(false)

onMounted(syncFromStorage)

const displayName = computed(() => profile.value?.name || (isLoggedIn.value ? `用户${loginPhone.value.slice(-4)}` : '登录 / 注册'))

async function requireLogin(path: string) {
  if (!isLoggedIn.value) {
    await smartNavigate({ path: '/login', query: { redirect: path } })
    return
  }
  await smartNavigate(path)
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

function signOut() {
  logout()
  notifySuccess('已退出登录')
}
</script>

<template>
  <section class="mx-auto min-h-screen max-w-lg bg-[#f5f3ed] px-4 pb-24 pt-6 text-[#1f2925]">
    <div class="rounded-[28px] bg-[#173f35] p-5 text-white shadow-[0_18px_42px_rgba(23,63,53,.2)]">
      <div class="flex items-center gap-4">
        <img :src="mallDefaultAvatarUrl" alt="头像" class="h-16 w-16 rounded-full border-2 border-white/30 object-cover">
        <button type="button" class="min-w-0 text-left" @click="isLoggedIn ? undefined : smartNavigate('/login')">
          <span class="block truncate text-xl font-semibold">{{ displayName }}</span>
          <span class="mt-1 block text-sm text-white/70">{{ isLoggedIn ? `账号 ${loginPhone}` : '登录后查看订单与卡包' }}</span>
        </button>
      </div>
    </div>

    <div class="mt-5 grid grid-cols-2 gap-3">
      <button type="button" class="rounded-[22px] bg-white p-5 text-left shadow-sm" @click="requireLogin('/orders')"><span class="block text-lg font-semibold">我的订单</span><span class="mt-1 block text-xs text-[#65716b]">查看审核与物流</span></button>
      <button type="button" class="rounded-[22px] bg-white p-5 text-left shadow-sm" @click="requireLogin('/card-package')"><span class="block text-lg font-semibold">卡包合同</span><span class="mt-1 block text-xs text-[#65716b]">审核后继续签署</span></button>
      <button type="button" class="rounded-[22px] bg-white p-5 text-left shadow-sm" @click="requireLogin('/address')"><span class="block text-lg font-semibold">收货地址</span><span class="mt-1 block text-xs text-[#65716b]">管理配送信息</span></button>
      <button type="button" class="rounded-[22px] bg-white p-5 text-left shadow-sm" @click="requireLogin('/bill')"><span class="block text-lg font-semibold">我的账单</span><span class="mt-1 block text-xs text-[#65716b]">查看待还记录</span></button>
    </div>

    <div class="mt-5 overflow-hidden rounded-[24px] bg-white shadow-sm">
      <button type="button" class="flex w-full items-center justify-between border-b border-black/5 px-5 py-4 text-left" @click="smartNavigate('/privacy-policy')"><span>隐私政策</span><span class="text-[#9aa39f]">›</span></button>
      <button v-if="isLoggedIn" type="button" class="flex w-full items-center justify-between border-b border-black/5 px-5 py-4 text-left" @click="securityVisible = true"><span>账号与安全</span><span class="text-[#9aa39f]">›</span></button>
      <button v-if="isLoggedIn" type="button" class="w-full px-5 py-4 text-left text-[#a83f35]" @click="signOut">退出登录</button>
    </div>

    <IosAccountSecurity v-if="securityVisible" :phone="loginPhone" @close="securityVisible = false" @deleted="onDeleted" />
  </section>
</template>
