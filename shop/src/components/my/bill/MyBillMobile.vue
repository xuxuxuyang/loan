<script setup lang="ts">
import type { MallBillItem, MallBillNegotiationEntry } from '~/composables/useMallMy'
import type { LakalaPreorderPayload } from '~/composables/useLakalaPayment'
import LakalaPaySheet from '~/components/payment/LakalaPaySheet.vue'
import { h } from 'vue'
import { confirmDialog, notifyError, notifySuccess, notifyWarning } from '~/utils/epFeedback'

const route = useRoute()
const { smartNavigate } = useCustomRouting(route)
const { loginPhone, profile, syncFromStorage } = useMallAuth()
const {
  bills: billList,
  fetchBills,
  fetchSummary,
} = useMallMy()
const currentUserAccount = computed(() => loginPhone.value || profile.value?.phone || '')

const repayingAll = ref(false)
const repayingBillKey = ref<string | null>(null)
const negotiatedPayBillKey = ref<string | null>(null)
const paySheetOpen = ref(false)
const payPreorderPayload = ref<LakalaPreorderPayload | null>(null)
const payAmountYuan = ref(0)
const paySheetTitle = ref('账单支付')

function resolveRepayError(error: unknown): string {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = (error as { data?: { msg?: string, message?: string } }).data
    const m = data?.msg || data?.message
    if (m) {
      return String(m)
    }
  }
  return (error as Error)?.message || '还款失败，请稍后重试'
}

/** 协商展示行与对应分期金额相同，汇总待还时只计分期行 */
function billCountsTowardRepayTotal(item: MallBillItem) {
  return item.billKind !== 'negotiation'
}

function resolveBillPeriod(item: MallBillItem): number {
  const p = Number(item.period)
  if (Number.isFinite(p) && p > 0) {
    return p
  }
  return extractPeriod(item.title)
}

function billRepayPayload(record: MallBillItem): { orderId: string, period: number } | null {
  const orderId = String(record.orderId || extractOrderId(record.title) || '').trim()
  const period = Number.isFinite(Number(record.period)) && Number(record.period) > 0
    ? Number(record.period)
    : extractPeriod(record.title)
  if (!orderId || !period) {
    return null
  }
  return { orderId, period }
}

async function repaySingleRecord(record: MallBillItem) {
  if (record.status !== '待还款' || repayingBillKey.value !== null || repayingAll.value || negotiatedPayBillKey.value !== null) {
    return
  }
  if (record.negotiationPayPending) {
    return
  }
  const payload = billRepayPayload(record)
  if (!payload) {
    notifyError('账单信息不完整，无法还款')
    return
  }
  const amt = Math.abs(Number(record.amount || 0)).toFixed(2)
  try {
    await confirmDialog(
      `确认支付 ￥${amt} 用于本笔账单还款？\n还款成功后将同步更新订单分期状态（与后台管理一致）。`,
      '确认还款',
      {
        confirmButtonText: '确认支付',
        cancelButtonText: '取消',
        type: 'warning',
        customClass: 'bill-m-repay-message-box',
      },
    )
  }
  catch {
    return
  }
  const phone = currentUserAccount.value
  if (!phone) {
    notifyWarning('请先登录')
    return
  }
  repayingBillKey.value = String(record.id)
  payAmountYuan.value = Math.abs(Number(record.amount || 0))
  paySheetTitle.value = '账单还款'
  payPreorderPayload.value = {
    bizType: 'bill_repay',
    payChannel: 'alipay',
    orderId: payload.orderId,
    period: payload.period,
  }
  paySheetOpen.value = true
  repayingBillKey.value = null
}

async function payNegotiatedSingle(record: MallBillItem) {
  const pend = record.negotiationPayPending
  if (!pend || record.status !== '待还款' || negotiatedPayBillKey.value !== null || repayingAll.value || repayingBillKey.value !== null) {
    return
  }
  const amt = Number(pend.negotiatedAmount).toFixed(2)
  const remainderText = Number(pend.remainderAmount).toFixed(2)
  const negotiatedRepayDateText = formatNegotiationDateOnly(pend.remainderDueDate)
  const emphasisDate = { style: { color: '#2563eb', fontWeight: 700 as const } }
  const emphasisPayAmt = { style: { color: '#059669', fontWeight: 700 as const } }
  const emphasisRemain = { style: { color: '#ea580c', fontWeight: 700 as const } }
  const bodyStyle = { lineHeight: '1.65', fontSize: '14px', color: 'rgba(0,0,0,0.78)' }
  try {
    await confirmDialog(
      h('div', { style: bodyStyle }, [
        h('p', { style: { margin: '0 0 14px' } }, [
          '协商还款日期：',
          h('strong', emphasisDate, negotiatedRepayDateText),
        ]),
        h('p', { style: { margin: 0 } }, [
          '确认支付协商金额 ',
          h('strong', emphasisPayAmt, `￥${amt}`),
          '？支付成功后，本期剩余应还金额将更新为 ',
          h('strong', emphasisRemain, `￥${remainderText}`),
        ]),
      ]),
      '协商支付',
      {
        confirmButtonText: '确认支付',
        cancelButtonText: '取消',
        type: 'warning',
        customClass: 'bill-m-repay-message-box',
      },
    )
  }
  catch {
    return
  }
  const phone = currentUserAccount.value
  if (!phone) {
    notifyWarning('请先登录')
    return
  }
  const payload = billRepayPayload(record)
  if (!payload) {
    notifyError('账单信息不完整，无法支付')
    return
  }
  negotiatedPayBillKey.value = String(record.id)
  payAmountYuan.value = Number(pend.negotiatedAmount)
  paySheetTitle.value = '协商支付'
  payPreorderPayload.value = {
    bizType: 'bill_repay_negotiated',
    payChannel: 'alipay',
    orderId: payload.orderId,
    period: payload.period,
  }
  paySheetOpen.value = true
  negotiatedPayBillKey.value = null
}

async function repayAllPending() {
  const pending = billList.value.filter(item => item.status === '待还款' && billCountsTowardRepayTotal(item))
  if (!pending.length || repayingAll.value || repayingBillKey.value !== null || negotiatedPayBillKey.value !== null) {
    return
  }
  const total = pendingRepayTotalAll.value
  const totalText = total.toFixed(2)
  try {
    await confirmDialog(
      `全部待还账单，合计 ￥${totalText}`,
      '立即还款',
      {
        confirmButtonText: '确认支付',
        cancelButtonText: '取消',
        type: 'warning',
        customClass: 'bill-m-repay-message-box',
      },
    )
  }
  catch {
    return
  }
  const phone = currentUserAccount.value
  if (!phone) {
    notifyWarning('请先登录')
    return
  }
  repayingAll.value = true
  payAmountYuan.value = total
  paySheetTitle.value = '一键还款'
  payPreorderPayload.value = {
    bizType: 'bill_repay_all',
    payChannel: 'alipay',
    all: true,
  }
  paySheetOpen.value = true
  repayingAll.value = false
}

async function onBillPaySuccess() {
  const phone = currentUserAccount.value
  if (phone) {
    await Promise.all([fetchBills(phone), fetchSummary(phone)])
  }
}

/**
 * 全部待还期次金额合计（与单行还款、POST /bills/repay all 实际扣款范围一致）。
 */
const pendingRepayTotalAll = computed(() =>
  billList.value
    .filter(item => item.status === '待还款' && billCountsTowardRepayTotal(item))
    .reduce((sum, item) => sum + Math.abs(Number(item.amount || 0)), 0),
)

/** 概览「待还」与一键还款条：与列表、GET /bills.summary.totalPending、GET /my/summary.billPendingAmount 同源（全部待还，非仅本月）。 */
const pendingRepayDisplayTotal = computed(() =>
  Number(pendingRepayTotalAll.value.toFixed(2)),
)

/** 有任意待还期次时展示底部一键还款；金额为全部待还合计。 */
const showRepayAllBar = computed(() => pendingRepayDisplayTotal.value > 0)

/** 账单时间仅展示日期（YYYY-MM-DD） */
function formatBillDateOnly(raw: string) {
  const s = String(raw || '').trim()
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : s
}

/** 协商登记日期：仅年月日（与协商还款日展示一致） */
function formatNegotiationDateOnly(raw: string) {
  const s = String(raw || '').trim()
  if (!s) {
    return '—'
  }
  const ymd = formatBillDateOnly(s)
  return ymd || '—'
}

/** 协商记录下每条历史的还款状态；末条待协商支付时可发起「协商支付」 */
function negotiationHistoryRowUi(
  record: MallBillItem,
  neg: MallBillNegotiationEntry,
  index: number,
): { tone: 'paid' | 'pending', label: '已还款' | '待还款' | '已全额还款' | '待常规还款' | '已完结', showPayBtn: boolean } {
  const hist = record.negotiationHistory || []
  const lastIdx = hist.length > 0 ? hist.length - 1 : -1
  if (index < lastIdx) {
    return { tone: 'paid', label: '已完结', showPayBtn: false }
  }
  const paidAt = String(neg.userPaidAt || '').trim()
  if (paidAt) {
    return { tone: 'paid', label: '已还款', showPayBtn: false }
  }
  const pending = record.negotiationPayPending
  const hasPayablePending = !!(pending && Number(pending.negotiatedAmount || 0) > 0)
  if (
    record.status === '待还款'
    && hasPayablePending
    && index === lastIdx
  ) {
    return { tone: 'pending', label: '待还款', showPayBtn: true }
  }
  if (
    record.status === '待还款'
    && index === lastIdx
    && !hasPayablePending
  ) {
    return { tone: 'pending', label: '待常规还款', showPayBtn: false }
  }
  if (
    record.status === '已还款'
    && !hasPayablePending
  ) {
    return { tone: 'paid', label: '已全额还款', showPayBtn: false }
  }
  return { tone: 'paid', label: '已还款', showPayBtn: false }
}

/** 最近一笔待还的到期日 */
const repayDeadlineText = computed(() => {
  const pending = billList.value.filter(item => item.status === '待还款' && billCountsTowardRepayTotal(item))
  if (!pending.length) {
    return '暂无'
  }
  const sorted = [...pending].sort((a, b) => String(a.time).localeCompare(String(b.time)))
  const t = sorted[0]?.time
  return t ? formatBillDateOnly(t) : '暂无'
})

const billItems = computed(() => [
  { label: '待还金额', value: `￥${pendingRepayDisplayTotal.value.toFixed(2)}` },
  { label: '还款到期日', value: repayDeadlineText.value },
])
async function goBack() {
  await smartNavigate('/my')
}

function displayAmount(amount: number) {
  const abs = Math.abs(amount).toFixed(2)
  return `${amount >= 0 ? '+' : '-'}￥${abs}`
}

function billStatusClass(status: string) {
  if (status === '审核中') {
    return 'border-[#93c5fd] bg-[#eff6ff] text-[#1d4ed8]'
  }
  return status === '待还款' || status === '待常规还款'
    ? 'border-[#f4c66a] bg-[#fff7e8] text-[#b7791f]'
    : 'border-[#9fd8b9] bg-[#edf9f1] text-[#1f8a4c]'
}

function billStatusDotClass(status: string) {
  if (status === '审核中') {
    return 'bg-[#3b82f6]'
  }
  return status === '待还款' || status === '待常规还款'
    ? 'bg-[#f59e0b]'
    : 'bg-[#22a35a]'
}

function extractOrderId(title: string) {
  const match = String(title || '').match(/#([A-Z0-9]+)/i)
  return match?.[1] || ''
}

function extractOrderTitle(title: string) {
  return String(title || '')
    .replace(/\s*第\d+期\s*#[A-Z0-9]+$/i, '')
    .replace(/\s*#[A-Z0-9]+$/i, '')
    .trim() || '订单账单'
}

function extractPeriod(title: string) {
  const match = String(title || '').match(/第(\d+)期/)
  return match ? Number(match[1]) : 0
}

const groupedBills = computed(() => {
  const groups = new Map<string, {
    key: string
    orderId: string
    orderTitle: string
    latestTime: string
    pendingCount: number
    records: Array<typeof billList.value[number] & { period: number }>
  }>()

  billList.value.forEach((item) => {
    const orderId = String(item.orderId || extractOrderId(item.title) || '').trim()
    const key = orderId || `bill-${item.id}`
    const group = groups.get(key) || {
      key,
      orderId,
      orderTitle: extractOrderTitle(item.title),
      latestTime: item.time,
      pendingCount: 0,
      records: [],
    }
    group.records.push({
      ...item,
      period: resolveBillPeriod(item),
    })
    if (item.status === '待还款' && billCountsTowardRepayTotal(item)) {
      group.pendingCount += 1
    }
    if (String(item.time) > String(group.latestTime)) {
      group.latestTime = item.time
    }
    groups.set(key, group)
  })

  return [...groups.values()]
    .map(group => ({
      ...group,
      records: group.records.sort((a, b) => {
        const timeCmp = String(b.time).localeCompare(String(a.time))
        if (timeCmp !== 0) {
          return timeCmp
        }
        const aNeg = a.billKind === 'negotiation' ? 1 : 0
        const bNeg = b.billKind === 'negotiation' ? 1 : 0
        return aNeg - bNeg
      }),
    }))
    .sort((a, b) => String(b.latestTime).localeCompare(String(a.latestTime)))
})

/** 折叠时每组最多预览条数 */
const BILL_PREVIEW_COUNT = 2
const expandedBillGroups = ref<Record<string, boolean>>({})

function isBillGroupExpanded(key: string) {
  return !!expandedBillGroups.value[key]
}

function toggleBillGroupExpand(key: string) {
  expandedBillGroups.value = {
    ...expandedBillGroups.value,
    [key]: !expandedBillGroups.value[key],
  }
}

/** 主列表只展示分期行；协商明细仅在分期卡片内的「协商记录」中展示 */
function isInstallmentBillRow(record: MallBillItem) {
  return record.billKind !== 'negotiation'
}

function recordsToPreview(group: (typeof groupedBills.value)[number]) {
  const { records, key } = group
  const inst = records.filter(isInstallmentBillRow)
  if (inst.length <= BILL_PREVIEW_COUNT) {
    return inst
  }
  if (isBillGroupExpanded(key)) {
    return inst
  }
  return inst.slice(0, BILL_PREVIEW_COUNT)
}

function showBillExpandControl(group: (typeof groupedBills.value)[number]) {
  const inst = group.records.filter(isInstallmentBillRow)
  return inst.length > BILL_PREVIEW_COUNT
}

watch(currentUserAccount, async (account) => {
  expandedBillGroups.value = {}
  if (!account) {
    billList.value = []
    return
  }
  await Promise.all([fetchBills(account), fetchSummary(account)])
}, { immediate: true })

let billVisibilityRefreshTimer: ReturnType<typeof setTimeout> | undefined
if (!import.meta.env.SSR) {
  onMounted(() => {
    void syncFromStorage()
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') {
        return
      }
      const account = currentUserAccount.value
      if (!account) {
        return
      }
      if (billVisibilityRefreshTimer) {
        clearTimeout(billVisibilityRefreshTimer)
      }
      billVisibilityRefreshTimer = setTimeout(() => {
        billVisibilityRefreshTimer = undefined
        void Promise.all([fetchBills(account), fetchSummary(account)])
      }, 400)
    }
    document.addEventListener('visibilitychange', onVisibility)
    onUnmounted(() => {
      document.removeEventListener('visibilitychange', onVisibility)
      if (billVisibilityRefreshTimer) {
        clearTimeout(billVisibilityRefreshTimer)
      }
    })
  })
}
</script>

<template>
  <section
    class="px-4 pt-4"
    :class="showRepayAllBar ? 'pb-28' : 'pb-5'"
  >
    <div class="mb-3 flex items-center justify-between">
      <button
        type="button"
        class="flex h-9 w-9 items-center justify-center rounded-full bg-white text-black/60"
        @click="goBack"
      >
        <Icon
          name="tabler:chevron-left"
          size="1.15rem"
        />
      </button>
      <h1 class="text-xl font-semibold text-black/85">
        账单
      </h1>
      <div class="w-9" />
    </div>

    <div class="mb-3 rounded-2xl bg-white p-4">
      <h2 class="mb-3 text-base font-semibold text-black/85">
        账单概览
      </h2>
      <div class="space-y-2">
        <div
          v-for="item in billItems"
          :key="item.label"
          class="flex items-center justify-between rounded-xl bg-[#f7f8fb] px-3 py-2.5"
        >
          <span class="text-sm text-black/55">{{ item.label }}</span>
          <span class="text-sm font-semibold text-black/80">{{ item.value }}</span>
        </div>
      </div>
    </div>

    <div class="rounded-2xl bg-white p-4">
      <h2 class="mb-3 text-base font-semibold text-black/85">
        最近记录
      </h2>
      <div class="space-y-2.5">
        <article
          v-for="group in groupedBills"
          :key="group.key"
          class="rounded-xl bg-[#f7f8fb] px-3 py-2.5"
        >
          <div class="mb-2 flex items-center justify-between">
            <p class="line-clamp-1 text-sm font-semibold text-black/85">
              {{ group.orderTitle }}
            </p>
            <span class="text-xs text-black/45">
              {{ group.orderId ? `#${group.orderId}` : '未关联订单' }}
            </span>
          </div>

          <div class="mb-2 flex items-center justify-between text-xs text-black/45">
            <span>先享后付 {{ group.records.filter(r => billCountsTowardRepayTotal(r)).length }} 笔</span>
            <span>待还 {{ group.pendingCount }} 笔</span>
          </div>

          <div class="space-y-2">
            <div
              v-for="record in recordsToPreview(group)"
              :key="record.id"
              class="rounded-lg bg-white/65 px-2.5 py-2"
            >
              <div class="mb-1 flex items-center justify-between">
                  <div>
                    <p class="text-sm text-black/70">
                      <template v-if="record.period">
                        第{{ record.period }}期
                      </template>
                      <template v-else>
                        账单记录
                      </template>
                    </p>
                  </div>
                  <p class="text-sm font-semibold tabular-nums" :class="record.amount >= 0 ? 'text-[#0f8b6f]' : 'text-[#d45a33]'">
                    {{ displayAmount(record.amount) }}
                  </p>
                </div>
                <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-black/45">
                  <span>{{ formatBillDateOnly(record.time) }}</span>
                  <div class="flex max-w-[min(100%,11rem)] shrink-0 flex-wrap items-center justify-end gap-1.5">
                    <button
                      v-if="record.status === '待还款' && !record.negotiationPayPending"
                      type="button"
                      class="rounded-full bg-gradient-to-r from-[#ff8a65] to-[#f97316] px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm transition hover:brightness-105 active:opacity-90 disabled:opacity-50"
                      :disabled="repayingAll || repayingBillKey !== null || negotiatedPayBillKey !== null"
                      @click="repaySingleRecord(record)"
                    >
                      {{ repayingBillKey === String(record.id) ? '支付中…' : '还款' }}
                    </button>
                    <span
                      class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none"
                      :class="billStatusClass(record.status)"
                    >
                      <span
                        class="h-1.5 w-1.5 rounded-full"
                        :class="billStatusDotClass(record.status)"
                      />
                      {{ record.status }}
                    </span>
                  </div>
                </div>
                <div
                  v-if="record.negotiationHistory?.length"
                  class="mt-2 border-t border-black/[0.06] pt-2"
                >
                  <p class="mb-1.5 text-[12px] font-semibold text-black/80">
                    协商记录
                  </p>
                  <div
                    v-for="(neg, nidx) in record.negotiationHistory"
                    :key="`${neg.createdAt}-${nidx}`"
                    class="mb-2 rounded-md bg-black/[0.03] px-2 py-1.5 text-[11px] leading-snug last:mb-0"
                  >
                    <div class="mb-1 flex items-center justify-between gap-2">
                      <span class="text-black/50">协商日期</span>
                      <span class="text-right font-medium tabular-nums text-black/75">
                        {{ formatNegotiationDateOnly(neg.createdAt) }}
                      </span>
                    </div>
                    <div class="flex items-center justify-between gap-2">
                      <span class="text-black/50">协商还款金额</span>
                      <span class="font-semibold tabular-nums text-[#059669]">
                        ￥{{ Number(neg.negotiatedAmount).toFixed(2) }}
                      </span>
                    </div>
                    <div class="flex items-center justify-between gap-2">
                      <span class="text-black/50">剩余未还金额</span>
                      <span class="font-semibold tabular-nums text-[#ea580c]">
                        ￥{{ Number(neg.remainderAmount).toFixed(2) }}
                      </span>
                    </div>
                    <div class="flex items-center justify-between gap-2">
                      <span class="text-black/50">协商还款日</span>
                      <span class="font-semibold tabular-nums text-[#2563eb]">
                        {{ neg.remainderDueDate || '—' }}
                      </span>
                    </div>
                    <template
                      v-for="ui in [negotiationHistoryRowUi(record, neg, nidx)]"
                      :key="`neg-ui-${nidx}`"
                    >
                      <div class="mt-1.5 flex items-center justify-between gap-2 border-t border-black/[0.06] pt-1.5">
                        <span class="shrink-0 text-black/50">还款状态</span>
                        <span
                          class="inline-flex max-w-[65%] shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none"
                          :class="billStatusClass(ui.label)"
                        >
                          <span
                            class="h-1.5 w-1.5 shrink-0 rounded-full"
                            :class="billStatusDotClass(ui.label)"
                          />
                          {{ ui.label }}
                        </span>
                      </div>
                      <button
                        v-if="ui.showPayBtn && record.negotiationPayPending"
                        type="button"
                        class="mt-2 w-full rounded-lg bg-gradient-to-r from-[#ef4444] to-[#dc2626] py-2.5 text-[12px] font-semibold text-white shadow-sm transition hover:brightness-105 active:opacity-90 disabled:opacity-50"
                        :disabled="repayingAll || repayingBillKey !== null || negotiatedPayBillKey !== null"
                        @click="payNegotiatedSingle(record)"
                      >
                        {{ negotiatedPayBillKey === String(record.id) ? '支付中…' : `协商还款 ￥${Number(record.negotiationPayPending.negotiatedAmount).toFixed(2)}` }}
                      </button>
                    </template>
                  </div>
                </div>
            </div>
            <button
              v-if="showBillExpandControl(group)"
              type="button"
              class="mt-1 flex w-full items-center justify-center gap-0.5 rounded-lg py-2 text-xs font-medium text-[#e87b8f] transition hover:bg-white/50 active:opacity-80"
              @click="toggleBillGroupExpand(group.key)"
            >
              <span>{{ isBillGroupExpanded(group.key) ? '收起' : `展开全部（${group.records.filter(isInstallmentBillRow).length} 笔）` }}</span>
              <Icon
                :name="isBillGroupExpanded(group.key) ? 'tabler:chevron-up' : 'tabler:chevron-down'"
                size="0.95rem"
              />
            </button>
          </div>
        </article>
      </div>
    </div>

    <div
      v-if="showRepayAllBar"
      class="fixed bottom-16 left-0 right-0 z-20 border-t border-black/[0.06] bg-white/95 px-4 py-3 shadow-[0_-6px_24px_rgba(0,0,0,0.06)] backdrop-blur-sm pb-[max(0.75rem,env(safe-area-inset-bottom))]"
    >
      <button
        type="button"
        class="w-full rounded-full bg-gradient-to-r from-[#ff8a65] to-[#f97316] py-3.5 text-base font-semibold text-white shadow-[0_8px_22px_rgba(249,115,22,0.35)] transition hover:brightness-105 active:opacity-90 disabled:opacity-55"
        :disabled="repayingAll || repayingBillKey !== null || negotiatedPayBillKey !== null"
        @click="repayAllPending"
      >
        {{ repayingAll ? '支付处理中…' : `立即还款 ￥${pendingRepayTotalAll.toFixed(2)}` }}
      </button>
    </div>
    <LakalaPaySheet
      v-model="paySheetOpen"
      :phone="currentUserAccount"
      :amount-yuan="payAmountYuan"
      :title="paySheetTitle"
      :preorder-payload="payPreorderPayload"
      @success="onBillPaySuccess"
    />
  </section>
</template>

<!-- MessageBox 挂载到 body，需非 scoped 才能作用到弹层 -->
<style>
.bill-m-repay-message-box .el-message-box__btns {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
}

.bill-m-repay-message-box .el-message-box__btns .el-button {
  margin-left: 0 !important;
  margin-right: 0 !important;
}
</style>
