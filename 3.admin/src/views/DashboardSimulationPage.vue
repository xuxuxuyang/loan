<script setup lang="ts">
import { Refresh } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { computed, onMounted, ref } from 'vue'
import { apiErrorMessage, readApiErrorMessage, withMallTenantHeaders } from '../composables/useAdminApi'
import { adminSessionRevision, getAdminSession } from '../composables/useAdminAuth'

const MALL_API_BASE = `${(import.meta.env.VITE_MALL_API_BASE || 'http://localhost:3110/api').replace(/\/$/, '')}`

interface SimulationInput {
  orderCount: number
  overdueRate: number
}

interface SimulationKpis {
  orderCount: number
  totalSales: number
  totalPrincipal: number
  premiumToPrincipal: number
  principalProfit: number
  collectedAmount: number
  receivableAmount: number
  receivablePrincipal: number
  collectionRateByAmount: number
  settledOrderCount: number
  settlementGapCount: number
  settledRate: number
  overdueOrderCount: number
  overdueRate: number
  overdueAmount: number
  overduePrincipalAmount: number
  avgTicket: number
  avgPeriods: number
  dueTodayAmount: number
  dueTomorrowAmount: number
  dueIn7DaysAmount: number
  installmentPayOrderCount: number
  extensionRepaymentAmount: number
  extensionRepaymentPendingAmount: number
  simulationInput?: SimulationInput
}

function emptySimulationKpis(): SimulationKpis {
  return {
    orderCount: 0,
    totalSales: 0,
    totalPrincipal: 0,
    premiumToPrincipal: 0,
    principalProfit: 0,
    collectedAmount: 0,
    receivableAmount: 0,
    receivablePrincipal: 0,
    collectionRateByAmount: 0,
    settledOrderCount: 0,
    settlementGapCount: 0,
    settledRate: 0,
    overdueOrderCount: 0,
    overdueRate: 0,
    overdueAmount: 0,
    overduePrincipalAmount: 0,
    avgTicket: 0,
    avgPeriods: 0,
    dueTodayAmount: 0,
    dueTomorrowAmount: 0,
    dueIn7DaysAmount: 0,
    installmentPayOrderCount: 0,
    extensionRepaymentAmount: 0,
    extensionRepaymentPendingAmount: 0,
    simulationInput: undefined,
  }
}

type Tone =
  | 'greenSpring'
  | 'greenForest'
  | 'cyanSky'
  | 'teal'
  | 'amberGold'
  | 'orangeBurnt'
  | 'slateInk'
  | 'violet'
  | 'redTomato'
  | 'redCrimson'
  | 'redRuby'
  | 'redWine'

interface BoardSection {
  kind: 'section'
  title: string
  subtitle?: string
}

interface KpiCard {
  kind: 'card'
  label: string
  value: string
  hint?: string
  tone: Tone
}

interface BoardSpacer {
  kind: 'spacer'
}

type BoardItem = BoardSection | KpiCard | BoardSpacer

const loading = ref(false)
const requestSeq = ref(0)
const model = ref<SimulationInput>({
  orderCount: 356,
  overdueRate: 19.3,
})
const kpis = ref<SimulationKpis>(emptySimulationKpis())

const canAdjustSimulation = computed(() => {
  void adminSessionRevision.value
  return getAdminSession()?.role === 'super_admin'
})

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value))
    return min
  return Math.min(max, Math.max(min, value))
}

function normalizeInput(input: SimulationInput): SimulationInput {
  return {
    orderCount: Math.round(clampNumber(Number(input.orderCount), 0, 1000000)),
    overdueRate: Math.round(clampNumber(Number(input.overdueRate), 0, 100) * 100) / 100,
  }
}

function fmtYuan(n: number) {
  return `¥${Number(n || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const boardRows = computed<BoardItem[]>(() => {
  const k = kpis.value
  const scope = '【卡包已发放】'
  const section = (title: string, subtitle?: string): BoardSection => ({ kind: 'section', title, subtitle })
  const card = (payload: Omit<KpiCard, 'kind'>): KpiCard => ({ kind: 'card', ...payload })

  return [
    card({ label: '订单数', value: String(k.orderCount), hint: `${scope}订单笔数`, tone: 'greenForest' }),
    card({ label: '成交总额', value: fmtYuan(k.totalSales), hint: `${scope}订单成交金额合计`, tone: 'greenSpring' }),
    card({ label: '笔均成交金额', value: fmtYuan(k.avgTicket), hint: `${scope}成交总额 ÷ 订单笔数`, tone: 'amberGold' }),
    card({ label: '成交本金（卡包）', value: fmtYuan(k.totalPrincipal), hint: `${scope}卡包金额合计`, tone: 'orangeBurnt' }),
    card({ label: '营收利润', value: fmtYuan(k.premiumToPrincipal), hint: `${scope}成交总额 − 卡包本金合计`, tone: 'slateInk' }),
    card({ label: '延期还款金额', value: fmtYuan(k.extensionRepaymentAmount), hint: `${scope}已支付延期费合计`, tone: 'violet' }),
    card({ label: '待支付延期费', value: fmtYuan(k.extensionRepaymentPendingAmount), hint: `${scope}已登记协商、用户尚未完成支付的延期费`, tone: 'amberGold' }),

    section('回款与待收'),
    card({ label: '已收金额', value: fmtYuan(k.collectedAmount), hint: `${scope}已结分期应还金额合计`, tone: 'teal' }),
    card({ label: '待收金额', value: fmtYuan(k.receivableAmount), hint: `${scope}各期计划中尚未应还的金额合计（含已逾期未还与未到期）`, tone: 'cyanSky' }),
    card({ label: '待收本金', value: fmtYuan(k.receivablePrincipal), hint: `${scope}尚有未还款项时整笔计入的卡包本金`, tone: 'orangeBurnt' }),
    card({ label: '金额回款进度', value: `${k.collectionRateByAmount.toFixed(2)}%`, hint: `${scope}已收金额 ÷（已收+待收），反映合同现金流回收比例`, tone: 'greenSpring' }),

    section('逾期与风控'),
    card({ label: '全额结清订单', value: `${k.settledOrderCount}`, hint: `${scope}全部分期均已标记还清的订单笔数`, tone: 'greenForest' }),
    card({ label: '在贷未结清', value: `${k.settlementGapCount}`, hint: `${scope}仍至少有一期未还的订单`, tone: 'slateInk' }),
    card({ label: '逾期订单数', value: String(k.overdueOrderCount), hint: `${scope}存在至少一期逾期未还的笔数`, tone: 'redTomato' }),
    { kind: 'spacer' },
    card({ label: '逾期率（笔数）', value: `${k.overdueRate.toFixed(2)}%`, hint: `${scope}动态累计日均，截至昨日（不含当日），各应还日未还笔数占比`, tone: 'redWine' }),
    card({ label: '逾期金额', value: fmtYuan(k.overdueAmount), hint: `${scope}截至昨日（不含当日），有效应还日已过的未还分期金额合计`, tone: 'redCrimson' }),
    card({ label: '逾期金额（本金）', value: fmtYuan(k.overduePrincipalAmount), hint: `${scope}截至昨日（不含当日），有效应还日已过的未还分期本金合计`, tone: 'redRuby' }),
  ]
})

function applyKpis(payload: Partial<SimulationKpis>) {
  const next = { ...emptySimulationKpis(), ...payload }
  kpis.value = next
  if (next.simulationInput) {
    model.value = normalizeInput(next.simulationInput)
  }
}

async function requestKpis(endpoint: string, input?: SimulationInput) {
  const seq = requestSeq.value + 1
  requestSeq.value = seq
  loading.value = true
  try {
    const response = await fetch(`${MALL_API_BASE}${endpoint}`, {
      method: endpoint.endsWith('/simulation-config') ? 'PUT' : 'POST',
      headers: withMallTenantHeaders({ 'Content-Type': 'application/json' }),
      body: input ? JSON.stringify(input) : JSON.stringify({}),
    })
    const payload = await response.json() as {
      success?: boolean
      msg?: string
      data?: Partial<SimulationKpis>
    }
    if (seq !== requestSeq.value)
      return
    if (!response.ok || payload.success === false || !payload.data) {
      throw new Error(apiErrorMessage(payload, await readApiErrorMessage(response, '刷新失败')))
    }
    applyKpis(payload.data)
  }
  catch (error) {
    if (seq === requestSeq.value)
      ElMessage.error(error instanceof Error ? error.message : '刷新失败')
  }
  finally {
    if (seq === requestSeq.value)
      loading.value = false
  }
}

async function refreshData() {
  await requestKpis('/admin/dashboard/simulation-kpis')
}

async function saveAndRefresh() {
  const input = normalizeInput(model.value)
  model.value = { ...input }
  await requestKpis('/admin/dashboard/simulation-config', input)
}

onMounted(() => {
  void refreshData()
})
</script>

<template>
  <div v-loading="loading" class="dash-page">
    <div class="dash-toolbar">
      <el-button
        type="primary"
        :icon="Refresh"
        :loading="loading"
        @click="refreshData"
      >
        刷新数据
      </el-button>
      <el-form v-if="canAdjustSimulation" class="report-control-form" :model="model" inline @submit.prevent>
        <el-form-item label="订单数">
          <el-input-number
            v-model="model.orderCount"
            :min="0"
            :max="1000000"
            :step="10"
            controls-position="right"
          />
        </el-form-item>
        <el-form-item label="逾期率（%）">
          <el-input-number
            v-model="model.overdueRate"
            :min="0"
            :max="100"
            :step="0.1"
            :precision="2"
            controls-position="right"
          />
        </el-form-item>
        <el-button type="primary" :loading="loading" @click="saveAndRefresh">
          保存并刷新
        </el-button>
      </el-form>
    </div>

    <div class="kpi-board">
      <template v-for="(row, idx) in boardRows" :key="`${row.kind}-${idx}`">
        <div v-if="row.kind === 'section'" class="kpi-section">
          <h2 class="kpi-section-title">
            {{ row.title }}
          </h2>
          <p v-if="row.subtitle" class="kpi-section-subtitle">
            {{ row.subtitle }}
          </p>
        </div>
        <div v-else-if="row.kind === 'spacer'" class="kpi-spacer" />
        <div v-else class="kpi-card" :class="`kpi-card--${row.tone}`">
          <p class="kpi-label">
            {{ row.label }}
          </p>
          <div class="kpi-rule" />
          <p class="kpi-value">
            {{ row.value }}
          </p>
          <p v-if="row.hint" class="kpi-hint">
            {{ row.hint }}
          </p>
        </div>
      </template>
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
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 20px;
  flex-shrink: 0;
}

.report-control-form {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: flex-end;
  gap: 12px;
}

.report-control-form :deep(.el-form-item) {
  margin-right: 0;
  margin-bottom: 0;
}

.report-control-form :deep(.el-input-number) {
  width: 180px;
}

.kpi-board {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 18px;
  align-items: stretch;
  grid-auto-rows: auto;
}

.kpi-spacer {
  min-height: 1px;
}

.kpi-section {
  grid-column: 1 / -1;
  padding: 4px 0 2px;
  margin-top: 4px;
}

.kpi-section:first-child {
  margin-top: 0;
}

.kpi-section-title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--el-text-color-primary);
  letter-spacing: 0.02em;
}

.kpi-section-subtitle {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--el-text-color-secondary);
  line-height: 1.45;
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

.kpi-card--greenSpring { background: linear-gradient(145deg, #4ade80 0%, #16a34a 100%); }
.kpi-card--greenForest { background: linear-gradient(145deg, #22c55e 0%, #14532d 100%); }
.kpi-card--teal { background: linear-gradient(145deg, #14b8a6 0%, #0d9488 100%); }
.kpi-card--cyanSky { background: linear-gradient(145deg, #22d3ee 0%, #059669 100%); }
.kpi-card--slateInk { background: linear-gradient(145deg, #475569 0%, #1e293b 100%); }
.kpi-card--amberGold { background: linear-gradient(145deg, #fbbf24 0%, #d97706 100%); }
.kpi-card--orangeBurnt { background: linear-gradient(145deg, #fb923c 0%, #c2410c 100%); }
.kpi-card--redTomato { background: linear-gradient(145deg, #fb7185 0%, #e11d48 100%); }
.kpi-card--redCrimson { background: linear-gradient(145deg, #f43f5e 0%, #b91c1c 100%); }
.kpi-card--redRuby { background: linear-gradient(145deg, #ef4444 0%, #991b1b 100%); }
.kpi-card--redWine { background: linear-gradient(145deg, #be123c 0%, #7f1d1d 100%); }
.kpi-card--violet { background: linear-gradient(145deg, #8b5cf6 0%, #6d28d9 100%); }

@media (max-width: 1200px) {
  .kpi-board {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .kpi-spacer {
    display: none;
  }
}

@media (max-width: 900px) {
  .dash-toolbar,
  .report-control-form {
    justify-content: flex-start;
  }

  .kpi-board {
    grid-template-columns: 1fr;
  }

  .report-control-form :deep(.el-input-number) {
    width: 100%;
  }

  .kpi-value {
    font-size: 1.65rem;
  }
}
</style>