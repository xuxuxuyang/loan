<script setup lang="ts">
import { Refresh } from '@element-plus/icons-vue'
import { computed, onMounted, ref } from 'vue'
import { useOrdersStore } from '../stores/useOrdersStore'

const { orders, fetchOrders } = useOrdersStore()

const loading = ref(false)

function formatLocalYmd(d: Date) {
  const y = d.getFullYear()
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${y}-${m}-${day}`
}

const todayStr = computed(() => formatLocalYmd(new Date()))

function dueKey(dueDate: string) {
  const s = String(dueDate || '').trim()
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : ''
}

function roundMoney(n: number) {
  return Math.round(n * 100) / 100
}

/** 订单卡包金额（元）：与后台订单/商品「卡包金额」字段一致，不再用成交金额反推 */
function orderCardPackageYuan(order: (typeof orders.value)[number]) {
  return Math.max(0, Math.round(Number(order.cardPackageAmount) || 0))
}

/** 基于接口拉取的订单与先享后付计划汇总（与库内逻辑一致） */
const kpis = computed(() => {
  let totalSales = 0
  let totalPrincipal = 0
  let receivableAmount = 0
  let receivablePrincipal = 0
  let overdueAmount = 0
  let unpaidCount = 0
  let overdueCount = 0
  let overdueOrderCount = 0

  const t = todayStr.value

  for (const order of orders.value) {
    const orderTotal = Number(order.totalAmount) || 0
    totalSales += orderTotal

    const pkg = orderCardPackageYuan(order)
    totalPrincipal += pkg

    const plan = order.installmentPlan
    const periodCount = plan.length
    const unpaidInOrder = periodCount > 0 ? plan.filter(item => !item.paid).length : 0
    if (periodCount > 0 && unpaidInOrder > 0) {
      receivablePrincipal += roundMoney((pkg * unpaidInOrder) / periodCount)
    }

    let orderHasOverdue = false
    for (const item of order.installmentPlan) {
      const a = Number(item.amount) || 0
      const dk = dueKey(item.dueDate)

      if (!item.paid) {
        receivableAmount += a
        unpaidCount += 1
        if (dk && dk < t) {
          overdueAmount += a
          overdueCount += 1
          orderHasOverdue = true
        }
      }
    }
    if (orderHasOverdue) {
      overdueOrderCount += 1
    }
  }

  const overdueRate = unpaidCount > 0 ? (overdueCount / unpaidCount) * 100 : 0

  return {
    orderCount: orders.value.length,
    totalSales,
    totalPrincipal,
    receivableAmount,
    receivablePrincipal,
    overdueAmount,
    unpaidCount,
    overdueCount,
    overdueOrderCount,
    overdueRate,
  }
})

function fmtYuan(n: number) {
  return `¥${Number(n || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

type Tone = 'greenSpring' | 'greenForest' | 'teal' | 'amberGold' | 'orangeBurnt' | 'violet' | 'redTomato' | 'redCrimson' | 'redWine'

interface KpiCard {
  label: string
  value: string
  hint?: string
  tone: Tone
}

/** 第一行 4 列：成交总额、成交本金、待收金额、待收本金；第二行 4 列：订单数、逾期订单数、逾期金额、逾期率 */
const row1Cards = computed<KpiCard[]>(() => {
  const k = kpis.value
  return [
    {
      label: '成交总额',
      value: fmtYuan(k.totalSales),
      hint: '全部订单成交金额',
      tone: 'greenSpring',
    },
    {
      label: '成交本金',
      value: fmtYuan(k.totalPrincipal),
      hint: '各订单卡包金额（下单快照）合计',
      tone: 'amberGold',
    },
    {
      label: '待收金额',
      value: fmtYuan(k.receivableAmount),
      hint: '全部未还期次应还本息合计',
      tone: 'teal',
    },
    {
      label: '待收本金',
      value: fmtYuan(k.receivablePrincipal),
      hint: '卡包金额按未还期次占全部期次比例合计',
      tone: 'orangeBurnt',
    },
  ]
})

const row2Cards = computed<KpiCard[]>(() => {
  const k = kpis.value
  return [
    {
      label: '订单数',
      value: String(k.orderCount),
      hint: '订单总数',
      tone: 'greenForest',
    },
    {
      label: '逾期订单数',
      value: String(k.overdueOrderCount),
      hint: '存在逾期未还期次的订单数',
      tone: 'redTomato',
    },
    {
      label: '逾期金额',
      value: fmtYuan(k.overdueAmount),
      hint: '已到期仍未还本利合计',
      tone: 'redCrimson',
    },
    {
      label: '逾期率',
      value: `${k.overdueRate.toFixed(2)}%`,
      hint: '逾期未还期数 ÷ 未还期数',
      tone: 'redWine',
    },
  ]
})

async function refresh() {
  loading.value = true
  try {
    await fetchOrders()
  }
  finally {
    loading.value = false
  }
}

onMounted(() => {
  void refresh()
})
</script>

<template>
  <div
    v-loading="loading"
    class="dash-page"
  >
    <div class="dash-toolbar">
      <div>
        <h1 class="dash-title">
          财务报表
        </h1>
      </div>
      <el-button
        type="primary"
        :icon="Refresh"
        :loading="loading"
        @click="refresh"
      >
        刷新数据
      </el-button>
    </div>

    <div class="kpi-rows">
      <div class="kpi-row">
        <div
          v-for="(card, idx) in row1Cards"
          :key="`r1-${idx}`"
          class="kpi-card"
          :class="`kpi-card--${card.tone}`"
        >
          <p class="kpi-label">
            {{ card.label }}
          </p>
          <div class="kpi-rule" />
          <p class="kpi-value">
            {{ card.value }}
          </p>
          <p
            v-if="card.hint"
            class="kpi-hint"
          >
            {{ card.hint }}
          </p>
        </div>
      </div>
      <div class="kpi-row">
        <div
          v-for="(card, idx) in row2Cards"
          :key="`r2-${idx}`"
          class="kpi-card"
          :class="`kpi-card--${card.tone}`"
        >
          <p class="kpi-label">
            {{ card.label }}
          </p>
          <div class="kpi-rule" />
          <p class="kpi-value">
            {{ card.value }}
          </p>
          <p
            v-if="card.hint"
            class="kpi-hint"
          >
            {{ card.hint }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dash-page {
  box-sizing: border-box;
  width: 100%;
  max-width: 100%;
  min-height: 100%;
  display: flex;
  flex-direction: column;
}

.dash-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 20px;
  flex-shrink: 0;
}

.dash-title {
  margin: 0 0 6px;
  font-size: 1.35rem;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.kpi-rows {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 16px;
  align-content: start;
}

.kpi-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}

.kpi-card {
  border-radius: 12px;
  padding: 22px 18px 18px;
  min-height: 168px;
  color: #fff;
  box-shadow: 0 2px 10px rgba(15, 23, 42, 0.12);
  display: flex;
  flex-direction: column;
  position: relative;
}

.kpi-label {
  margin: 0;
  font-size: 14px;
  font-weight: 500;
  opacity: 0.95;
  line-height: 1.35;
}

.kpi-rule {
  height: 1px;
  background: rgba(255, 255, 255, 0.35);
  margin: 14px 0 10px;
}

.kpi-value {
  margin: 0;
  font-size: 1.55rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  font-variant-numeric: tabular-nums;
  line-height: 1.25;
  word-break: break-all;
}

.kpi-hint {
  margin: 12px 0 0;
  font-size: 12px;
  opacity: 0.82;
  line-height: 1.4;
}

/* 语义色：绿/橙/红各系内深浅区分 */
.kpi-card--greenSpring {
  background: linear-gradient(145deg, #4ade80 0%, #16a34a 100%);
}

.kpi-card--greenForest {
  background: linear-gradient(145deg, #22c55e 0%, #14532d 100%);
}

.kpi-card--teal {
  background: linear-gradient(145deg, #14b8a6 0%, #0d9488 100%);
}

/* 本金相关：金黄琥珀 vs 深橙，同属橙色系 */
.kpi-card--amberGold {
  background: linear-gradient(145deg, #fbbf24 0%, #d97706 100%);
}

.kpi-card--orangeBurnt {
  background: linear-gradient(145deg, #fb923c 0%, #c2410c 100%);
}

/* 逾期：番茄红 → 正红 → 酒红，同系不同色 */
.kpi-card--redTomato {
  background: linear-gradient(145deg, #fb7185 0%, #e11d48 100%);
}

.kpi-card--redCrimson {
  background: linear-gradient(145deg, #f43f5e 0%, #b91c1c 100%);
}

.kpi-card--redWine {
  background: linear-gradient(145deg, #be123c 0%, #7f1d1d 100%);
}

.kpi-card--violet {
  background: linear-gradient(145deg, #8b5cf6 0%, #6d28d9 100%);
}

@media (max-width: 900px) {
  .kpi-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
