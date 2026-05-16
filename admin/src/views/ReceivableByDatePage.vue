<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import { useRoute } from 'vue-router'
import { withMallTenantHeaders } from '../composables/useAdminApi'

interface PendingReceivableRow {
  orderId: string
  receiverName: string
  receiverPhone: string
  productName: string
  period: number
  dueDate: string
  amount: number
}

const route = useRoute()
const loading = ref(false)
const errorMsg = ref('')
const rows = ref<PendingReceivableRow[]>([])
/** 应还日 = 统计日 的期次：应还总额（已还+未还） */
const totalDueOnDate = ref(0)
/** 应还日 = 统计日 且已还 */
const paidDueOnDate = ref(0)
/** 应还日 = 统计日 且未还（与明细合计一致） */
const unpaidDueOnDate = ref(0)
/** 应还日早于统计日且未还 ÷ 应还日不晚于统计日且未还 */
const overdueRateAsOfDate = ref(0)

const offsetDays = computed(() => {
  const raw = route.meta.receivableOffsetDays
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0
})

function formatLocalYmd(d: Date) {
  const y = d.getFullYear()
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${y}-${m}-${day}`
}

const dueDate = computed(() => {
  const base = new Date()
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offsetDays.value)
  return formatLocalYmd(d)
})

const routeTitle = computed(() => String(route.meta.title || '待收'))

const pageHint = computed(() => `统计日 ${dueDate.value}`)

const statDayPrefix = computed(() => (offsetDays.value === 0 ? '今日' : '明日'))

const base = `${(import.meta.env.VITE_MALL_API_BASE || 'http://localhost:3110/api').replace(/\/$/, '')}`

const statisticAmountStyle = {
  color: '#b45309',
  fontWeight: 600 as const,
}

const statisticRateStyle = {
  color: '#be123c',
  fontWeight: 600 as const,
}

const tableHeaderCellStyle = {
  background: 'var(--el-fill-color-light)',
  color: 'var(--el-text-color-primary)',
  fontWeight: 600,
}

async function load() {
  loading.value = true
  errorMsg.value = ''
  try {
    const url = `${base}/orders/pending-receivable?dueDate=${encodeURIComponent(dueDate.value)}`
    const res = await fetch(url, { method: 'GET', headers: withMallTenantHeaders() })
    const text = await res.text()
    let payload: {
      success?: boolean
      msg?: string
      data?: {
        rows?: PendingReceivableRow[]
        totalAmount?: number
        totalDueOnDate?: number
        paidDueOnDate?: number
        unpaidDueOnDate?: number
        overdueRateAsOfDate?: number
      }
    }
    try {
      payload = JSON.parse(text) as typeof payload
    }
    catch {
      throw new Error(text.slice(0, 120) || `响应非 JSON: ${res.status}`)
    }
    if (!res.ok || !payload.success) {
      throw new Error(payload.msg || `请求失败: ${res.status}`)
    }
    const list = Array.isArray(payload.data?.rows) ? payload.data!.rows! : []
    rows.value = list
    const unpaid = Number(payload.data?.unpaidDueOnDate ?? payload.data?.totalAmount ?? 0)
    unpaidDueOnDate.value = unpaid
    totalDueOnDate.value = Number(payload.data?.totalDueOnDate ?? unpaid)
    paidDueOnDate.value = Number(payload.data?.paidDueOnDate ?? 0)
    overdueRateAsOfDate.value = Number(payload.data?.overdueRateAsOfDate ?? 0)
  }
  catch (e) {
    errorMsg.value = e instanceof Error ? e.message : '加载失败'
    rows.value = []
    totalDueOnDate.value = 0
    paidDueOnDate.value = 0
    unpaidDueOnDate.value = 0
    overdueRateAsOfDate.value = 0
  }
  finally {
    loading.value = false
  }
}

onMounted(() => {
  void load()
})

watch(
  () => [route.name, dueDate.value] as const,
  () => {
    void load()
  },
)
</script>

<template>
  <div class="receivable-page">
    <el-card
      class="receivable-summary-card"
      shadow="hover"
    >
      <template #header>
        <div class="summary-card-header">
          <div class="summary-card-titles">
            <h2 class="page-title">
              {{ routeTitle }}
            </h2>
            <el-text
              type="info"
              size="small"
              class="page-sub"
            >
              {{ pageHint }}
            </el-text>
          </div>
          <el-button
            type="primary"
            :icon="Refresh"
            :loading="loading"
            @click="load"
          >
            刷新
          </el-button>
        </div>
      </template>

      <el-row
        :gutter="16"
        class="stat-row"
      >
        <el-col
          :xs="24"
          :sm="12"
          :lg="6"
        >
          <el-statistic
            :title="`${statDayPrefix}待收总额（元）`"
            :value="totalDueOnDate"
            :precision="2"
            :value-style="statisticAmountStyle"
          />
          <p class="stat-sub">
            应还日=统计日，已还+未还
          </p>
        </el-col>
        <el-col
          :xs="24"
          :sm="12"
          :lg="6"
        >
          <el-statistic
            title="已还款金额（元）"
            :value="paidDueOnDate"
            :precision="2"
          />
          <p class="stat-sub">
            应还日=统计日且已入账
          </p>
        </el-col>
        <el-col
          :xs="24"
          :sm="12"
          :lg="6"
        >
          <el-statistic
            title="未还款金额（元）"
            :value="unpaidDueOnDate"
            :precision="2"
            :value-style="statisticAmountStyle"
          />
          <p class="stat-sub">
            应还日=统计日且未还（{{ rows.length }} 笔）
          </p>
        </el-col>
        <el-col
          :xs="24"
          :sm="12"
          :lg="6"
        >
          <el-statistic
            :title="`${statDayPrefix}逾期率`"
            :value="overdueRateAsOfDate"
            :precision="2"
            suffix="%"
            :value-style="statisticRateStyle"
          />
          <p class="stat-sub">
            应还早于统计日且未还 ÷ 应还不晚于统计日且未还
          </p>
        </el-col>
      </el-row>
    </el-card>

    <el-alert
      v-if="errorMsg"
      type="error"
      :closable="false"
      :title="errorMsg"
      show-icon
      class="receivable-alert"
    />

    <el-card
      class="receivable-table-card"
      shadow="hover"
    >
      <template #header>
        <div class="table-card-header">
          <span class="table-card-title">待收明细</span>
          <el-tag
            v-if="rows.length"
            type="warning"
            effect="plain"
            size="small"
          >
            共 {{ rows.length }} 笔
          </el-tag>
        </div>
      </template>

      <div class="receivable-table-wrap">
        <el-table
          v-loading="loading"
          :data="rows"
          stripe
          border
          size="default"
          class="receivable-table"
          :header-cell-style="tableHeaderCellStyle"
          :highlight-current-row="true"
        >
          <template #empty>
            <el-empty
              description="暂无待收记录"
              :image-size="88"
            />
          </template>
          <el-table-column
            prop="receiverName"
            label="姓名"
            min-width="120"
            show-overflow-tooltip
          />
          <el-table-column
            prop="amount"
            label="待收金额（元）"
            min-width="130"
            align="right"
          >
            <template #default="{ row }">
              <span class="amount-cell">{{ Number(row.amount).toFixed(2) }}</span>
            </template>
          </el-table-column>
          <el-table-column
            prop="dueDate"
            label="应还日"
            width="120"
          />
          <el-table-column
            prop="period"
            label="期数"
            width="80"
            align="center"
          />
          <el-table-column
            prop="orderId"
            label="订单号"
            min-width="160"
            show-overflow-tooltip
          />
          <el-table-column
            prop="productName"
            label="商品"
            min-width="160"
            show-overflow-tooltip
          />
          <el-table-column
            prop="receiverPhone"
            label="手机号"
            min-width="120"
          />
        </el-table>
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.receivable-page {
  box-sizing: border-box;
  width: 100%;
  max-width: 100%;
  min-height: 100%;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.summary-card-header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.summary-card-titles {
  min-width: 0;
}

.page-title {
  margin: 0 0 6px;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--el-text-color-primary);
  letter-spacing: 0.02em;
}

.page-sub {
  display: block;
}

.stat-row {
  padding-top: 4px;
}

.stat-sub {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.35;
}

.receivable-summary-card :deep(.el-statistic__head) {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.receivable-summary-card {
  flex-shrink: 0;
}

.receivable-alert {
  margin: 0;
  flex-shrink: 0;
}

.receivable-table-card {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.receivable-table-card :deep(.el-card__body) {
  padding-top: 8px;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.table-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.table-card-title {
  font-weight: 600;
  font-size: 15px;
  color: var(--el-text-color-primary);
}

.receivable-table-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.receivable-table {
  width: 100%;
  min-width: 720px;
}

.receivable-table :deep(.el-table__row:hover > td) {
  background-color: var(--el-fill-color-lighter) !important;
}

.amount-cell {
  font-variant-numeric: tabular-nums;
  font-weight: 500;
  color: var(--el-text-color-primary);
}
</style>
