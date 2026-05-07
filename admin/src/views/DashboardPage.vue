<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts'
import { useOrdersStore, type OrderItem } from '../stores/useOrdersStore'

const { orders, fetchOrders } = useOrdersStore()
const todayKey = new Date().toISOString().slice(0, 10)

interface InstallmentRow {
  orderId: string
  user: string
  product: string
  orderStatus: OrderItem['status']
  period: number
  dueDate: string
  principal: number
  fee: number
  amount: number
  repayState: '已回款' | '待回款' | '逾期待回'
}

const totalOrders = computed(() => orders.value.length)
const totalSales = computed(() => orders.value.reduce((sum, item) => sum + item.totalAmount, 0))

const totalReceivable = computed(() => {
  return orders.value.reduce((sum, order) => {
    const pending = order.installmentPlan
      .filter(item => !item.paid)
      .reduce((acc, item) => acc + item.amount, 0)
    return sum + pending
  }, 0)
})

const totalProfit = computed(() => {
  return orders.value.reduce((sum, order) => {
    const fee = order.installmentPlan.reduce((acc, item) => acc + item.fee, 0)
    return sum + fee
  }, 0)
})

const profitRate = computed(() => {
  if (!totalSales.value) {
    return 0
  }
  return (totalProfit.value / totalSales.value) * 100
})

const paidRate = computed(() => {
  const totalInstallments = orders.value.reduce((sum, order) => sum + order.installmentPlan.length, 0)
  const paidInstallments = orders.value.reduce(
    (sum, order) => sum + order.installmentPlan.filter(item => item.paid).length,
    0,
  )
  if (!totalInstallments) {
    return 0
  }
  return (paidInstallments / totalInstallments) * 100
})

const statusSummary = computed(() => {
  return {
    unpaid: orders.value.filter(item => item.status === '待付款').length,
    pendingShip: orders.value.filter(item => item.status === '待发货').length,
    pendingReceive: orders.value.filter(item => item.status === '待收货').length,
    done: orders.value.filter(item => item.status === '已完成').length,
  }
})

const upcomingRepays = computed(() => {
  return orders.value
    .filter(item => item.nextRepayDate !== '-')
    .map(item => ({
      id: item.id,
      user: item.user,
      currentPeriod: item.currentPeriod,
      periods: item.periods,
      amount: item.periodAmount,
      dueDate: item.nextRepayDate,
    }))
    .slice(0, 5)
})

const filterKeyword = ref('')
const filterOrderStatus = ref<'all' | OrderItem['status']>('all')
const filterPeriod = ref<'all' | number>('all')
const filterRepayState = ref<'all' | InstallmentRow['repayState']>('all')

const allPeriods = computed(() => {
  const set = new Set<number>()
  orders.value.forEach((order) => {
    order.installmentPlan.forEach(item => set.add(item.period))
  })
  return [...set].sort((a, b) => a - b)
})

const installmentRows = computed<InstallmentRow[]>(() => {
  return orders.value.flatMap(order =>
    order.installmentPlan.map((item) => {
      let repayState: InstallmentRow['repayState'] = '待回款'
      if (item.paid) {
        repayState = '已回款'
      }
      else if (item.dueDate < todayKey) {
        repayState = '逾期待回'
      }

      return {
        orderId: order.id,
        user: order.user,
        product: order.product,
        orderStatus: order.status,
        period: item.period,
        dueDate: item.dueDate,
        principal: item.principal,
        fee: item.fee,
        amount: item.amount,
        repayState,
      }
    }),
  )
})

const filteredInstallmentRows = computed(() => {
  const keyword = filterKeyword.value.trim()
  return installmentRows.value.filter((item) => {
    if (keyword) {
      const matched = item.orderId.includes(keyword)
        || item.user.includes(keyword)
        || item.product.includes(keyword)
      if (!matched) {
        return false
      }
    }

    if (filterOrderStatus.value !== 'all' && item.orderStatus !== filterOrderStatus.value) {
      return false
    }

    if (filterPeriod.value !== 'all' && item.period !== filterPeriod.value) {
      return false
    }

    if (filterRepayState.value !== 'all' && item.repayState !== filterRepayState.value) {
      return false
    }

    return true
  })
})

const filteredInstallmentSummary = computed(() => {
  return filteredInstallmentRows.value.reduce((acc, item) => {
    acc.totalAmount += item.amount
    acc.totalPrincipal += item.principal
    acc.totalFee += item.fee
    if (item.repayState === '已回款') {
      acc.paidAmount += item.amount
    }
    else if (item.repayState === '逾期待回') {
      acc.overdueAmount += item.amount
    }
    else {
      acc.pendingAmount += item.amount
    }
    return acc
  }, {
    totalAmount: 0,
    totalPrincipal: 0,
    totalFee: 0,
    paidAmount: 0,
    pendingAmount: 0,
    overdueAmount: 0,
  })
})

const periodAmountRows = computed(() => {
  const map = new Map<number, {
    period: number
    orderIds: Set<string>
    installmentCount: number
    totalPrincipal: number
    totalFee: number
    totalAmount: number
    paidAmount: number
    pendingAmount: number
    overdueAmount: number
  }>()

  filteredInstallmentRows.value.forEach((item) => {
    if (!map.has(item.period)) {
      map.set(item.period, {
        period: item.period,
        orderIds: new Set<string>(),
        installmentCount: 0,
        totalPrincipal: 0,
        totalFee: 0,
        totalAmount: 0,
        paidAmount: 0,
        pendingAmount: 0,
        overdueAmount: 0,
      })
    }
    const target = map.get(item.period)
    if (!target) return

    target.orderIds.add(item.orderId)
    target.installmentCount += 1
    target.totalPrincipal += item.principal
    target.totalFee += item.fee
    target.totalAmount += item.amount

    if (item.repayState === '已回款') {
      target.paidAmount += item.amount
    }
    else if (item.repayState === '逾期待回') {
      target.overdueAmount += item.amount
    }
    else {
      target.pendingAmount += item.amount
    }
  })

  return [...map.values()]
    .sort((a, b) => a.period - b.period)
    .map(item => ({
      ...item,
      orderCount: item.orderIds.size,
      paidRate: item.totalAmount ? (item.paidAmount / item.totalAmount) * 100 : 0,
    }))
})

function resetTableFilters() {
  filterKeyword.value = ''
  filterOrderStatus.value = 'all'
  filterPeriod.value = 'all'
  filterRepayState.value = 'all'
}

function toMonthKey(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  const yyyy = date.getFullYear()
  const mm = `${date.getMonth() + 1}`.padStart(2, '0')
  return `${yyyy}-${mm}`
}

function buildRecentMonthKeys() {
  const keys: string[] = []
  const cursor = new Date()
  cursor.setDate(1)
  for (let i = 5; i >= 0; i -= 1) {
    const date = new Date(cursor)
    date.setMonth(cursor.getMonth() - i)
    const key = toMonthKey(date.toISOString())
    if (key) {
      keys.push(key)
    }
  }
  return keys
}

const trendChartRef = ref<HTMLElement | null>(null)
const gaugeChartRef = ref<HTMLElement | null>(null)
const collectionChartRef = ref<HTMLElement | null>(null)

let trendChart: echarts.ECharts | null = null
let gaugeChart: echarts.ECharts | null = null
let collectionChart: echarts.ECharts | null = null

const trendMonthKeys = computed(() => buildRecentMonthKeys())

const trendMonths = computed(() => {
  return trendMonthKeys.value.map((key) => {
    const month = Number(key.split('-')[1] || 0)
    return `${month}月`
  })
})

const salesTrendData = computed(() => {
  const monthMap = new Map<string, number>()
  orders.value.forEach((order) => {
    const monthKey = toMonthKey(order.createdAt)
    if (!monthKey) return
    monthMap.set(monthKey, (monthMap.get(monthKey) || 0) + order.totalAmount)
  })
  return trendMonthKeys.value.map(key => Number((monthMap.get(key) || 0).toFixed(2)))
})

const receivableTrendData = computed(() => {
  const monthMap = new Map<string, number>()
  installmentRows.value
    .filter(item => item.repayState !== '已回款')
    .forEach((item) => {
      const monthKey = toMonthKey(item.dueDate)
      if (!monthKey) return
      monthMap.set(monthKey, (monthMap.get(monthKey) || 0) + item.amount)
    })
  return trendMonthKeys.value.map(key => Number((monthMap.get(key) || 0).toFixed(2)))
})

const profitRateTrendData = computed(() => {
  const feeMap = new Map<string, number>()
  installmentRows.value.forEach((item) => {
    const monthKey = toMonthKey(item.dueDate)
    if (!monthKey) return
    feeMap.set(monthKey, (feeMap.get(monthKey) || 0) + item.fee)
  })
  return trendMonthKeys.value.map((key, index) => {
    const sales = salesTrendData.value[index] || 0
    const fee = feeMap.get(key) || 0
    if (!sales) {
      return 0
    }
    return Number(((fee / sales) * 100).toFixed(2))
  })
})

function renderTrendChart() {
  if (!trendChartRef.value) return
  trendChart = trendChart || echarts.init(trendChartRef.value)

  trendChart.setOption({
    tooltip: { trigger: 'axis' },
    legend: {
      top: 0,
      textStyle: { color: '#4b5563' },
      data: ['销售额', '待收款', '利润率'],
    },
    grid: { left: 36, right: 40, top: 40, bottom: 24 },
    xAxis: {
      type: 'category',
      data: trendMonths.value,
      axisLine: { lineStyle: { color: '#d1d5db' } },
    },
    yAxis: [
      {
        type: 'value',
        name: '金额(¥)',
        axisLabel: { color: '#6b7280' },
        splitLine: { lineStyle: { color: '#eef2f7' } },
      },
      {
        type: 'value',
        name: '利润率(%)',
        axisLabel: { color: '#6b7280' },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: '销售额',
        type: 'bar',
        data: salesTrendData.value,
        barMaxWidth: 22,
        itemStyle: {
          borderRadius: [8, 8, 0, 0],
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: '#46a0ff' },
            { offset: 1, color: '#2f6bff' },
          ]),
        },
      },
      {
        name: '待收款',
        type: 'bar',
        data: receivableTrendData.value,
        barMaxWidth: 22,
        itemStyle: {
          borderRadius: [8, 8, 0, 0],
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: '#ffc167' },
            { offset: 1, color: '#ff8d3a' },
          ]),
        },
      },
      {
        name: '利润率',
        type: 'line',
        yAxisIndex: 1,
        smooth: true,
        symbolSize: 8,
        data: profitRateTrendData.value,
        lineStyle: { width: 3, color: '#19b47c' },
        itemStyle: { color: '#19b47c' },
      },
    ],
  })
}

function renderGaugeChart() {
  if (!gaugeChartRef.value) return
  gaugeChart = gaugeChart || echarts.init(gaugeChartRef.value)

  gaugeChart.setOption({
    series: [
      {
        name: '利润率',
        type: 'gauge',
        startAngle: 220,
        endAngle: -40,
        min: 0,
        max: 25,
        progress: { show: true, width: 12, itemStyle: { color: '#20c997' } },
        axisLine: { lineStyle: { width: 12, color: [[1, '#e5e7eb']] } },
        pointer: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        detail: {
          valueAnimation: true,
          formatter: '{value}%',
          fontSize: 28,
          color: '#111827',
          offsetCenter: [0, '10%'],
        },
        title: {
          offsetCenter: [0, '65%'],
          color: '#6b7280',
          fontSize: 13,
        },
        data: [{ value: Number(profitRate.value.toFixed(2)), name: '利润率' }],
      },
    ],
  })
}

function renderCollectionChart() {
  if (!collectionChartRef.value) return
  collectionChart = collectionChart || echarts.init(collectionChartRef.value)
  const collected = Math.max(totalSales.value - totalReceivable.value, 0)

  collectionChart.setOption({
    tooltip: { trigger: 'item' },
    legend: {
      bottom: 0,
      textStyle: { color: '#4b5563' },
    },
    series: [
      {
        name: '回款情况',
        type: 'pie',
        radius: ['56%', '76%'],
        center: ['50%', '44%'],
        label: {
          formatter: '{b}\n{d}%',
          color: '#374151',
          fontSize: 12,
        },
        data: [
          {
            value: Number(collected.toFixed(2)),
            name: '已收款',
            itemStyle: { color: '#386bff' },
          },
          {
            value: Number(totalReceivable.value.toFixed(2)),
            name: '待收款',
            itemStyle: { color: '#ff9f43' },
          },
        ],
      },
    ],
  })
}

function handleResize() {
  trendChart?.resize()
  gaugeChart?.resize()
  collectionChart?.resize()
}

onMounted(() => {
  void fetchOrders()
  renderTrendChart()
  renderGaugeChart()
  renderCollectionChart()
  window.addEventListener('resize', handleResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  trendChart?.dispose()
  gaugeChart?.dispose()
  collectionChart?.dispose()
  trendChart = null
  gaugeChart = null
  collectionChart = null
})

watch([orders, totalSales, totalReceivable, profitRate], () => {
  renderTrendChart()
  renderGaugeChart()
  renderCollectionChart()
}, { deep: true })
</script>

<template>
  <div class="card-grid">
    <article class="card">
      <p class="card-label">
        订单总数
      </p>
      <p class="card-value">
        {{ totalOrders }}
      </p>
    </article>
    <article class="card">
      <p class="card-label">
        销售额汇总
      </p>
      <p class="card-value">
        ¥ {{ totalSales.toFixed(2) }}
      </p>
    </article>
    <article class="card">
      <p class="card-label">
        待收款
      </p>
      <p class="card-value">
        ¥ {{ totalReceivable.toFixed(2) }}
      </p>
    </article>
    <article class="card">
      <p class="card-label">
        利润率（手续费）
      </p>
      <p class="card-value">
        {{ profitRate.toFixed(2) }}%
      </p>
    </article>
    <article class="card">
      <p class="card-label">
        分期已还占比
      </p>
      <p class="card-value">
        {{ paidRate.toFixed(2) }}%
      </p>
    </article>
    <article class="card">
      <p class="card-label">
        手续费利润
      </p>
      <p class="card-value">
        ¥ {{ totalProfit.toFixed(2) }}
      </p>
    </article>
  </div>

  <div class="charts-grid mt">
    <div class="panel">
      <h3 class="section-title">
        经营趋势（销售额 / 待收款 / 利润率）
      </h3>
      <div
        ref="trendChartRef"
        class="chart-box chart-large"
      />
    </div>

    <div class="panel">
      <h3 class="section-title">
        利润率仪表盘
      </h3>
      <div
        ref="gaugeChartRef"
        class="chart-box chart-small"
      />
    </div>

    <div class="panel">
      <h3 class="section-title">
        回款占比（已收款 / 待收款）
      </h3>
      <div
        ref="collectionChartRef"
        class="chart-box chart-small"
      />
    </div>
  </div>

  <div class="panel mt">
    <h3 class="section-title">
      订单状态汇总
    </h3>
    <div class="summary-grid">
      <div class="summary-item">
        <p>待付款</p>
        <strong>{{ statusSummary.unpaid }}</strong>
      </div>
      <div class="summary-item">
        <p>待发货</p>
        <strong>{{ statusSummary.pendingShip }}</strong>
      </div>
      <div class="summary-item">
        <p>待收货</p>
        <strong>{{ statusSummary.pendingReceive }}</strong>
      </div>
      <div class="summary-item">
        <p>已完成</p>
        <strong>{{ statusSummary.done }}</strong>
      </div>
    </div>
  </div>

  <div class="panel mt">
    <h3 class="section-title">
      分期金额统计表（可筛选）
    </h3>
    <div class="filter-grid">
      <label>
        关键词
        <el-input
          v-model="filterKeyword"
          class="filter-input"
          placeholder="订单号 / 用户 / 商品"
          clearable
        />
      </label>
      <label>
        订单状态
        <el-select
          v-model="filterOrderStatus"
          class="filter-select"
        >
          <el-option label="全部状态" value="all" />
          <el-option label="待发货" value="待发货" />
          <el-option label="待收货" value="待收货" />
          <el-option label="已完成" value="已完成" />
        </el-select>
      </label>
      <label>
        期次
        <el-select
          v-model="filterPeriod"
          class="filter-select"
        >
          <el-option label="全部期次" value="all" />
          <el-option
            v-for="period in allPeriods"
            :key="period"
            :label="`第${period}期`"
            :value="period"
          />
        </el-select>
      </label>
      <label>
        回款状态
        <el-select
          v-model="filterRepayState"
          class="filter-select"
        >
          <el-option label="全部" value="all" />
          <el-option label="已回款" value="已回款" />
          <el-option label="待回款" value="待回款" />
          <el-option label="逾期待回" value="逾期待回" />
        </el-select>
      </label>
      <button
        class="btn-reset"
        type="button"
        @click="resetTableFilters"
      >
        重置筛选
      </button>
    </div>

    <div class="amount-cards">
      <article class="amount-item">
        <p>筛选后总应还金额</p>
        <strong>¥ {{ filteredInstallmentSummary.totalAmount.toFixed(2) }}</strong>
      </article>
      <article class="amount-item">
        <p>筛选后已回款金额</p>
        <strong>¥ {{ filteredInstallmentSummary.paidAmount.toFixed(2) }}</strong>
      </article>
      <article class="amount-item">
        <p>筛选后待回款金额</p>
        <strong>¥ {{ filteredInstallmentSummary.pendingAmount.toFixed(2) }}</strong>
      </article>
      <article class="amount-item">
        <p>筛选后逾期待回金额</p>
        <strong>¥ {{ filteredInstallmentSummary.overdueAmount.toFixed(2) }}</strong>
      </article>
    </div>

    <table class="table">
      <thead>
        <tr>
          <th>期次</th>
          <th>订单数</th>
          <th>分期笔数</th>
          <th>总本金</th>
          <th>总手续费</th>
          <th>总应还金额</th>
          <th>已回款</th>
          <th>待回款</th>
          <th>逾期待回</th>
          <th>回款率</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="item in periodAmountRows"
          :key="item.period"
        >
          <td>第{{ item.period }}期</td>
          <td>{{ item.orderCount }}</td>
          <td>{{ item.installmentCount }}</td>
          <td>¥ {{ item.totalPrincipal.toFixed(2) }}</td>
          <td>¥ {{ item.totalFee.toFixed(2) }}</td>
          <td>¥ {{ item.totalAmount.toFixed(2) }}</td>
          <td>¥ {{ item.paidAmount.toFixed(2) }}</td>
          <td>¥ {{ item.pendingAmount.toFixed(2) }}</td>
          <td>¥ {{ item.overdueAmount.toFixed(2) }}</td>
          <td>{{ item.paidRate.toFixed(2) }}%</td>
        </tr>
        <tr v-if="!periodAmountRows.length">
          <td
            colspan="10"
            class="empty-row"
          >
            当前筛选条件下暂无金额数据
          </td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="panel mt">
    <h3 class="section-title">
      即将到期还款（TOP 5）
    </h3>
    <table class="table">
      <thead>
        <tr>
          <th>订单号</th>
          <th>用户</th>
          <th>当前期数</th>
          <th>本期应还</th>
          <th>到期日</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="item in upcomingRepays"
          :key="item.id"
        >
          <td>{{ item.id }}</td>
          <td>{{ item.user }}</td>
          <td>{{ item.currentPeriod }} / {{ item.periods }}</td>
          <td>¥ {{ item.amount }}</td>
          <td>{{ item.dueDate }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.mt {
  margin-top: 12px;
}

.section-title {
  margin: 0 0 12px;
  font-size: 16px;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.summary-item {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 12px;
}

.summary-item p {
  margin: 0;
  color: #6b7280;
  font-size: 14px;
}

.summary-item strong {
  display: block;
  margin-top: 6px;
  font-size: 20px;
}

.charts-grid {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr;
  gap: 12px;
}

.chart-box {
  width: 100%;
}

.chart-large {
  height: 320px;
}

.chart-small {
  height: 320px;
}

.filter-grid {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 10px;
  margin-bottom: 10px;
}

.filter-grid label {
  display: grid;
  gap: 6px;
  font-size: 13px;
  color: #6b7280;
  width: 220px;
  max-width: 100%;
}

.filter-input,
.filter-select {
  width: 100%;
}

.filter-grid input,
.filter-grid select {
  height: 34px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  padding: 0 10px;
}

.btn-reset {
  height: 34px;
  border-radius: 8px;
  border: 1px solid #2563eb;
  background: #eff6ff;
  color: #1d4ed8;
  cursor: pointer;
}

.amount-cards {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 10px;
}

.amount-item {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 10px;
  background: #fafafa;
}

.amount-item p {
  margin: 0;
  color: #6b7280;
  font-size: 13px;
}

.amount-item strong {
  display: block;
  margin-top: 6px;
  font-size: 20px;
}

.empty-row {
  text-align: center;
  color: #9ca3af;
}
</style>
