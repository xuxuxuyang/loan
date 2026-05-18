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

/** 订单卡包金额（元）：与后台订单/商品「卡包金额」字段一致，不再用成交金额反推 */
function orderCardPackageYuan(order: (typeof orders.value)[number]) {
  return Math.max(0, Math.round(Number(order.cardPackageAmount) || 0))
}

/** 财务报表 KPI 统一口径：仅统计「卡包已发放」的订单（金额、笔数、逾期等均在此基础上） */
function ordersWithCardPackageIssued(list: (typeof orders.value)) {
  return list.filter(o => o.cardPackageIssued)
}

/** 基于接口拉取的订单与还款详情汇总 */
const kpis = computed(() => {
  const basis = ordersWithCardPackageIssued(orders.value)
  const orderCount = basis.length

  let totalSales = 0
  let totalPrincipal = 0
  let receivableAmount = 0
  let receivablePrincipal = 0
  let overdueAmount = 0
  let overdueOrderCount = 0

  const t = todayStr.value

  for (const order of basis) {
    const orderTotal = Number(order.totalAmount) || 0
    totalSales += orderTotal

    const pkg = orderCardPackageYuan(order)
    const plan = order.installmentPlan
    const hasUnpaid = plan.some(item => !item.paid)
    // 成交本金、待收本金：卡包金额；还款均为单期，未还清时待收本金计整笔卡包金额
    totalPrincipal += pkg
    if (hasUnpaid) {
      receivablePrincipal += pkg
    }

    let orderHasOverdue = false
    for (const item of plan) {
      const a = Number(item.amount) || 0
      const dk = dueKey(item.dueDate)

      if (!item.paid) {
        receivableAmount += a
        if (dk && dk < t) {
          overdueAmount += a
          orderHasOverdue = true
        }
      }
    }
    if (orderHasOverdue) {
      overdueOrderCount += 1
    }
  }

  const overdueRate = orderCount > 0 ? (overdueOrderCount / orderCount) * 100 : 0

  return {
    orderCount,
    totalSales,
    totalPrincipal,
    receivableAmount,
    receivablePrincipal,
    overdueAmount,
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

/** 财务报表 KPI 卡片：每行 3 张，按业务顺序排列 */
const kpiCards = computed<KpiCard[]>(() => {
  const k = kpis.value
  const scope = '【卡包已发放】'
  return [
    {
      label: '成交总额',
      value: fmtYuan(k.totalSales),
      hint: `${scope}订单的成交金额合计`,
      tone: 'greenSpring',
    },
    {
      label: '成交本金',
      value: fmtYuan(k.totalPrincipal),
      hint: `${scope}卡包金额合计`,
      tone: 'amberGold',
    },
    {
      label: '待收金额',
      value: fmtYuan(k.receivableAmount),
      hint: `${scope}未还应还先享后付金额合计`,
      tone: 'teal',
    },
    {
      label: '待收本金',
      value: fmtYuan(k.receivablePrincipal),
      hint: `${scope}尚有未还款项的卡包金额合计`,
      tone: 'orangeBurnt',
    },
    {
      label: '订单数',
      value: String(k.orderCount),
      hint: `${scope}订单数`,
      tone: 'greenForest',
    },
    {
      label: '逾期订单数',
      value: String(k.overdueOrderCount),
      hint: `${scope}存在逾期未还的笔数`,
      tone: 'redTomato',
    },
    {
      label: '逾期金额',
      value: fmtYuan(k.overdueAmount),
      hint: `${scope}已到期仍未还金额合计`,
      tone: 'redCrimson',
    },
    {
      label: '逾期率',
      value: `${k.overdueRate.toFixed(2)}%`,
      hint: `${scope}逾期订单数 ÷ 订单笔数`,
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

    <div class="kpi-board">
      <div
        v-for="(card, idx) in kpiCards"
        :key="idx"
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

.kpi-board {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px;
  align-items: stretch;
  grid-auto-rows: minmax(228px, auto);
}

.kpi-card {
  box-sizing: border-box;
  border-radius: 14px;
  padding: 28px 22px 22px;
  min-height: 228px;
  color: #fff;
  box-shadow: 0 4px 18px rgba(15, 23, 42, 0.14);
  display: flex;
  flex-direction: column;
  position: relative;
}

.kpi-label {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  opacity: 0.95;
  line-height: 1.35;
}

.kpi-rule {
  height: 1px;
  background: rgba(255, 255, 255, 0.35);
  margin: 16px 0 12px;
}

.kpi-value {
  margin: 0;
  font-size: 2rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
  word-break: break-all;
}

.kpi-hint {
  margin-top: auto;
  margin-bottom: 0;
  padding-top: 14px;
  font-size: 13px;
  opacity: 0.86;
  line-height: 1.45;
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
  .kpi-board {
    grid-template-columns: 1fr;
  }

  .kpi-value {
    font-size: 1.65rem;
  }
}
</style>
