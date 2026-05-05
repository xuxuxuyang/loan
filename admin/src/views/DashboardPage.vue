<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts'
import { useOrdersStore } from '../stores/useOrdersStore'

const { orders } = useOrdersStore()

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

const trendChartRef = ref<HTMLElement | null>(null)
const gaugeChartRef = ref<HTMLElement | null>(null)
const collectionChartRef = ref<HTMLElement | null>(null)

let trendChart: echarts.ECharts | null = null
let gaugeChart: echarts.ECharts | null = null
let collectionChart: echarts.ECharts | null = null

const trendMonths = computed(() => ['1月', '2月', '3月', '4月', '5月', '6月'])

const salesTrendData = computed(() => {
  const base = totalSales.value || 1
  const factors = [0.62, 0.74, 0.81, 0.93, 1.04, 1.12]
  return factors.map(item => Number(((base * item) / 6).toFixed(2)))
})

const receivableTrendData = computed(() => {
  const base = totalReceivable.value || 1
  const factors = [1.18, 1.07, 0.96, 0.89, 0.82, 0.76]
  return factors.map(item => Number(((base * item) / 6).toFixed(2)))
})

const profitRateTrendData = computed(() => {
  const base = profitRate.value
  return [
    Number((base * 0.84).toFixed(2)),
    Number((base * 0.9).toFixed(2)),
    Number((base * 0.96).toFixed(2)),
    Number((base * 1.02).toFixed(2)),
    Number((base * 1.06).toFixed(2)),
    Number((base * 1.12).toFixed(2)),
  ]
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
</style>
