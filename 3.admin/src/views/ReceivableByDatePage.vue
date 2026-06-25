<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { CirclePlus, EditPen, Refresh } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { useRoute } from 'vue-router'
import { apiErrorMessage, withMallTenantHeaders } from '../composables/useAdminApi'
import { useAdminPagePermission } from '../composables/useAdminPagePermission'

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
  /** 该期是否已还款入账 */
  isPaid?: boolean
  repaymentDisplayStatus?: 'paid' | 'unpaid' | 'deferred_as_collected'
  deferredAsCollected?: boolean
  /** 待收期次还款备注（与用户 adminRemark 无关） */
  collectionRemark?: string
  /** 注册用户备注（只读展示，与 collectionRemark 无关） */
  buyerAdminRemark?: string
}

type RepaymentStatusFilter = 'all' | 'paid' | 'unpaid'

const REPAYMENT_STATUS_OPTIONS: Array<{ label: string, value: RepaymentStatusFilter }> = [
  { label: '全部', value: 'all' },
  { label: '已还款', value: 'paid' },
  { label: '未还款', value: 'unpaid' },
]

const route = useRoute()
const { canRemark, canView } = useAdminPagePermission(undefined, true)
const canEditCollectionRemark = computed(() => canRemark.value || canView.value)
const loading = ref(false)
const errorMsg = ref('')
const rows = ref<PendingReceivableRow[]>([])
const keyword = ref('')
const appliedKeyword = ref('')
const repaymentStatusFilter = ref<RepaymentStatusFilter>('all')
const appliedRepaymentStatus = ref<RepaymentStatusFilter>('all')
const page = ref(1)
const pageSize = ref(50)
const totalRows = ref(0)
/** 应还日 = 统计日 的期次：应还总额（已还+未还） */
const totalDueOnDate = ref(0)
const totalDueOnDateCount = ref(0)
/** 应还日 = 统计日 且已还 */
const paidDueOnDate = ref(0)
const paidDueOnDateCount = ref(0)
/** 应还日 = 统计日 且未还（与明细合计一致） */
const unpaidDueOnDate = ref(0)
const unpaidDueOnDateCount = ref(0)
/** 今日到期后延期，统计上视同已回款但不是真实入账 */
const deferredAsCollectedAmount = ref(0)
const deferredAsCollectedCount = ref(0)
/** 应还日 = 统计日 的已还/未还笔数占比 */
const collectionRateOnDate = ref(0)
const unpaidRateOnDate = ref(0)

const remarkDialogVisible = ref(false)
const remarkSaving = ref(false)
const remarkTarget = ref<PendingReceivableRow | null>(null)
const remarkDraft = ref('')

const offsetDays = computed(() => {
  const raw = route.meta.receivableOffsetDays
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0
})

const isDatePickerMode = computed(() => Boolean(route.meta.receivableDatePicker))

function formatLocalYmd(d: Date) {
  const y = d.getFullYear()
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${y}-${m}-${day}`
}

const selectedDueDate = ref(formatLocalYmd(new Date()))

const dueDate = computed(() => {
  if (isDatePickerMode.value && /^\d{4}-\d{2}-\d{2}$/.test(selectedDueDate.value)) {
    return selectedDueDate.value
  }
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
  appliedRepaymentStatus.value = repaymentStatusFilter.value
  page.value = 1
  void load()
}

function applyRepaymentStatusFilter() {
  appliedRepaymentStatus.value = repaymentStatusFilter.value
  page.value = 1
  void load()
}

function repaymentStatusTagType(row: PendingReceivableRow): 'success' | 'warning' | 'primary' {
  if (row.deferredAsCollected) {
    return 'primary'
  }
  if (row.isPaid) {
    return 'success'
  }
  return 'warning'
}

function repaymentStatusLabel(row: PendingReceivableRow): string {
  if (row.deferredAsCollected) {
    return '已延期'
  }
  if (row.isPaid) {
    return '已还款'
  }
  return '未还款'
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

const statDayPrefix = computed(() => {
  if (isDatePickerMode.value) {
    return '当日'
  }
  return offsetDays.value === 0 ? '今日' : '明日'
})

const base = `${(import.meta.env.VITE_MALL_API_BASE || 'http://localhost:3110/api').replace(/\/$/, '')}`

const statisticAmountStyle = {
  color: '#b45309',
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
    qs.set('repaymentStatus', appliedRepaymentStatus.value)
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
        totalDueOnDateCount?: number
        paidDueOnDateCount?: number
        unpaidDueOnDateCount?: number
        deferredAsCollectedAmount?: number
        deferredAsCollectedCount?: number
        collectionRateOnDate?: number
        unpaidRateOnDate?: number
      }
    }
    try {
      payload = JSON.parse(text) as typeof payload
    }
    catch {
      throw new Error(text.slice(0, 120) || '接口返回格式异常')
    }
    if (!res.ok || !payload.success) {
      throw new Error(apiErrorMessage(payload, '请求失败'))
    }
    const list = Array.isArray(payload.data?.rows) ? payload.data!.rows! : []
    rows.value = list
    totalRows.value = Number(payload.data?.total ?? list.length)
    const unpaid = Number(payload.data?.unpaidDueOnDate ?? payload.data?.totalAmount ?? 0)
    unpaidDueOnDate.value = unpaid
    totalDueOnDate.value = Number(payload.data?.totalDueOnDate ?? unpaid)
    paidDueOnDate.value = Number(payload.data?.paidDueOnDate ?? 0)
    totalDueOnDateCount.value = Number(payload.data?.totalDueOnDateCount ?? 0)
    paidDueOnDateCount.value = Number(payload.data?.paidDueOnDateCount ?? 0)
    unpaidDueOnDateCount.value = Number(payload.data?.unpaidDueOnDateCount ?? totalRows.value)
    deferredAsCollectedAmount.value = Number(payload.data?.deferredAsCollectedAmount ?? 0)
    deferredAsCollectedCount.value = Number(payload.data?.deferredAsCollectedCount ?? 0)
    collectionRateOnDate.value = Number(payload.data?.collectionRateOnDate ?? 0)
    unpaidRateOnDate.value = Number(payload.data?.unpaidRateOnDate ?? 0)
  }
  catch (e) {
    errorMsg.value = e instanceof Error ? e.message : '加载失败'
    rows.value = []
    totalRows.value = 0
    totalDueOnDate.value = 0
    paidDueOnDate.value = 0
    unpaidDueOnDate.value = 0
    totalDueOnDateCount.value = 0
    paidDueOnDateCount.value = 0
    unpaidDueOnDateCount.value = 0
    deferredAsCollectedAmount.value = 0
    deferredAsCollectedCount.value = 0
    collectionRateOnDate.value = 0
    unpaidRateOnDate.value = 0
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
    if (isDatePickerMode.value && !/^\d{4}-\d{2}-\d{2}$/.test(selectedDueDate.value)) {
      selectedDueDate.value = formatLocalYmd(new Date())
    }
    appliedKeyword.value = ''
    keyword.value = ''
    repaymentStatusFilter.value = 'all'
    appliedRepaymentStatus.value = 'all'
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

function openRemarkDialog(row: PendingReceivableRow) {
  if (!canEditCollectionRemark.value) {
    return
  }
  remarkTarget.value = row
  remarkDraft.value = String(row.collectionRemark || '').trim()
  remarkDialogVisible.value = true
}

function closeRemarkDialog(force = false) {
  if (!force && remarkSaving.value) {
    return
  }
  remarkDialogVisible.value = false
  remarkTarget.value = null
  remarkDraft.value = ''
}

function patchRowCollectionRemark(orderId: string, period: number, collectionRemark: string) {
  const idx = rows.value.findIndex(row => row.orderId === orderId && row.period === period)
  if (idx >= 0) {
    rows.value[idx] = { ...rows.value[idx], collectionRemark }
  }
}

async function saveCollectionRemark() {
  if (!remarkTarget.value || remarkSaving.value) {
    return
  }
  const target = remarkTarget.value
  remarkSaving.value = true
  try {
    const url = `${base}/orders/${encodeURIComponent(target.orderId)}/installments/${target.period}/collection-remark`
    const res = await fetch(url, {
      method: 'PATCH',
      headers: withMallTenantHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ collectionRemark: remarkDraft.value.trim() }),
    })
    const payload = await res.json() as {
      success?: boolean
      msg?: string
      data?: { collectionRemark?: string }
    }
    if (!res.ok || !payload.success) {
      throw new Error(apiErrorMessage(payload, '保存还款备注失败'))
    }
    const saved = String(payload.data?.collectionRemark ?? remarkDraft.value.trim()).trim()
    patchRowCollectionRemark(target.orderId, target.period, saved)
    ElMessage.success(saved ? '还款备注已保存' : '还款备注已删除')
    closeRemarkDialog(true)
  }
  catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存还款备注失败')
  }
  finally {
    remarkSaving.value = false
  }
}

async function clearCollectionRemark() {
  remarkDraft.value = ''
  await saveCollectionRemark()
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

      <div
        v-if="isDatePickerMode"
        class="summary-date-toolbar"
      >
        <span class="summary-date-toolbar__label">选择统计日期</span>
          <el-date-picker
            v-model="selectedDueDate"
            class="summary-date-picker"
            type="date"
            value-format="YYYY-MM-DD"
            format="YYYY-MM-DD"
            placeholder="请选择统计日期"
            :clearable="false"
            :disabled="loading"
          />
      </div>

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
            应还日=统计日，已还/视同+未还（{{ totalDueOnDateCount }} 笔）
          </p>
        </el-col>
        <el-col
          :xs="24"
          :sm="12"
          :lg="6"
        >
          <el-statistic
            title="已回款/视同金额（元）"
            :value="paidDueOnDate"
            :precision="2"
          />
          <p class="stat-sub">
            真实已入账 + 协商延期视同（{{ paidDueOnDateCount }} 笔）
            <template v-if="deferredAsCollectedCount > 0">
              ，其中视同 {{ deferredAsCollectedCount }} 笔 / {{ deferredAsCollectedAmount.toFixed(2) }} 元
            </template>
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
            应还日=统计日且未还（{{ unpaidDueOnDateCount }} 笔）
          </p>
        </el-col>
        <el-col
          :xs="24"
          :sm="12"
          :lg="6"
        >
          <div
            class="rate-pair"
            :aria-label="`${statDayPrefix}回款率 ${collectionRateOnDate.toFixed(2)}%，未还率 ${unpaidRateOnDate.toFixed(2)}%`"
          >
            <div class="rate-pair__item">
              <span class="rate-pair__label">{{ statDayPrefix }}回款率</span>
              <strong class="rate-pair__value rate-pair__value--collection">
                {{ collectionRateOnDate.toFixed(2) }}<span>%</span>
              </strong>
            </div>
            <div class="rate-pair__item">
              <span class="rate-pair__label">未还率</span>
              <strong class="rate-pair__value rate-pair__value--unpaid">
                {{ unpaidRateOnDate.toFixed(2) }}<span>%</span>
              </strong>
            </div>
          </div>
          <p class="stat-sub">
            回款率=真实已还+协商延期视同÷总笔数；未还率=未还笔数÷总笔数
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
        <el-select
          v-model="repaymentStatusFilter"
          class="receivable-status-filter"
          placeholder="还款状态"
          :disabled="loading"
          @change="applyRepaymentStatusFilter"
        >
          <el-option
            v-for="opt in REPAYMENT_STATUS_OPTIONS"
            :key="opt.value"
            :label="opt.label"
            :value="opt.value"
          />
        </el-select>
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
            label="还款备注"
            min-width="160"
          >
            <template #default="{ row }">
              <button
                v-if="canEditCollectionRemark"
                type="button"
                class="remark-cell remark-cell--clickable"
                :title="String(row.collectionRemark || '').trim() ? '点击编辑还款备注' : '点击添加还款备注'"
                @click="openRemarkDialog(row)"
              >
                <span
                  class="remark-cell__icon-wrap"
                  aria-hidden="true"
                >
                  <el-icon
                    class="remark-cell__icon"
                    :class="String(row.collectionRemark || '').trim() ? 'remark-cell__icon--edit' : 'remark-cell__icon--add'"
                    :size="16"
                  >
                    <EditPen v-if="String(row.collectionRemark || '').trim()" />
                    <CirclePlus v-else />
                  </el-icon>
                </span>
                <span
                  class="remark-cell__text remark-preview"
                  :class="String(row.collectionRemark || '').trim() ? 'remark-preview--filled' : 'remark-preview--empty'"
                >{{ String(row.collectionRemark || '').trim() || '暂无备注' }}</span>
              </button>
              <span
                v-else
                class="remark-preview remark-preview--readonly"
                :title="String(row.collectionRemark || '').trim() || ''"
              >{{ String(row.collectionRemark || '').trim() || '—' }}</span>
            </template>
          </el-table-column>
          <el-table-column
            label="用户备注"
            min-width="160"
            show-overflow-tooltip
          >
            <template #default="{ row }">
              <span
                class="user-remark-preview"
                :class="String(row.buyerAdminRemark || '').trim() ? 'user-remark-preview--filled' : 'user-remark-preview--empty'"
                :title="String(row.buyerAdminRemark || '').trim() || ''"
              >{{ String(row.buyerAdminRemark || '').trim() || '暂无备注' }}</span>
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
            label="还款状态"
            width="110"
            align="center"
          >
            <template #default="{ row }">
              <el-tag
                :type="repaymentStatusTagType(row)"
                effect="plain"
                size="small"
                :class="{ 'repay-status-tag--deferred': row.deferredAsCollected }"
              >
                {{ repaymentStatusLabel(row) }}
              </el-tag>
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

    <el-dialog
      v-model="remarkDialogVisible"
      title="还款备注"
      width="480px"
      :close-on-click-modal="!remarkSaving"
      :close-on-press-escape="!remarkSaving"
      @closed="closeRemarkDialog(true)"
    >
      <p
        v-if="remarkTarget"
        class="remark-dialog-meta"
      >
        订单 {{ remarkTarget.orderId }} · 第 {{ remarkTarget.period }} 期 · 应还日 {{ remarkTarget.dueDate }}
      </p>
      <el-input
        v-model="remarkDraft"
        type="textarea"
        :rows="4"
        maxlength="500"
        show-word-limit
        placeholder="填写本期待收的还款备注（与用户备注无关）"
        :disabled="remarkSaving"
      />
      <template #footer>
        <el-button
          :disabled="remarkSaving"
          @click="closeRemarkDialog()"
        >
          取消
        </el-button>
        <el-button
          v-if="String(remarkTarget?.collectionRemark || '').trim()"
          type="danger"
          plain
          :loading="remarkSaving"
          @click="clearCollectionRemark"
        >
          删除备注
        </el-button>
        <el-button
          type="primary"
          :loading="remarkSaving"
          @click="saveCollectionRemark"
        >
          保存
        </el-button>
      </template>
    </el-dialog>
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

.summary-date-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  padding: 0 0 16px;
  margin: 0 0 14px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.summary-date-toolbar__label {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.summary-date-picker {
  width: min(100%, 240px);
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

.rate-pair {
  display: flex;
  align-items: flex-start;
  gap: 28px;
}

.rate-pair__item {
  min-width: 96px;
}

.rate-pair__label {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.rate-pair__value {
  display: inline-flex;
  align-items: baseline;
  gap: 3px;
  font-size: 20px;
  line-height: 1;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.rate-pair__value span {
  font-size: 16px;
  font-weight: 500;
}

.rate-pair__value--collection {
  color: #be123c;
}

.rate-pair__value--unpaid {
  color: #b45309;
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

.receivable-status-filter {
  width: 132px;
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

.status-sub {
  margin-top: 4px;
  font-size: 11px;
  line-height: 1.2;
  color: var(--el-text-color-secondary);
}

/* 已延期：与未还款(橙)、已还款(绿)区分，与订单页 primary 标签色系统一 */
.receivable-table :deep(.repay-status-tag--deferred.el-tag--primary) {
  --el-tag-bg-color: #eff6ff;
  --el-tag-border-color: #93c5fd;
  --el-tag-text-color: #1d4ed8;
  font-weight: 600;
}

.status-sub--deferred {
  color: #2563eb;
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

.remark-cell {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  width: 100%;
  padding: 0;
  margin: 0;
  border: none;
  background: transparent;
  text-align: left;
  font: inherit;
  color: inherit;
}

.remark-cell--clickable {
  cursor: pointer;
}

.remark-cell--clickable:hover .remark-preview--empty {
  color: var(--el-color-primary);
}

.remark-cell--clickable:hover .remark-preview--filled {
  color: #b91c1c;
}

.remark-cell__icon-wrap {
  flex-shrink: 0;
  line-height: 1.4;
  padding-top: 2px;
}

.remark-cell__icon--add {
  color: var(--el-color-primary);
}

.remark-cell__icon--edit {
  color: #dc2626;
}

.remark-cell__text {
  min-width: 0;
  line-height: 1.45;
  word-break: break-word;
}

.remark-preview {
  font-size: 13px;
}

.remark-preview--filled {
  font-size: 14px;
  font-weight: 700;
  color: #dc2626;
  letter-spacing: 0.01em;
}

.remark-preview--empty {
  font-size: 12px;
  font-weight: 400;
  color: var(--el-text-color-placeholder);
}

.remark-preview--readonly {
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 700;
  color: #dc2626;
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

.remark-dialog-meta {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
  line-height: 1.45;
}
</style>
