<script setup lang="ts">
import { Refresh } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { onMounted, reactive, ref } from 'vue'
import { apiErrorMessage, withMallTenantHeaders } from '../composables/useAdminApi'
import TrafficChannelNameTag from '../components/TrafficChannelNameTag.vue'
import { trafficChannelDisplayKey } from '../utils/trafficChannelTagStyle'

const MALL_API_BASE = `${(import.meta.env.VITE_MALL_API_BASE || 'http://localhost:3110/api').replace(/\/$/, '')}`

interface RepaymentRecordRow {
  id: string
  outTradeNo: string
  tradeNo: string
  bizType: string
  bizTypeLabel: string
  payChannel: string
  paymentMethodLabel: string
  status: string
  statusLabel: string
  tradeState: string
  paidAmount: number
  createdAt: string
  paidAt: string
  subject: string
  orderId: string
  period: number
  mallUserId: string
  mallUserPhone: string
  buyerName: string
  buyerAdminRemark: string
  registerChannelCode?: string
  registerChannelName?: string
  registerChannelLabel?: string
}

const loading = ref(false)
const requestSeq = ref(0)
const rows = ref<RepaymentRecordRow[]>([])
const totalRows = ref(0)
const page = ref(1)
const pageSize = ref(50)
const filters = reactive({
  keyword: '',
  paidRange: [] as string[],
})
const appliedFilters = reactive({
  keyword: '',
  paidRange: [] as string[],
})
const tableHeaderCellStyle = {
  background: 'var(--el-fill-color-light)',
  color: 'var(--el-text-color-primary)',
  fontWeight: 600,
}

function registerChannelDisplayForRow(row: RepaymentRecordRow): string {
  return trafficChannelDisplayKey(row.registerChannelLabel, row.registerChannelName, row.registerChannelCode)
}

function formatDateTime(value: string) {
  if (!value)
    return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime()))
    return value
  const y = date.getFullYear()
  const m = `${date.getMonth() + 1}`.padStart(2, '0')
  const d = `${date.getDate()}`.padStart(2, '0')
  const hh = `${date.getHours()}`.padStart(2, '0')
  const mm = `${date.getMinutes()}`.padStart(2, '0')
  return `${y}-${m}-${d} ${hh}:${mm}`
}

function formatMoney(value: number) {
  return Number(value || 0).toFixed(2)
}

function applyFilters() {
  appliedFilters.keyword = filters.keyword.trim()
  appliedFilters.paidRange = Array.isArray(filters.paidRange) ? [...filters.paidRange] : []
  page.value = 1
  void load()
}

function resetFilters() {
  filters.keyword = ''
  filters.paidRange = []
  applyFilters()
}

function appendDateRange(qs: URLSearchParams, prefix: 'paid', range: string[]) {
  if (!Array.isArray(range) || range.length !== 2)
    return
  const [start, end] = range
  if (start)
    qs.set(`${prefix}StartDate`, start)
  if (end)
    qs.set(`${prefix}EndDate`, end)
}

async function load() {
  const seq = requestSeq.value + 1
  requestSeq.value = seq
  loading.value = true
  try {
    const qs = new URLSearchParams({
      page: String(page.value),
      pageSize: String(pageSize.value),
      status: 'paid',
      paymentChannel: 'all',
    })
    if (appliedFilters.keyword)
      qs.set('keyword', appliedFilters.keyword)
    appendDateRange(qs, 'paid', appliedFilters.paidRange)

    const response = await fetch(`${MALL_API_BASE}/admin/orders/repayment-records?${qs.toString()}`, {
      method: 'GET',
      headers: withMallTenantHeaders(),
    })
    const payload = await response.json() as {
      success?: boolean
      msg?: string
      data?: {
        rows?: RepaymentRecordRow[]
        total?: number
        page?: number
        pageSize?: number
        summary?: unknown
      }
    }
    if (seq !== requestSeq.value)
      return
    if (!response.ok || payload.success === false) {
      throw new Error(apiErrorMessage(payload, '加载还款记录失败'))
    }
    rows.value = Array.isArray(payload.data?.rows) ? payload.data!.rows! : []
    totalRows.value = Number(payload.data?.total || 0)
  }
  catch (error) {
    if (seq === requestSeq.value) {
      rows.value = []
      totalRows.value = 0
      ElMessage.error(error instanceof Error ? error.message : '加载还款记录失败')
    }
  }
  finally {
    if (seq === requestSeq.value)
      loading.value = false
  }
}

function handlePageChange(nextPage: number) {
  page.value = nextPage
  void load()
}

function handlePageSizeChange(nextSize: number) {
  pageSize.value = nextSize
  page.value = 1
  void load()
}

onMounted(() => {
  void load()
})
</script>

<template>
  <div class="receivable-page">
    <el-card class="receivable-table-card" shadow="hover">
      <template #header>
        <div class="table-card-header">
          <div>
            <span class="table-card-title">还款记录</span>
           
          </div>
          <el-button type="primary" :icon="Refresh" :loading="loading" @click="load">
            刷新
          </el-button>
        </div>
      </template>

      <div class="receivable-toolbar">
        <el-date-picker
          v-model="filters.paidRange"
          class="receivable-date-range"
          style="width: 250px"
          type="daterange"
          value-format="YYYY-MM-DD"
          start-placeholder="开始"
          end-placeholder="结束"
          range-separator="至"
          :disabled="loading"
        />
        <el-input
          v-model="filters.keyword"
          class="receivable-search-input"
          style="width: 260px"
          placeholder="搜索流水号 / 用户 / 手机号 / 订单号"
          clearable
          @keyup.enter="applyFilters"
        />
        <el-button class="toolbar-btn toolbar-btn--query" :disabled="loading" @click="applyFilters">
          查询
        </el-button>
        <el-button class="toolbar-btn toolbar-btn--reset" :disabled="loading" @click="resetFilters">
          重置
        </el-button>
      </div>

      <div class="receivable-table-wrap">
        <el-table
          v-loading="loading"
          :data="rows"
          row-key="id"
          stripe
          border
          size="default"
          class="receivable-table"
          :header-cell-style="tableHeaderCellStyle"
          :highlight-current-row="true"
        >
          <template #empty>
            <el-empty description="暂无还款记录" :image-size="88" />
          </template>
          <el-table-column label="用户（注册）" min-width="120" show-overflow-tooltip>
            <template #default="{ row }">
              {{ (row.buyerName || '').trim() || '—' }}
            </template>
          </el-table-column>
          <el-table-column label="注册手机" min-width="120" show-overflow-tooltip>
            <template #default="{ row }">
              {{ row.mallUserPhone || '—' }}
            </template>
          </el-table-column>
          <el-table-column label="注册渠道" min-width="120" show-overflow-tooltip>
            <template #default="{ row }">
              <span class="td-register-channel">
                <TrafficChannelNameTag
                  :display-key="registerChannelDisplayForRow(row)"
                  :color-seed="row.registerChannelCode || undefined"
                />
              </span>
            </template>
          </el-table-column>
          <el-table-column label="支付金额（元）" min-width="130" align="right">
            <template #default="{ row }">
              <span class="amount-cell">{{ formatMoney(row.paidAmount) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="支付状态" width="110" align="center">
            <template #default="{ row }">
              <el-tag type="success" effect="plain" size="small">
                {{ row.statusLabel || '已支付' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="paymentMethodLabel" label="支付方式" min-width="140" show-overflow-tooltip />
          <el-table-column label="支付成功时间" min-width="150">
            <template #default="{ row }">
              {{ formatDateTime(row.paidAt) }}
            </template>
          </el-table-column>
          <el-table-column label="支付创建时间" min-width="150">
            <template #default="{ row }">
              {{ formatDateTime(row.createdAt) }}
            </template>
          </el-table-column>
          <el-table-column prop="outTradeNo" label="支付流水号" min-width="190" show-overflow-tooltip />
          <el-table-column prop="tradeNo" label="拉卡拉交易号" min-width="180" show-overflow-tooltip />
          <el-table-column prop="orderId" label="订单号" min-width="160" show-overflow-tooltip>
            <template #default="{ row }">
              {{ row.orderId || '—' }}
            </template>
          </el-table-column>
          <el-table-column prop="subject" label="支付标题" min-width="180" show-overflow-tooltip />
          <el-table-column prop="buyerAdminRemark" label="用户备注" min-width="160" show-overflow-tooltip>
            <template #default="{ row }">
              <span
                class="user-remark-preview"
                :class="String(row.buyerAdminRemark || '').trim() ? 'user-remark-preview--filled' : 'user-remark-preview--empty'"
                :title="String(row.buyerAdminRemark || '').trim() || ''"
              >{{ String(row.buyerAdminRemark || '').trim() || '暂无备注' }}</span>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <div v-if="totalRows > pageSize" class="receivable-pagination">
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

.table-card-header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.page-sub {
  display: block;
}

.receivable-table-card {
  flex: 1;
  min-height: 0;
}

.table-card-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.receivable-toolbar {
  display: inline-flex;
  flex-wrap: wrap;
  justify-content: flex-start;
  gap: 8px;
  align-items: center;
  width: auto;
  max-width: 100%;
  margin-bottom: 12px;
}

.receivable-date-range {
  flex: 0 0 250px;
  width: 250px !important;
  max-width: 250px;
}

.receivable-date-range :deep(.el-range-input) {
  width: 84px;
}

.receivable-date-range :deep(.el-range-separator) {
  flex: 0 0 22px;
  padding: 0;
}

.receivable-search-input {
  flex: 0 0 260px;
  width: 260px !important;
  max-width: 260px;
}

.toolbar-btn {
  min-width: 58px;
  border: 0;
  font-weight: 600;
}

.toolbar-btn--query {
  color: #fff;
  background: #16a34a;
}

.toolbar-btn--query:hover,
.toolbar-btn--query:focus {
  color: #fff;
  background: #15803d;
}

.toolbar-btn--reset {
  color: #475569;
  background: #e2e8f0;
}

.toolbar-btn--reset:hover,
.toolbar-btn--reset:focus {
  color: #334155;
  background: #cbd5e1;
}

.receivable-table-wrap {
  width: 100%;
  overflow-x: auto;
}

.receivable-table {
  width: 100%;
  min-width: 1690px;
}

.receivable-table :deep(.el-table__row:hover > td) {
  background-color: var(--el-fill-color-lighter) !important;
}

.amount-cell {
  font-variant-numeric: tabular-nums;
  font-weight: 500;
  color: var(--el-text-color-primary);
}

.user-remark-preview {
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-remark-preview--empty {
  font-size: 12px;
  font-weight: 400;
  color: var(--el-text-color-secondary);
}

.user-remark-preview--filled {
  font-size: 14px;
  font-weight: 700;
  color: #2563eb;
  letter-spacing: 0.01em;
}

.td-register-channel {
  display: inline-flex;
  max-width: 100%;
}

.receivable-pagination {
  display: flex;
  justify-content: flex-end;
  padding-top: 16px;
}

@media (max-width: 900px) {
  .table-card-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .receivable-date-range,
  .receivable-search-input {
    flex-basis: 100%;
    width: 100% !important;
    max-width: 100%;
  }

  .receivable-pagination {
    justify-content: flex-start;
    overflow-x: auto;
  }
}
</style>