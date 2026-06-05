<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import { useRoute } from 'vue-router'
import { withMallTenantHeaders } from '../composables/useAdminApi'

interface PendingReceivableRow {
  orderId: string
  /** 注册用户信息（待收维度与账号一致） */
  buyerName: string
  buyerPhone: string
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
const keyword = ref('')
const appliedKeyword = ref('')
const page = ref(1)
const pageSize = ref(50)
const totalRows = ref(0)
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

function normalizePhoneDigits(raw: string): string {
  return String(raw || '').replace(/\D/g, '')
}

function applySearch() {
  appliedKeyword.value = keyword.value.trim()
  page.value = 1
  void load()
}

const filteredRows = computed(() => {
  const kw = appliedKeyword.value
  if (!kw) {
    return rows.value
  }
  const kwLower = kw.toLowerCase()
  const kwDigits = normalizePhoneDigits(kw)
  return rows.value.filter((row) => {
    if (String(row.orderId || '').includes(kw)) {
      return true
    }
    if (String(row.productName || '').toLowerCase().includes(kwLower)) {
      return true
    }
    if (String(row.buyerName || '').toLowerCase().includes(kwLower)) {
      return true
    }
    if (String(row.receiverName || '').toLowerCase().includes(kwLower)) {
      return true
    }
    if (kwDigits) {
      const buyerPhone = normalizePhoneDigits(row.buyerPhone || '')
      const receiverPhone = normalizePhoneDigits(row.receiverPhone || '')
      if (buyerPhone.includes(kwDigits) || receiverPhone.includes(kwDigits)) {
        return true
      }
    }
    return false
  })
})

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
    const qs = new URLSearchParams({ dueDate: dueDate.value })
    if (!appliedKeyword.value) {
      qs.set('page', String(page.value))
      qs.set('pageSize', String(pageSize.value))
    }
    const url = `${base}/orders/pending-receivable?${qs.toString()}`
    const res = await fetch(url, { method: 'GET', headers: withMallTenantHeaders() })
    const text = await res.text()
    let payload: {
      success?: boolean
      msg?: string
      data?: {
        rows?: PendingReceivableRow[]
        total?: number
        page?: number
        pageSize?: number
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
    totalRows.value = Number(payload.data?.total ?? list.length)
    const unpaid = Number(payload.data?.unpaidDueOnDate ?? payload.data?.totalAmount ?? 0)
    unpaidDueOnDate.value = unpaid
    totalDueOnDate.value = Number(payload.data?.totalDueOnDate ?? unpaid)
    paidDueOnDate.value = Number(payload.data?.paidDueOnDate ?? 0)
    overdueRateAsOfDate.value = Number(payload.data?.overdueRateAsOfDate ?? 0)
  }
  catch (e) {
    errorMsg.value = e instanceof Error ? e.message : '加载失败'
    rows.value = []
    totalRows.value = 0
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
    appliedKeyword.value = ''
    keyword.value = ''
    page.value = 1
    void load()
  },
)

function handlePageChange(nextPage: number) {
  page.value = nextPage
  void load()
}

function handlePageSizeChange(nextPageSize: number) {
  pageSize.value = nextPageSize
  page.value = 1
  void load()
}
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
            v-if="filteredRows.length"
            type="warning"
            effect="plain"
            size="small"
          >
            共 {{ filteredRows.length }} 笔
          </el-tag>
        </div>
      </template>

      <div class="receivable-toolbar">
        <el-input
          v-model="keyword"
          class="receivable-search-input"
          placeholder="搜索订单号 / 用户 / 商品 / 手机号"
          clearable
        />
        <el-button
          type="default"
          :disabled="loading"
          @click="applySearch"
        >
          查询
        </el-button>
      </div>

      <div class="receivable-table-wrap">
        <el-table
          v-loading="loading"
          :data="filteredRows"
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
            label="用户（注册）"
            min-width="120"
            show-overflow-tooltip
          >
            <template #default="{ row }">
              {{ (row.buyerName || '').trim() || '—' }}
            </template>
          </el-table-column>
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
            label="注册手机"
            min-width="120"
            show-overflow-tooltip
          >
            <template #default="{ row }">
              {{ row.buyerPhone || '—' }}
            </template>
          </el-table-column>
        </el-table>
      </div>
      <div
        v-if="!appliedKeyword && totalRows > pageSize"
        class="receivable-pagination"
      >
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          background
          layout="total, sizes, prev, pager, next"
          :total="totalRows"
          :page-sizes="[20, 50, 100, 200]"
          @current-change="handlePageChange"
          @size-change="handlePageSizeChange"
        />
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

.receivable-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  flex-shrink: 0;
}

.receivable-search-input {
  width: min(100%, 320px);
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

.receivable-pagination {
  display: flex;
  justify-content: flex-end;
  padding-top: 14px;
}

.amount-cell {
  font-variant-numeric: tabular-nums;
  font-weight: 500;
  color: var(--el-text-color-primary);
}
</style>
