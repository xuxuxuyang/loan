<script setup lang="ts">
import type { MallOrderStatus } from '~/composables/useMallOrders'
import { formatMallOrderTime } from '~/composables/useMallOrders'
import { normalizeMallAccount } from '~/composables/useMallAuth'

const route = useRoute()
const { smartNavigate } = useCustomRouting(route)
const { orders, syncFromStorage, syncFromRemote } = useMallOrders()
const { loginPhone, profile, syncFromStorage: syncAuthFromStorage } = useMallAuth()

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

const currentUserPhone = computed(() => {
  return normalizeMallAccount(loginPhone.value || profile.value?.phone || '')
})

const userOrders = computed(() => {
  if (!currentUserPhone.value) {
    return []
  }
  return orders.value.filter(item => item.receiverPhone === currentUserPhone.value)
})

const filteredOrders = computed(() => {
  if (activeStatus.value === 'all') {
    return userOrders.value
  }
  return userOrders.value.filter(item => item.status === activeStatus.value)
})

if (import.meta.client) {
  void syncAuthFromStorage()
  syncFromStorage()
  void syncFromRemote()
}

async function goBack() {
  await smartNavigate('/my')
}

async function changeStatus(status: 'all' | MallOrderStatus) {
  if (status === 'all') {
    await smartNavigate('/orders')
    return
  }
  await smartNavigate({
    path: '/orders',
    query: { status },
  })
}

function getStatusStyle(status: MallOrderStatus, paid: boolean, payType: 'installment' | 'full', riskStatus?: 'passed' | 'failed') {
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
  return statusStyleMap[status] || statusStyleMap.reviewing
}

function getStatusLabel(status: MallOrderStatus, paid: boolean, payType: 'installment' | 'full', riskStatus?: 'passed' | 'failed') {
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
  return labelMap[status]
}

function isCardPackageApplicableOrder(item: { status: MallOrderStatus }) {
  return item.status === 'shipping' || item.status === 'receiving' || item.status === 'enjoying'
}

async function goCardPackage() {
  await smartNavigate('/card-package')
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
          商城订单
        </h1>
        <div class="w-[106px]" />
      </div>

      <div class="mb-4 flex flex-wrap gap-2">
        <button
          v-for="item in statusTabs"
          :key="item.key"
          type="button"
          class="rounded-full px-4 py-2 text-sm"
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
          class="rounded-2xl bg-white px-5 py-4 shadow-[0_8px_18px_rgba(24,39,75,0.06)]"
        >
          <div class="mb-2.5 flex items-start justify-between gap-3">
            <p class="min-w-0 flex-1 pr-3 text-[28px] font-semibold leading-[1.2] tracking-[0.01em] text-black/85">
              {{ item.name }}
            </p>
            <div class="flex shrink-0 flex-col items-end gap-1.5">
              <span
                class="rounded-full px-2.5 py-0.5 text-xs font-semibold leading-5"
                :style="getStatusStyle(item.status, item.paid, item.payType, item.riskStatus)"
              >
                {{ getStatusLabel(item.status, item.paid, item.payType, item.riskStatus) }}
              </span>
              <template v-if="isCardPackageApplicableOrder(item)">
                <button
                  v-if="!item.cardPackageIssued"
                  type="button"
                  class="text-sm font-medium text-[#e46a84] underline decoration-[#e46a84]/40 underline-offset-2 hover:opacity-90"
                  @click="goCardPackage"
                >
                  卡包待领取
                </button>
                <span
                  v-else
                  class="text-sm text-black/45"
                >
                  卡片已领取
                </span>
              </template>
            </div>
          </div>
          <p class="mb-1 text-lg leading-[1.45] text-black/60">
            规格：{{ item.spec }}
          </p>
          <p class="text-lg leading-[1.45] text-black/48">
            订单号：{{ item.id }}
          </p>
          <div class="my-3 h-px bg-black/8" />
          <div class="flex items-center justify-between">
            <span class="text-[26px] leading-8 tracking-[0.01em] text-black/52">{{ formatMallOrderTime(item.createdAt) }}</span>
            <span
              class="font-semibold leading-none tracking-[0.01em]"
              style="font-size: 44px; color: #e35a2f;"
            >
              ￥{{ item.totalAmount.toFixed(2) }}
            </span>
          </div>
        </article>

        <div
          v-if="filteredOrders.length === 0"
          class="rounded-2xl bg-white py-10 text-center text-sm text-black/45 shadow-[0_6px_18px_rgba(25,36,60,0.05)]"
        >
          当前状态暂无订单
        </div>
      </div>
    </div>
  </section>
</template>
