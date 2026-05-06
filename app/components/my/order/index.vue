<script setup lang="ts">
const route = useRoute()
const { smartNavigate } = useCustomRouting(route)

type OrderStatus = 'reviewing' | 'shipping' | 'receiving' | 'enjoying'

interface OrderItem {
  id: string
  name: string
  spec: string
  amount: string
  time: string
  status: OrderStatus
  statusLabel: string
}

const statusStyleMap: Record<OrderStatus, { color: string, backgroundColor: string }> = {
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

const statusTabs: Array<{ key: 'all' | OrderStatus, label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'reviewing', label: '审核中' },
  { key: 'shipping', label: '待发货' },
  { key: 'receiving', label: '待收货' },
  { key: 'enjoying', label: '享用中' },
]

const mockOrders: OrderItem[] = [
  { id: 'OD20260506001', name: '武夷岩茶礼盒', spec: '大红袍 250g', amount: '￥368.00', time: '2026-05-06 09:25', status: 'reviewing', statusLabel: '审核中' },
  { id: 'OD20260504032', name: '安溪铁观音', spec: '清香型 200g', amount: '￥228.00', time: '2026-05-04 16:11', status: 'shipping', statusLabel: '待发货' },
  { id: 'OD20260502017', name: '白毫银针', spec: '福鼎 150g', amount: '￥499.00', time: '2026-05-02 10:58', status: 'receiving', statusLabel: '待收货' },
  { id: 'OD20260429106', name: '凤凰单丛', spec: '蜜兰香 125g', amount: '￥188.00', time: '2026-04-29 21:06', status: 'enjoying', statusLabel: '享用中' },
  { id: 'OD20260425133', name: '龙井春茶', spec: '明前 100g', amount: '￥329.00', time: '2026-04-25 14:43', status: 'shipping', statusLabel: '待发货' },
]

const activeStatus = computed<'all' | OrderStatus>(() => {
  const rawStatus = String(route.query.status || 'all')
  return statusTabs.some(item => item.key === rawStatus) ? rawStatus as 'all' | OrderStatus : 'all'
})

const filteredOrders = computed(() => {
  if (activeStatus.value === 'all') {
    return mockOrders
  }
  return mockOrders.filter(item => item.status === activeStatus.value)
})

async function goBack() {
  await smartNavigate('/my')
}

async function changeStatus(status: 'all' | OrderStatus) {
  if (status === 'all') {
    await smartNavigate('/orders')
    return
  }
  await smartNavigate({
    path: '/orders',
    query: { status },
  })
}

function getStatusStyle(status: OrderStatus) {
  return statusStyleMap[status] || statusStyleMap.reviewing
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
          <div class="mb-2.5 flex items-center justify-between">
            <p class="pr-3 text-[28px] font-semibold leading-[1.2] tracking-[0.01em] text-black/85">
              {{ item.name }}
            </p>
            <span
              class="shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold leading-5"
              :style="getStatusStyle(item.status)"
            >
              {{ item.statusLabel }}
            </span>
          </div>
          <p class="mb-1 text-lg leading-[1.45] text-black/60">
            规格：{{ item.spec }}
          </p>
          <p class="text-lg leading-[1.45] text-black/48">
            订单号：{{ item.id }}
          </p>
          <div class="my-3 h-px bg-black/8" />
          <div class="flex items-center justify-between">
            <span class="text-[26px] leading-8 tracking-[0.01em] text-black/52">{{ item.time }}</span>
            <span
              class="font-semibold leading-none tracking-[0.01em]"
              style="font-size: 44px; color: #e35a2f;"
            >
              {{ item.amount }}
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
