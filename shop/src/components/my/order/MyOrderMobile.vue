<script setup lang="ts">
import { ref, watch } from 'vue'
import type { MallOrder, MallOrderStatus } from '~/composables/useMallOrders'
import {
  effectiveMallOrderStatus,
  formatMallOrderTime,
  mallOrderBelongsToLoggedIn,
  normalizeOrderTrackingNumber,
  orderHasShippedTracking,
  trackingNumberThirdPartyLookupUrl,
} from '~/composables/useMallOrders'
import { notifyInfo, notifySuccess } from '~/utils/epFeedback'

const route = useRoute()
const { smartNavigate } = useCustomRouting(route)
const { orders, syncFromStorage, syncFromRemote } = useMallOrders()
const { profile, syncFromStorage: syncAuthFromStorage } = useMallAuth()
const products = useTeaProducts()

const statusStyleMap: Record<MallOrderStatus, { color: string, backgroundColor: string }> = {
  reviewing: {
    color: '#0c8a7e',
    backgroundColor: '#e9f8f4',
  },
  shipping: {
    color: '#c27a1d',
    backgroundColor: '#fff6e9',
  },
  receiving: {
    color: '#2b73c9',
    backgroundColor: '#edf5ff',
  },
  enjoying: {
    color: '#7a56cc',
    backgroundColor: '#f2edff',
  },
}

const statusTabs: Array<{ key: 'all' | MallOrderStatus, label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'reviewing', label: '待审核' },
  { key: 'shipping', label: '待发货' },
  { key: 'receiving', label: '待收货' },
  { key: 'enjoying', label: '已完成' },
]

const activeStatus = computed<'all' | MallOrderStatus>(() => {
  const rawStatus = String(route.query.status || 'all')
  return statusTabs.some(item => item.key === rawStatus) ? rawStatus as 'all' | MallOrderStatus : 'all'
})

const userOrders = computed(() => {
  if (!profile.value?.id) {
    return []
  }
  return orders.value.filter(item => mallOrderBelongsToLoggedIn(item, profile.value?.id))
})

const filteredOrders = computed(() => {
  if (activeStatus.value === 'all') {
    return userOrders.value
  }
  return userOrders.value.filter(item => effectiveMallOrderStatus(item) === activeStatus.value)
})

if (!import.meta.env.SSR) {
  void syncAuthFromStorage()
  syncFromStorage()
}

watch(
  () => String(route.query.status ?? 'all'),
  () => {
    if (!import.meta.env.SSR) {
      void syncFromRemote()
    }
  },
  { immediate: true },
)

async function goBack() {
  await smartNavigate('/my')
}

async function changeStatus(status: 'all' | MallOrderStatus) {
  if (status === 'all') {
    await smartNavigate('/orders')
  }
  else {
    await smartNavigate({
      path: '/orders',
      query: { status },
    })
  }
  await syncFromRemote()
}

function getStatusStyle(item: MallOrder) {
  const { status, paid, payType, riskStatus } = item
  if (status === 'reviewing' && payType === 'installment' && riskStatus === 'failed') {
    return {
      color: '#c62f2f',
      backgroundColor: '#ffecec',
    }
  }
  if (status === 'reviewing' && payType === 'installment') {
    return {
      color: '#bd6a00',
      backgroundColor: '#fff4e5',
    }
  }
  if (status === 'reviewing' && !paid) {
    return {
      color: '#bd6a00',
      backgroundColor: '#fff4e5',
    }
  }
  const display = effectiveMallOrderStatus(item)
  return statusStyleMap[display] || statusStyleMap.reviewing
}

function getStatusLabel(item: MallOrder) {
  const { status, paid, payType, riskStatus } = item
  if (status === 'reviewing' && payType === 'installment' && riskStatus === 'failed') {
    return '审核未通过'
  }
  if (status === 'reviewing' && payType === 'installment') {
    return '待审核'
  }
  if (status === 'reviewing' && !paid) {
    return '待支付'
  }
  const labelMap: Record<MallOrderStatus, string> = {
    reviewing: '待审核',
    shipping: '待发货',
    receiving: '待收货',
    enjoying: '已完成',
  }
  return labelMap[effectiveMallOrderStatus(item)]
}

function isGarbledText(value: string) {
  const text = String(value || '').trim()
  if (!text) {
    return true
  }
  return text.includes('�')
}

function getFallbackProduct(productId: number) {
  return products.value.find(item => item.id === productId)
}

function getDisplayOrderName(item: (typeof filteredOrders.value)[number]) {
  if (!isGarbledText(item.name)) {
    return item.name
  }
  return getFallbackProduct(item.productId)?.name || `商品${item.productId}`
}

function getDisplayOrderSpec(item: (typeof filteredOrders.value)[number]) {
  if (!isGarbledText(item.spec)) {
    return item.spec
  }
  return getFallbackProduct(item.productId)?.subtitle || '规格信息待更新'
}

/** 与接口 isOrderCardPackageEligible 一致：待发货/待收货/已完成才展示卡包状态 */
function isCardPackageApplicableOrder(item: MallOrder) {
  if (item.payType !== 'installment') {
    return false
  }
  const display = effectiveMallOrderStatus(item)
  return display === 'shipping' || display === 'receiving' || display === 'enjoying'
}

async function goCardPackage() {
  await smartNavigate('/card-package')
}

async function copyTrackingNumber(no: string | undefined) {
  const text = normalizeOrderTrackingNumber(no)
  if (!text) {
    return
  }
  try {
    await navigator.clipboard.writeText(text)
    notifySuccess('快递单号已复制')
  }
  catch {
    notifyInfo(`请长按复制单号：${text}`)
  }
}

const trackingLookupVisible = ref(false)
const trackingLookupNo = ref('')

function openTrackingLookupDialog(trackingRaw: string | undefined) {
  const text = normalizeOrderTrackingNumber(trackingRaw)
  if (!text) {
    return
  }
  trackingLookupNo.value = text
  trackingLookupVisible.value = true
}

function closeTrackingLookupDialog() {
  trackingLookupVisible.value = false
}

function confirmOpenKuaidi100() {
  if (!import.meta.env.SSR) {
    window.open(trackingNumberThirdPartyLookupUrl(), '_blank', 'noopener,noreferrer')
  }
  closeTrackingLookupDialog()
}

function onTrackingLookupDialogClosed() {
  trackingLookupNo.value = ''
}
</script>

<template>
  <section class="px-4 pb-6 pt-4">
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
        商城订单
      </h1>
      <div class="w-9" />
    </div>

    <div class="mb-3 flex gap-2 overflow-x-auto pb-1">
      <button
        v-for="item in statusTabs"
        :key="item.key"
        type="button"
        class="shrink-0 rounded-full px-3 py-1.5 text-xs"
        :class="activeStatus === item.key ? 'bg-[var(--theme-color)] text-white' : 'bg-white text-black/65'"
        @click="changeStatus(item.key)"
      >
        {{ item.label }}
      </button>
    </div>

    <div class="space-y-3.5">
      <article
        v-for="item in filteredOrders"
        :key="item.id"
        class="rounded-2xl bg-white px-4 py-3 shadow-[0_8px_18px_rgba(24,39,75,0.06)]"
      >
        <div class="mb-2.5 flex items-start justify-between gap-2">
          <p class="line-clamp-1 flex-1 pr-2 text-[20px] font-semibold leading-[1.2] tracking-[0.01em] text-black/85">
            {{ getDisplayOrderName(item) }}
          </p>
          <div class="flex shrink-0 flex-col items-end gap-1">
            <span
              class="rounded-full px-2.5 py-0.5 text-xs font-semibold leading-5"
              :style="getStatusStyle(item)"
            >
              {{ getStatusLabel(item) }}
            </span>
            <template v-if="isCardPackageApplicableOrder(item)">
              <button
                v-if="!item.cardPackageIssued"
                type="button"
                class="text-right text-[11px] font-medium text-[#e46a84] underline decoration-[#e46a84]/50 underline-offset-2 active:opacity-80"
                @click="goCardPackage"
              >
                卡包待领取
              </button>
              <span
                v-else
                class="text-[11px] font-medium text-black/45"
              >
                卡包已领取
              </span>
            </template>
          </div>
        </div>
        <p class="mb-1 text-[15px] leading-[1.45] text-black/60">
          规格：{{ getDisplayOrderSpec(item) }}
        </p>
        <p class="text-[15px] leading-[1.45] text-black/48">
          订单号：{{ item.id }}
        </p>
        <div
          v-if="orderHasShippedTracking(item)"
          class="mt-3 rounded-xl bg-[#f7f8fb] px-3 py-2.5"
        >
          <div class="flex items-start justify-between gap-2">
            <p class="min-w-0 flex-1 text-[13px] leading-[1.45] text-black/70">
              <span class="text-black/45">快递单号</span>
              <br>
              <span class="font-mono text-[14px] font-semibold text-black/85">{{ normalizeOrderTrackingNumber(item.trackingNumber) }}</span>
            </p>
            <button
              type="button"
              class="shrink-0 rounded-lg bg-white px-2.5 py-1 text-[12px] font-medium text-[var(--theme-color)] shadow-sm active:opacity-80"
              @click="copyTrackingNumber(item.trackingNumber)"
            >
              复制
            </button>
          </div>
          <button
            type="button"
            class="mt-2 inline-flex items-center border-0 bg-transparent p-0 text-[13px] font-medium text-[var(--theme-color)] underline decoration-[var(--theme-color)]/45 underline-offset-2 active:opacity-80"
            @click="openTrackingLookupDialog(item.trackingNumber)"
          >
            物流信息查询
          </button>
        </div>
        <div class="my-2.5 h-px bg-black/8" />
        <div class="flex items-center justify-between">
          <span class="text-[16px] leading-6 tracking-[0.01em] text-black/52">{{ formatMallOrderTime(item.createdAt) }}</span>
          <span
            class="font-semibold leading-none tracking-[0.01em]"
            style="color: #e35a2f;"
          >
            ￥{{ item.totalAmount.toFixed(2) }}
          </span>
        </div>
      </article>

      <div
        v-if="filteredOrders.length === 0"
        class="rounded-2xl bg-white py-8 text-center text-sm text-black/45 shadow-[0_6px_18px_rgba(25,36,60,0.05)]"
      >
        当前状态暂无订单
      </div>
    </div>

    <el-dialog
      v-model="trackingLookupVisible"
      title="查询物流"
      width="min(92vw, 340px)"
      align-center
      append-to-body
      :close-on-click-modal="false"
      class="mall-tracking-lookup-dialog"
      @closed="onTrackingLookupDialogClosed"
    >
      <div class="space-y-3 text-sm leading-relaxed text-black/78">
        <p>
          即将跳转快递100，请先<strong class="font-semibold text-black/88">复制下方单号</strong>，打开网页后在搜索框粘贴查询。
        </p>
        <div class="rounded-xl bg-[#f7f8fb] px-3 py-2.5">
          <p class="mb-1 text-[11px] text-black/45">
            快递单号
          </p>
          <p class="break-all font-mono text-[15px] font-semibold text-black/88">
            {{ trackingLookupNo }}
          </p>
        </div>
        <el-button
          type="primary"
          plain
          class="w-full"
          @click="copyTrackingNumber(trackingLookupNo)"
        >
          复制单号
        </el-button>
      </div>
      <template #footer>
        <div class="flex flex-wrap justify-end gap-2">
          <el-button @click="closeTrackingLookupDialog">
            取消
          </el-button>
          <el-button
            type="primary"
            @click="confirmOpenKuaidi100"
          >
            前往快递100
          </el-button>
        </div>
      </template>
    </el-dialog>
  </section>
</template>
