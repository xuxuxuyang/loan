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

interface KpiGroup {
  title: string
  rows: KpiTableRow[]
}

interface KpiTableRow {
  label: string
  value: string
  hint: string
}

const tableHeaderCellStyle = {
  background: '#f7f8fb',
  color: '#303133',
  fontWeight: 600,
}

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

const kpiGroups = computed<KpiGroup[]>(() => {
  const k = kpis.value
  const scope = '【卡包已发放】'
  const row = (label: string, value: string, hint: string): KpiTableRow => ({ label, value, hint })

  return [
    {
      title: '成交概览',
      rows: [
        row('订单数', String(k.orderCount), `${scope}订单笔数`),
        row('成交总额', fmtYuan(k.totalSales), `${scope}订单成交金额合计`),
        row('笔均成交金额', fmtYuan(k.avgTicket), `${scope}成交总额 ÷ 订单笔数`),
        row('成交本金（卡包）', fmtYuan(k.totalPrincipal), `${scope}卡包金额合计`),
        row('营收利润', fmtYuan(k.premiumToPrincipal), `${scope}成交总额 − 卡包本金合计`),
        row('延期还款金额', fmtYuan(k.extensionRepaymentAmount), `${scope}已支付延期费合计`),
        row('待支付延期费', fmtYuan(k.extensionRepaymentPendingAmount), `${scope}已登记协商、用户尚未完成支付的延期费`),
      ],
    },
    {
      title: '回款与待收',
      rows: [
        row('已收金额', fmtYuan(k.collectedAmount), `${scope}已结分期应还金额合计`),
        row('待收金额', fmtYuan(k.receivableAmount), `${scope}各期计划中尚未应还的金额合计（含已逾期未还与未到期）`),
        row('待收本金', fmtYuan(k.receivablePrincipal), `${scope}尚有未还款项时整笔计入的卡包本金`),
        row('金额回款进度', `${k.collectionRateByAmount.toFixed(2)}%`, `${scope}已收金额 ÷（已收+待收），反映合同现金流回收比例`),
      ],
    },
    {
      title: '逾期与风控',
      rows: [
        row('全额结清订单', `${k.settledOrderCount}`, `${scope}全部分期均已标记还清的订单笔数`),
        row('在贷未结清', `${k.settlementGapCount}`, `${scope}仍至少有一期未还的订单`),
        row('逾期订单数', String(k.overdueOrderCount), `${scope}存在至少一期逾期未还的笔数`),
        row('逾期率（笔数）', `${k.overdueRate.toFixed(2)}%`, `${scope}动态累计日均，截至昨日（不含当日），各应还日未还笔数占比`),
        row('逾期金额', fmtYuan(k.overdueAmount), `${scope}截至昨日（不含当日），有效应还日已过的未还分期金额合计`),
        row('逾期金额（本金）', fmtYuan(k.overduePrincipalAmount), `${scope}截至昨日（不含当日），有效应还日已过的未还分期本金合计`),
      ],
    },
  ]
})

const totalKpiRows = computed(() => kpiGroups.value.reduce((sum, group) => sum + group.rows.length, 0))

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
  <div class="dash-page">
    <el-card class="simulation-summary-card" shadow="hover">
      <template #header>
        <div class="summary-card-header">
          <div class="summary-card-titles">
            <h2 class="page-title">
              数据概览
            </h2>
            <el-text type="info" size="small" class="page-sub">
              按卡包已发放订单统计成交、回款和逾期指标
            </el-text>
          </div>
          <el-button
            type="primary"
            :icon="Refresh"
            :loading="loading"
            @click="refreshData"
          >
            刷新
          </el-button>
        </div>
      </template>

      <el-form v-if="canAdjustSimulation" class="simulation-control-form" :model="model" inline @submit.prevent>
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
    </el-card>

    <el-card class="simulation-table-card" shadow="hover">
      <template #header>
        <div class="table-card-header">
          <span class="table-card-title">统计明细</span>
          <el-tag type="info" effect="plain" size="small">
            共 {{ totalKpiRows }} 项
          </el-tag>
        </div>
      </template>

      <div class="simulation-table-wrap">
        <el-table
          v-loading="loading"
          :data="kpiGroups"
          row-key="title"
          stripe
          border
          size="default"
          class="simulation-table"
          :header-cell-style="tableHeaderCellStyle"
          :highlight-current-row="true"
          default-expand-all
        >
          <template #empty>
            <el-empty description="暂无统计数据" :image-size="88" />
          </template>
          <el-table-column type="expand">
            <template #default="{ row }">
              <el-table
                :data="row.rows"
                row-key="label"
                border
                size="default"
                class="metric-table"
                :header-cell-style="tableHeaderCellStyle"
              >
                <el-table-column prop="label" label="指标" min-width="150" show-overflow-tooltip />
                <el-table-column prop="value" label="数值" min-width="160" align="right" />
                <el-table-column prop="hint" label="说明" min-width="360" show-overflow-tooltip />
              </el-table>
            </template>
          </el-table-column>
          <el-table-column prop="title" label="分组" min-width="180" />
          <el-table-column label="指标数量" width="120" align="center">
            <template #default="{ row }">
              {{ row.rows.length }} 项
            </template>
          </el-table-column>
        </el-table>
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.dash-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.simulation-summary-card,
.simulation-table-card {
  border-radius: 12px;
}

.summary-card-header,
.table-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.summary-card-titles {
  min-width: 0;
}

.page-title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: var(--el-text-color-primary);
}

.page-sub {
  display: block;
  margin-top: 6px;
  line-height: 1.4;
}

.simulation-control-form {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 12px;
}

.simulation-control-form :deep(.el-form-item) {
  margin-right: 0;
  margin-bottom: 0;
}

.simulation-control-form :deep(.el-input-number) {
  width: 180px;
}

.table-card-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--el-text-color-primary);
}

.simulation-table-wrap {
  width: 100%;
  overflow-x: auto;
}

.simulation-table,
.metric-table {
  width: 100%;
}

.metric-table {
  margin: 8px 0;
}

@media (max-width: 900px) {
  .summary-card-header,
  .table-card-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .simulation-control-form :deep(.el-input-number) {
    width: 100%;
  }
}
</style>
