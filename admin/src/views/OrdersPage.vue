<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { InstallmentItem, InstallmentNegotiationRecord, OrderItem } from '../stores/useOrdersStore'
import { getAdminSession, isSuperAdminRole } from '../composables/useAdminAuth'
import { refreshOrdersMenuPendingReview } from '../composables/useAdminOrderReviewBadge'
import { withMallTenantHeaders } from '../composables/useAdminApi'
import { useOrdersStore } from '../stores/useOrdersStore'
import type { UserItem } from '../components/UserRiskDetailDialog.vue'
import type { OrderShippingSnapshot } from '../components/UserRegistrationInfoScroll.vue'
import { donePageProgress, startPageProgress } from '../utils/progress'

const MALL_API_BASE = `${(import.meta.env.VITE_MALL_API_BASE || 'http://localhost:3110/api').replace(/\/$/, '')}`

const route = useRoute()
const UserRiskDetailDialog = defineAsyncComponent(() => import('../components/UserRiskDetailDialog.vue'))
/** 订单数据页：仅展示后台已标记「卡包已发放」的订单 */
const isCardPackageDataPage = computed(() => route.name === 'orders-card-data')

const keyword = ref('')
const status = ref<'全部' | OrderItem['status']>('全部')
/** 订单数据页：按先享后付还款情况筛选（与发货状态无关） */
const repayFilter = ref<'全部' | '待还款' | '已还款' | '已逾期'>('全部')
const payType = ref<'全部' | OrderItem['payType']>('全部')
const orderDate = ref('')
const selectedOrder = ref<OrderItem | null>(null)
const loading = ref(false)
/** 打开「还款详情」弹窗时拉取单条订单，避免列表缓存与商城还款后服务端数据不一致 */
const openingPlanOrderId = ref('')
const changingStatusOrderId = ref('')
const trackingSavingId = ref('')
const cardPackageSavingId = ref('')
const cardPackageContractSavingId = ref('')
const deletingOrderId = ref('')
const trackingDialogOpen = ref(false)
const trackingDialogOrder = ref<OrderItem | null>(null)
const trackingDialogInput = ref('')
const userRiskDialogVisible = ref(false)
const riskDialogUserId = ref<string | null>(null)
/** 从订单打开风控时带入该单收货人信息，关闭弹窗后清空 */
const riskContextOrderShipping = ref<OrderShippingSnapshot | undefined>(undefined)
const resolvingRiskUserOrderId = ref<string | null>(null)
const { orders, recalculateOrderFields, fetchOrders, fetchOrderById, updateInstallmentPaid, updateInstallmentDueDate, updateInstallmentSettleAmount, updateInstallmentNegotiate, updateInstallmentNegotiationHistoryPaid, updateOrderStatus, updateOrderShipment, updateOrderCardPackage, updateOrderCardPackageContract, deleteOrder } = useOrdersStore()
const canOperateOrders = computed(() => isSuperAdminRole(getAdminSession()?.role))

function normalizePhone(raw: string): string {
  return String(raw || '').replace(/\D/g, '')
}

/** 订单状态展示口径：卡包已发放即视为已完成（唯一标准） */
function displayOrderStatus(order: OrderItem): OrderItem['status'] {
  return order.cardPackageIssued ? '已完成' : order.status
}

watch(userRiskDialogVisible, (open) => {
  if (!open) {
    riskDialogUserId.value = null
    riskContextOrderShipping.value = undefined
  }
})

function onRiskDialogUserUpdated(_user: UserItem) {
  void loadOrders().catch(() => {})
}

async function openUserRiskFromOrder(order: OrderItem) {
  if (resolvingRiskUserOrderId.value) {
    return
  }
  resolvingRiskUserOrderId.value = order.id
  try {
    const mid = String(order.mallUserId || '').trim()
    if (mid) {
      const response = await fetch(`${MALL_API_BASE}/users/${encodeURIComponent(mid)}`, {
        method: 'GET',
        headers: withMallTenantHeaders(),
      })
      if (!response.ok) {
        throw new Error(`查询用户失败: ${response.status}`)
      }
      const payload = await response.json() as { data?: { user?: { id?: string } } | null }
      const id = payload.data?.user && typeof payload.data.user.id === 'string' ? payload.data.user.id.trim() : ''
      if (!id) {
        ElMessage.error('未找到该订单关联的商城注册用户')
        return
      }
      riskDialogUserId.value = id
      riskContextOrderShipping.value = {
        name: String(order.receiverName ?? '').trim(),
        phone: String(order.receiverPhone ?? '').trim(),
        address: String(order.receiverAddress ?? ''),
      }
      userRiskDialogVisible.value = true
      return
    }
    const digits = normalizePhone(order.buyerPhone || '')
    if (digits.length !== 11) {
      ElMessage.error('订单缺少注册用户信息（mallUserId / buyerPhone），无法打开用户风控档案')
      return
    }
    const url = `${MALL_API_BASE}/users/by-phone?phone=${encodeURIComponent(digits)}`
    const response = await fetch(url, {
      method: 'GET',
      headers: withMallTenantHeaders(),
    })
    if (!response.ok) {
      throw new Error(`查询用户失败: ${response.status}`)
    }
    const payload = await response.json() as { data?: { id?: string } | null }
    const user = payload.data
    const id = user && typeof user.id === 'string' ? user.id : ''
    if (!id) {
      ElMessage.error('未找到与该手机号关联的商城用户')
      return
    }
    riskDialogUserId.value = id
    riskContextOrderShipping.value = {
      name: String(order.receiverName ?? '').trim(),
      phone: String(order.receiverPhone ?? '').trim(),
      address: String(order.receiverAddress ?? ''),
    }
    userRiskDialogVisible.value = true
  }
  catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '查询用户失败')
  }
  finally {
    resolvingRiskUserOrderId.value = null
  }
}

function showTrackingEditor(item: OrderItem): boolean {
  const statusText = displayOrderStatus(item)
  return statusText === '待发货' || statusText === '待收货'
}

function formatLocalYmd(d: Date) {
  const y = d.getFullYear()
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${y}-${m}-${day}`
}

const todayYmd = computed(() => formatLocalYmd(new Date()))

function dueKey(dueDate: string) {
  const s = String(dueDate || '').trim()
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : ''
}

/** 从当前期还款日（YYYY-MM-DD）起顺延整数天，与管理端「延期还款」接口的正午锚点算法一致 */
function remainderDueYmdAfterDelayDays(dueDateRaw: string, delayDays: number): string {
  const key = dueKey(dueDateRaw)
  if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    return ''
  }
  const date = new Date(`${key}T12:00:00`)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  date.setDate(date.getDate() + delayDays)
  const y = date.getFullYear()
  const m = `${date.getMonth() + 1}`.padStart(2, '0')
  const d = `${date.getDate()}`.padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** 根据当前日期 + 各期还款日 + 是否已还，得到订单还款维度状态 */
function orderRepayBucket(order: OrderItem): '已还款' | '待还款' | '已逾期' {
  const plan = order.installmentPlan || []
  if (plan.length === 0) {
    return '已还款'
  }
  if (plan.every(p => p.paid)) {
    return '已还款'
  }
  const t = todayYmd.value
  for (const p of plan) {
    if (p.paid) {
      continue
    }
    const dk = dueKey(p.dueDate)
    if (dk && dk < t) {
      return '已逾期'
    }
  }
  return '待还款'
}

function repayBucketTagType(bucket: '已还款' | '待还款' | '已逾期'): 'success' | 'warning' | 'danger' {
  if (bucket === '已还款') {
    return 'success'
  }
  if (bucket === '待还款') {
    return 'warning'
  }
  return 'danger'
}

/** 单期在弹窗中的还款展示状态（与列表还款维度一致） */
function periodRepayStatus(plan: InstallmentItem): '已还款' | '待还款' | '已逾期' {
  if (plan.paid) {
    return '已还款'
  }
  const dk = dueKey(plan.dueDate)
  const t = todayYmd.value
  if (dk && dk < t) {
    return '已逾期'
  }
  return '待还款'
}

/** 还款详情表：取最近一次协商登记（金额、协商后未还金额的还款日） */
function latestNegotiationRecord(plan: InstallmentItem): InstallmentNegotiationRecord | null {
  const h = plan.negotiationHistory
  if (!Array.isArray(h) || h.length === 0) {
    return null
  }
  return h[h.length - 1] ?? null
}

/** 该期是否已有协商登记（存在协商记录时不可使用「延期还款」，应通过「协商还款」调整） */
function planHasNegotiationHistory(plan: InstallmentItem): boolean {
  const h = plan.negotiationHistory
  return Array.isArray(h) && h.length > 0
}

/** 「延期还款」按钮禁用时的悬停说明（无说明则不展示 tooltip） */
function deferRepaymentTooltip(plan: InstallmentItem): string {
  if (!selectedOrder.value?.cardPackageIssued) {
    return '卡包未发放'
  }
  if (planHasNegotiationHistory(plan)) {
    return '已有协商记录，不可延期还款'
  }
  return ''
}

/** 「协商结清金额」禁用说明（无说明则不展示 tooltip） */
function settleAmountTooltip(plan: InstallmentItem): string {
  if (!selectedOrder.value?.cardPackageIssued) {
    return '卡包未发放'
  }
  if (plan.negotiationPayPending && Number(plan.negotiationPayPending.negotiatedAmount || 0) > 0) {
    return '待用户在前台完成协商支付'
  }
  if (planHasNegotiationHistory(plan)) {
    return '已有协商记录，请使用「协商还款」或协商记录处理'
  }
  return ''
}

/** 协商记录中的登记时间展示 */
function formatNegotiationCreatedAt(raw: string): string {
  const s = String(raw || '').trim()
  if (!s) {
    return '—'
  }
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) {
    return s.length > 16 ? s.slice(0, 16) : s
  }
  const yyyy = d.getFullYear()
  const mm = `${d.getMonth() + 1}`.padStart(2, '0')
  const dd = `${d.getDate()}`.padStart(2, '0')
  const hh = `${d.getHours()}`.padStart(2, '0')
  const min = `${d.getMinutes()}`.padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`
}

/** 协商记录单行：还款状态仅「已还款 / 待还款」 */
function negotiationRowPayStatus(
  plan: InstallmentItem,
  row: InstallmentNegotiationRecord,
  index: number,
): { tag: 'success' | 'warning'; text: '已还款' | '待还款' } {
  const paidAt = String(row.userPaidAt || '').trim()
  if (paidAt) {
    return { tag: 'success', text: '已还款' }
  }
  const hist = plan.negotiationHistory
  const lastIdx = Array.isArray(hist) && hist.length > 0 ? hist.length - 1 : -1
  const pending = plan.negotiationPayPending
  if (pending && Number(pending.negotiatedAmount || 0) > 0 && index === lastIdx) {
    return { tag: 'warning', text: '待还款' }
  }
  return { tag: 'success', text: '已还款' }
}

/** 协商记录：可标记已还（仅末条且为「待用户协商支付」） */
function negotiationRowCanMarkPaid(plan: InstallmentItem, row: InstallmentNegotiationRecord, index: number): boolean {
  const hist = plan.negotiationHistory
  const lastIdx = Array.isArray(hist) && hist.length > 0 ? hist.length - 1 : -1
  if (index !== lastIdx) {
    return false
  }
  return negotiationRowPayStatus(plan, row, index).text === '待还款'
}

/** 协商记录：可标记未还（仅末条；已记 userPaidAt，或末条已应用剩余本金可撤销）；本期已结清时不可再改 */
function negotiationRowCanMarkUnpaid(plan: InstallmentItem, row: InstallmentNegotiationRecord, index: number): boolean {
  if (plan.paid) {
    return false
  }
  const hist = plan.negotiationHistory
  const lastIdx = Array.isArray(hist) && hist.length > 0 ? hist.length - 1 : -1
  if (index !== lastIdx) {
    return false
  }
  if (negotiationRowPayStatus(plan, row, index).text !== '已还款') {
    return false
  }
  if (String(row.userPaidAt || '').trim()) {
    return true
  }
  if (plan.negotiationPayPending) {
    return false
  }
  const rem = Number(row.remainderAmount || 0)
  return Math.abs(Number(plan.amount || 0) - rem) <= 0.02
}

/** 本期已结清：每条协商历史在操作栏展示「已全额还款」（状态为已还款且无标记按钮时；含多轮协商中的非末条） */
function negotiationRowShowFullRepayHint(plan: InstallmentItem, row: InstallmentNegotiationRecord, index: number): boolean {
  if (!plan.paid) {
    return false
  }
  if (negotiationRowPayStatus(plan, row, index).text !== '已还款') {
    return false
  }
  if (negotiationRowCanMarkPaid(plan, row, index) || negotiationRowCanMarkUnpaid(plan, row, index)) {
    return false
  }
  return true
}

/** 已有更新的协商记录：非末条仅展示「已完结」（不可再操作） */
function negotiationRowShowSupersededEndedHint(plan: InstallmentItem, _row: InstallmentNegotiationRecord, index: number): boolean {
  if (plan.paid) {
    return false
  }
  const hist = plan.negotiationHistory
  const lastIdx = Array.isArray(hist) && hist.length > 0 ? hist.length - 1 : -1
  return index < lastIdx
}

const selectedOrderHasNegotiationHistory = computed(() => {
  const ord = selectedOrder.value
  if (!ord?.installmentPlan?.length) {
    return false
  }
  return ord.installmentPlan.some(p => Array.isArray(p.negotiationHistory) && p.negotiationHistory.length > 0)
})

const deferDueSavingKey = ref('')
const negotiateSavingKey = ref('')
const settleAmountSavingKey = ref('')
const negotiationHistorySavingKey = ref('')
const negotiateDialogOpen = ref(false)
const negotiateDialogOrder = ref<OrderItem | null>(null)
const negotiateDialogPlan = ref<InstallmentItem | null>(null)
const negotiateFormAmount = ref<number | null>(null)
/** 相对当前期还款日顺延的天数（0 表示不推迟），提交时换算为 remainderDueDate */
const negotiateFormDelayDays = ref('0')

/** 还款详情弹窗表格：每期最近一次协商金额与协商后还款日（与 negotiationHistory 末条一致） */
const selectedOrderNegotiationByPeriod = computed(() => {
  const ord = selectedOrder.value
  if (!ord?.installmentPlan?.length) {
    return {} as Record<number, { negotiatedAmount: string; remainderDueDate: string }>
  }
  const out: Record<number, { negotiatedAmount: string; remainderDueDate: string }> = {}
  for (const plan of ord.installmentPlan) {
    const r = latestNegotiationRecord(plan)
    if (r) {
      out[plan.period] = {
        negotiatedAmount: Number(r.negotiatedAmount).toFixed(2),
        remainderDueDate: String(r.remainderDueDate || '').trim(),
      }
    }
  }
  return out
})

/** 协商弹窗：根据延迟天数预览协商后还款日 */
const negotiateRemainderDuePreview = computed(() => {
  const plan = negotiateDialogPlan.value
  if (!plan) {
    return ''
  }
  const raw = String(negotiateFormDelayDays.value || '').trim()
  if (!/^\d+$/.test(raw)) {
    return ''
  }
  const delayDays = Number.parseInt(raw, 10)
  if (delayDays < 0 || delayDays > 3650) {
    return ''
  }
  return remainderDueYmdAfterDelayDays(plan.dueDate, delayDays)
})

/** 协商弹窗：当前应还本金（元） */
const negotiateDialogCurrentDueNumber = computed(() => {
  const plan = negotiateDialogPlan.value
  if (!plan) {
    return 0
  }
  return Number(Number(plan.amount || 0).toFixed(2))
})

/** 协商还款金额输入上限（须小于应还，与接口 remainder>0 一致） */
const negotiateDialogMaxNegotiatedAmount = computed(() => {
  const cur = negotiateDialogCurrentDueNumber.value
  if (!Number.isFinite(cur) || cur <= 0) {
    return 0.01
  }
  const cap = Number((cur - 0.01).toFixed(2))
  return Math.max(0.01, cap)
})

function onNegotiateAmountChange(val: number | undefined) {
  const plan = negotiateDialogPlan.value
  if (!plan || val == null || !Number.isFinite(val)) {
    return
  }
  const cur = negotiateDialogCurrentDueNumber.value
  if (val > cur) {
    ElMessage.warning(`协商还款金额不能大于当前应还金额（¥${cur.toFixed(2)}）`)
    negotiateFormAmount.value = negotiateDialogMaxNegotiatedAmount.value
  }
}

function customerIdentityKey(order: OrderItem): string {
  let phoneDigits = normalizePhone(order.buyerPhone || '')
  if (phoneDigits.startsWith('86') && phoneDigits.length === 13) {
    phoneDigits = phoneDigits.slice(2)
  }
  if (phoneDigits.length === 11) {
    return `phone:${phoneDigits}`
  }
  const mid = String(order.mallUserId || '').trim()
  if (mid) {
    return `mall:${mid}`
  }
  const name = String(order.user || '').trim().toLowerCase()
  return name ? `name:${name}` : ''
}

const issuedCustomerKeys = computed(() => {
  const keys = new Set<string>()
  for (const order of orders.value) {
    if (!order.cardPackageIssued) {
      continue
    }
    const key = customerIdentityKey(order)
    if (key) {
      keys.add(key)
    }
  }
  return keys
})

function isOldCustomer(order: OrderItem): boolean {
  const key = customerIdentityKey(order)
  return !!key && issuedCustomerKeys.value.has(key)
}

function customerTypeTagType(order: OrderItem): 'success' | 'warning' {
  return isOldCustomer(order) ? 'success' : 'warning'
}

function customerTypeLabel(order: OrderItem): '老客户' | '新客户' {
  return isOldCustomer(order) ? '老客户' : '新客户'
}

const orderTableColspan = computed(() => (isCardPackageDataPage.value ? 16 : 15))

const filteredOrders = computed(() => {
  // 订单管理仅展示已通过人工审核后的订单，待审核订单统一在“审核订单”页面处理。
  let list = orders.value.filter(item => item.status !== '待审核' && item.status !== '风控未通过')
  if (isCardPackageDataPage.value) {
    list = list.filter(item => item.cardPackageIssued)
    if (repayFilter.value !== '全部') {
      list = list.filter(item => orderRepayBucket(item) === repayFilter.value)
    }
  }
  else {
    // 已审核订单：卡包已发放后仅出现在「订单数据」，本列表不再展示
    list = list.filter(item => !item.cardPackageIssued)
  }
  return list
})

async function openPlan(order: OrderItem) {
  if (openingPlanOrderId.value) {
    return
  }
  openingPlanOrderId.value = order.id
  try {
    const fresh = await fetchOrderById(order.id)
    selectedOrder.value = fresh
  }
  catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '加载还款详情失败')
  }
  finally {
    openingPlanOrderId.value = ''
  }
}

async function toggleNegotiationHistoryPaid(order: OrderItem, plan: InstallmentItem, historyIndex: number, paid: boolean) {
  if (!canOperateOrders.value) {
    return
  }
  if (deferDueSavingKey.value || negotiateSavingKey.value || negotiationHistorySavingKey.value || settleAmountSavingKey.value) {
    return
  }
  if (!order.cardPackageIssued) {
    ElMessage.warning('卡包未发放')
    return
  }
  try {
    await ElMessageBox.confirm(
      paid
        ? '确认将本条协商记录标记为「已还款」？将按协商流程更新剩余应还本金等数据。'
        : '确认将本条协商记录标记为「未还款」？将撤销已还款标记并回退相关数据。',
      paid ? '确认标记已还' : '确认标记未还',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning',
      },
    )
  }
  catch {
    return
  }
  negotiationHistorySavingKey.value = `${order.id}-${plan.period}-${historyIndex}`
  try {
    await updateInstallmentNegotiationHistoryPaid(order.id, plan.period, historyIndex, paid)
    ElMessage.success(paid ? '协商记录已标记为已还款' : '协商记录已标记为未还款')
    const id = selectedOrder.value?.id
    if (id) {
      const fresh = orders.value.find(o => o.id === id)
      if (fresh) {
        selectedOrder.value = fresh
      }
    }
  }
  catch {
    ElMessage.error('更新协商还款状态失败，请稍后重试')
  }
  finally {
    negotiationHistorySavingKey.value = ''
  }
}

function closePlan() {
  selectedOrder.value = null
}

async function toggleRepay(order: OrderItem, period: InstallmentItem) {
  if (!canOperateOrders.value) return
  if (deferDueSavingKey.value || negotiateSavingKey.value || negotiationHistorySavingKey.value || settleAmountSavingKey.value) {
    return
  }
  const nextPaid = !period.paid
  if (nextPaid && !order.cardPackageIssued) {
    ElMessage.warning('卡包未发放')
    return
  }
  try {
    await ElMessageBox.confirm(
      nextPaid
        ? `确认将第 ${period.period} 期标记为「已还款」？`
        : `确认将第 ${period.period} 期标记为「未还款」？`,
      nextPaid ? '确认标记已还' : '确认标记未还',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning',
      },
    )
  }
  catch {
    return
  }
  const prevPaid = period.paid
  period.paid = nextPaid
  recalculateOrderFields(order)
  try {
    await updateInstallmentPaid(order.id, period.period, nextPaid)
    const id = selectedOrder.value?.id
    if (id) {
      const fresh = orders.value.find(o => o.id === id)
      if (fresh) {
        selectedOrder.value = fresh
      }
    }
  }
  catch (error) {
    period.paid = prevPaid
    recalculateOrderFields(order)
    ElMessage.error('更新先享后付状态失败，请稍后重试')
  }
}

function openTrackingDialog(order: OrderItem) {
  if (!canOperateOrders.value || !showTrackingEditor(order)) {
    return
  }
  trackingDialogOrder.value = order
  trackingDialogInput.value = order.trackingNumber || ''
  trackingDialogOpen.value = true
}

function onTrackingDialogClosed() {
  trackingDialogOrder.value = null
  trackingDialogInput.value = ''
}

async function confirmTrackingDialog() {
  const order = trackingDialogOrder.value
  if (!order || !canOperateOrders.value) {
    return
  }
  if (trackingSavingId.value) {
    return
  }
  const t = trackingDialogInput.value.trim()
  const prev = (order.trackingNumber || '').trim()
  if (t === prev) {
    trackingDialogOpen.value = false
    return
  }
  if (!t && !prev) {
    trackingDialogOpen.value = false
    return
  }

  trackingSavingId.value = order.id
  try {
    await updateOrderShipment(order.id, t)
    if (!t) {
      ElMessage.success('已清空快递单号')
    }
    else if (prev) {
      ElMessage.success('快递单号已更新')
    }
    else {
      ElMessage.success('发货成功，订单已进入待收货')
    }
    trackingDialogOpen.value = false
  }
  catch {
    ElMessage.error('保存快递单号失败，请稍后重试')
  }
  finally {
    trackingSavingId.value = ''
  }
}

/** 本页列表可操作的后台物流态（与接口 shipping / receiving / enjoying / reviewing 对应） */
const ORDER_STATUS_EDIT_OPTIONS: Array<'待发货' | '待收货' | '已完成' | '待审核'> = [
  '待发货',
  '待收货',
  '已完成',
  '待审核',
]

const orderStatusToApi: Record<
  '待发货' | '待收货' | '已完成' | '待审核',
  'shipping' | 'receiving' | 'enjoying' | 'reviewing'
> = {
  待发货: 'shipping',
  待收货: 'receiving',
  已完成: 'enjoying',
  待审核: 'reviewing',
}

function hasTrackingNumber(order: OrderItem): boolean {
  return Boolean((order.trackingNumber || '').trim())
}

/** 下拉项禁用：当前态、有单号不可选待发货、无单号不可选待收货、卡包未发不可选已完成 */
function orderStatusOptionDisabled(order: OrderItem, opt: (typeof ORDER_STATUS_EDIT_OPTIONS)[number]): boolean {
  const statusText = displayOrderStatus(order)
  if (statusText === opt) {
    return true
  }
  if (opt === '待发货' && hasTrackingNumber(order)) {
    return true
  }
  if (opt === '待收货' && !hasTrackingNumber(order)) {
    return true
  }
  if (opt === '已完成' && !order.cardPackageIssued) {
    return true
  }
  return false
}

function orderStatusOptionTitle(order: OrderItem, opt: (typeof ORDER_STATUS_EDIT_OPTIONS)[number]): string {
  const statusText = displayOrderStatus(order)
  if (opt === '待发货' && hasTrackingNumber(order) && statusText !== '待发货') {
    return '已填写快递单号，须先清空单号后才能改回待发货'
  }
  if (opt === '待收货' && !hasTrackingNumber(order) && statusText !== '待收货') {
    return '请填写快递单号'
  }
  if (opt === '已完成' && !order.cardPackageIssued && statusText !== '已完成') {
    return '请先标记卡包已发放，系统将同步为已完成'
  }
  return ''
}

async function handleOrderStatusCommand(order: OrderItem, label: string) {
  if (!canOperateOrders.value) {
    return
  }
  if (order.cardPackageIssued) {
    ElMessage.warning('卡包已发放时不可修改订单状态，请先改为未发放')
    return
  }
  const key = label as keyof typeof orderStatusToApi
  if (!(key in orderStatusToApi)) {
    return
  }
  if (label === '待发货' && hasTrackingNumber(order)) {
    ElMessage.warning('已填写快递单号，不可改回待发货；请先清空快递单号')
    return
  }
  if (label === '待收货' && !hasTrackingNumber(order)) {
    ElMessage.warning('请填写快递单号')
    return
  }
  if (label === '已完成' && !order.cardPackageIssued) {
    ElMessage.warning('卡包未发放时不可改为已完成，请先在「卡包发放」中标记已发放')
    return
  }
  if (displayOrderStatus(order) === label) {
    return
  }
  if (changingStatusOrderId.value) {
    return
  }
  changingStatusOrderId.value = order.id
  try {
    await updateOrderStatus(order.id, orderStatusToApi[key])
    ElMessage.success('订单状态已更新')
  }
  catch {
    ElMessage.error('更新订单状态失败，请稍后重试')
  }
  finally {
    changingStatusOrderId.value = ''
  }
}

async function rollbackToReview(order: OrderItem) {
  if (!canOperateOrders.value) return
  if (order.cardPackageIssued) {
    ElMessage.warning('卡包已发放时不可打回审核，请先改为未发放')
    return
  }
  if (changingStatusOrderId.value) {
    return
  }
  if (order.status === '待审核') {
    return
  }

  changingStatusOrderId.value = order.id
  try {
    await updateOrderStatus(order.id, 'reviewing')
  }
  catch (error) {
    ElMessage.error('打回审核失败，请稍后重试')
  }
  finally {
    changingStatusOrderId.value = ''
  }
}

async function handleDeleteOrder(order: OrderItem) {
  if (!canOperateOrders.value) {
    return
  }
  if (deletingOrderId.value) {
    return
  }
  try {
    await ElMessageBox.confirm(
      `确定删除订单 ${order.id}？删除后不可恢复。`,
      '删除订单',
      {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning',
      },
    )
  }
  catch {
    return
  }
  deletingOrderId.value = order.id
  try {
    await deleteOrder(order.id)
    ElMessage.success('订单已删除')
    if (selectedOrder.value?.id === order.id) {
      closePlan()
    }
  }
  catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '删除订单失败，请稍后重试')
  }
  finally {
    deletingOrderId.value = ''
  }
}

function cardPackageTagType(issued: boolean): 'success' | 'info' {
  return issued ? 'success' : 'info'
}

function contractSignedTagType(signed: boolean): 'success' | 'info' {
  return signed ? 'success' : 'info'
}

/** 仅先享后付订单展示卡包合同签署；全款不适用 */
function orderHasCardPackageContract(order: OrderItem): boolean {
  return order.payType === '先享后付'
}

/** 未添加紧急联系人不可标记卡包已发放；先享后付还需合同已签署 */
function canMarkCardPackageIssued(order: OrderItem): boolean {
  if (order.emergencyContactsComplete === false) {
    return false
  }
  if (!orderHasCardPackageContract(order)) {
    return true
  }
  return Boolean(order.cardPackageContractSigned)
}

/** 「已发放」因未添加紧急联系人被禁用时，用于气泡提示 */
function issuedOptionNeedsEmergencyContactTip(order: OrderItem): boolean {
  return !order.cardPackageIssued && order.emergencyContactsComplete === false
}

/** 「已发放」因未签合同被禁用时，用于气泡提示 */
function issuedOptionNeedsContractTip(order: OrderItem): boolean {
  return orderHasCardPackageContract(order) && !order.cardPackageContractSigned && !order.cardPackageIssued
}

function formatContractSignedTooltip(iso: string) {
  const s = String(iso || '').trim()
  if (!s) {
    return ''
  }
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) {
    return s
  }
  const y = d.getFullYear()
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  const hh = `${d.getHours()}`.padStart(2, '0')
  const mm = `${d.getMinutes()}`.padStart(2, '0')
  return `签署时间 ${y}-${m}-${day} ${hh}:${mm}`
}

function orderStatusTagType(s: OrderItem['status']): 'success' | 'warning' | 'info' | 'danger' | 'primary' {
  if (s === '待发货') {
    return 'warning'
  }
  if (s === '待收货') {
    return 'primary'
  }
  if (s === '已完成') {
    return 'success'
  }
  if (s === '风控未通过') {
    return 'danger'
  }
  return 'info'
}

function handleCardPackageCmd(order: OrderItem, cmd: string) {
  if (cmd !== 'issued' && cmd !== 'pending') {
    return
  }
  void applyCardPackage(order, cmd === 'issued')
}

async function applyCardPackage(order: OrderItem, next: boolean) {
  if (!canOperateOrders.value) {
    return
  }
  if (cardPackageSavingId.value) {
    return
  }
  if (next === order.cardPackageIssued) {
    return
  }
  if (next && !canMarkCardPackageIssued(order)) {
    if (orderHasCardPackageContract(order) && !order.cardPackageContractSigned) {
      ElMessage.warning('请先完成合同签署后再标记卡包已发放')
    }
    else if (order.emergencyContactsComplete === false) {
      ElMessage.warning('请先添加紧急联系人后再标记卡包已发放')
    }
    else {
      ElMessage.warning('请先完成合同签署后再标记卡包已发放')
    }
    return
  }
  cardPackageSavingId.value = order.id
  try {
    await updateOrderCardPackage(order.id, next)
    ElMessage.success(next ? '卡包已标记发放，订单状态已同步为已完成' : '卡包发放状态已更新')
  }
  catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '更新卡包状态失败，请稍后重试')
  }
  finally {
    cardPackageSavingId.value = ''
  }
}

function handleCardPackageContractCmd(order: OrderItem, cmd: string) {
  if (cmd !== 'signed' && cmd !== 'unsigned') {
    return
  }
  void applyCardPackageContract(order, cmd === 'signed')
}

async function applyCardPackageContract(order: OrderItem, nextSigned: boolean) {
  if (!canOperateOrders.value || !orderHasCardPackageContract(order)) {
    return
  }
  if (cardPackageContractSavingId.value) {
    return
  }
  if (nextSigned === order.cardPackageContractSigned) {
    return
  }
  if (!nextSigned && order.cardPackageIssued) {
    ElMessage.warning('卡包已发放时不可将合同改为未签署，请先将卡包改为未发放')
    return
  }
  cardPackageContractSavingId.value = order.id
  try {
    await updateOrderCardPackageContract(order.id, nextSigned)
    ElMessage.success(nextSigned ? '已标记为已签署' : '已标记为未签署')
  }
  catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '更新合同签署状态失败')
  }
  finally {
    cardPackageContractSavingId.value = ''
  }
}

async function deferRepaymentDue(order: OrderItem, plan: InstallmentItem) {
  if (!canOperateOrders.value || plan.paid) {
    return
  }
  if (!order.cardPackageIssued) {
    ElMessage.warning('卡包未发放')
    return
  }
  if (planHasNegotiationHistory(plan)) {
    ElMessage.warning('已有协商记录，不可延期还款')
    return
  }
  const key = `${order.id}-${plan.period}`
  if (deferDueSavingKey.value || negotiateSavingKey.value || negotiationHistorySavingKey.value || settleAmountSavingKey.value) {
    return
  }
  try {
    const { value } = await ElMessageBox.prompt(
      '请输入延期天数（正整数）。确认后将在当前「还款日」基础上向后顺延该天数。',
      '延期还款',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        inputValue: '14',
        inputPattern: /^[1-9]\d*$/,
        inputErrorMessage: '请输入大于 0 的整数天数',
        confirmButtonClass: 'defer-repay-msgbox-confirm',
      },
    )
    const days = Number.parseInt(String(value).trim(), 10)
    if (!Number.isFinite(days) || days < 1 || days > 3650) {
      ElMessage.error('延期天数须在 1～3650 之间')
      return
    }
    deferDueSavingKey.value = key
    await updateInstallmentDueDate(order.id, plan.period, days)
    ElMessage.success(`已延期 ${days} 天`)
    const id = selectedOrder.value?.id
    if (id) {
      const fresh = orders.value.find(o => o.id === id)
      if (fresh) {
        selectedOrder.value = fresh
      }
    }
  }
  catch (e: unknown) {
    if (e === 'cancel' || e === 'close') {
      return
    }
    ElMessage.error(e instanceof Error ? e.message : '延期失败')
  }
  finally {
    deferDueSavingKey.value = ''
  }
}

function openNegotiateRepayDialog(order: OrderItem, plan: InstallmentItem) {
  if (!canOperateOrders.value || plan.paid) {
    return
  }
  if (!order.cardPackageIssued) {
    ElMessage.warning('卡包未发放')
    return
  }
  if (plan.negotiationPayPending && Number(plan.negotiationPayPending.negotiatedAmount || 0) > 0) {
    ElMessage.warning('本期尚有协商款项待用户在前台完成支付，请待完成后再协商')
    return
  }
  if (deferDueSavingKey.value || negotiateSavingKey.value || negotiationHistorySavingKey.value || settleAmountSavingKey.value) {
    return
  }
  negotiateDialogOrder.value = order
  negotiateDialogPlan.value = plan
  negotiateFormAmount.value = null
  negotiateFormDelayDays.value = '0'
  negotiateDialogOpen.value = true
}

function onNegotiateRepayDialogClosed() {
  negotiateDialogOrder.value = null
  negotiateDialogPlan.value = null
  negotiateFormAmount.value = null
  negotiateFormDelayDays.value = '0'
}

async function confirmNegotiateRepay() {
  const order = negotiateDialogOrder.value
  const plan = negotiateDialogPlan.value
  if (!order || !plan || !canOperateOrders.value) {
    return
  }
  if (negotiationHistorySavingKey.value || settleAmountSavingKey.value) {
    return
  }
  const amt = Number(negotiateFormAmount.value)
  if (!Number.isFinite(amt) || amt <= 0) {
    ElMessage.warning('请输入有效的协商还款金额')
    return
  }
  const daysRaw = String(negotiateFormDelayDays.value || '').trim()
  if (!/^\d+$/.test(daysRaw)) {
    ElMessage.warning('请输入非负整数作为协商还款延迟天数')
    return
  }
  const delayDays = Number.parseInt(daysRaw, 10)
  if (delayDays > 3650) {
    ElMessage.warning('协商还款延迟天数须在 0～3650 之间')
    return
  }
  const due = remainderDueYmdAfterDelayDays(plan.dueDate, delayDays)
  if (!due) {
    ElMessage.warning('当前期还款日无效，无法根据延迟天数计算协商后还款日')
    return
  }
  const cur = negotiateDialogCurrentDueNumber.value
  if (!Number.isFinite(cur) || cur <= 0) {
    ElMessage.warning('当前应还金额无效')
    return
  }
  if (amt > cur) {
    ElMessage.warning(`协商还款金额不能大于当前应还金额（¥${cur.toFixed(2)}）`)
    return
  }
  if (amt >= cur) {
    ElMessage.warning(`协商还款金额须小于当前应还金额（¥${cur.toFixed(2)}），协商后未还金额须大于 0`)
    return
  }
  const key = `${order.id}-${plan.period}`
  negotiateSavingKey.value = key
  try {
    await updateInstallmentNegotiate(order.id, plan.period, {
      negotiatedAmount: amt,
      remainderDueDate: due,
    })
    ElMessage.success('协商还款已保存')
    negotiateDialogOpen.value = false
    const id = selectedOrder.value?.id
    if (id) {
      const fresh = orders.value.find(o => o.id === id)
      if (fresh) {
        selectedOrder.value = fresh
      }
    }
  }
  catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败')
  }
  finally {
    negotiateSavingKey.value = ''
  }
}

async function promptSettleRepayAmount(order: OrderItem, plan: InstallmentItem) {
  if (!canOperateOrders.value || plan.paid) {
    return
  }
  if (!order.cardPackageIssued) {
    ElMessage.warning('卡包未发放')
    return
  }
  if (plan.negotiationPayPending && Number(plan.negotiationPayPending.negotiatedAmount || 0) > 0) {
    ElMessage.warning('本期尚有协商款项待用户在前台完成支付，请待完成后再操作')
    return
  }
  if (planHasNegotiationHistory(plan)) {
    ElMessage.warning('本期已有协商记录，请通过「协商还款」或协商记录处理，不可直接修改应还金额')
    return
  }
  if (deferDueSavingKey.value || negotiateSavingKey.value || negotiationHistorySavingKey.value || settleAmountSavingKey.value) {
    return
  }
  let value: string
  try {
    const ret = await ElMessageBox.prompt(
      '请输入协商结清金额（元）',
      '协商结清金额',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        inputValue: Number(plan.amount).toFixed(2),
        inputPlaceholder: '例如 5000.00',
        inputValidator: (raw) => {
          const s = String(raw ?? '').trim()
          if (!s) {
            return '请输入金额'
          }
          const n = Number(s)
          if (!Number.isFinite(n) || n < 0.01) {
            return '金额须为不小于 0.01 的数字'
          }
          if (n > 99_999_999) {
            return '金额过大'
          }
          return true
        },
      },
    )
    value = String(ret.value).trim()
  }
  catch (e) {
    if (e === 'cancel' || e === 'close') {
      return
    }
    return
  }
  const nextAmount = Number(Number(value).toFixed(2))
  const cur = Number(Number(plan.amount).toFixed(2))
  if (Math.abs(nextAmount - cur) < 0.005) {
    ElMessage.info('金额未变化')
    return
  }
  const key = `${order.id}-${plan.period}`
  settleAmountSavingKey.value = key
  try {
    await updateInstallmentSettleAmount(order.id, plan.period, nextAmount)
    ElMessage.success('应还金额已更新')
    const id = selectedOrder.value?.id
    if (id) {
      const fresh = orders.value.find(o => o.id === id)
      if (fresh) {
        selectedOrder.value = fresh
      }
    }
  }
  catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败')
  }
  finally {
    settleAmountSavingKey.value = ''
  }
}

async function loadOrders() {
  loading.value = true
  startPageProgress()
  try {
    await fetchOrders({
      keyword: keyword.value.trim(),
      // 订单数据页按还款维度前端筛选，请求不再按发货状态过滤
      status: isCardPackageDataPage.value ? '全部' : status.value,
      payType: payType.value,
      date: orderDate.value,
    })
  }
  finally {
    loading.value = false
    donePageProgress()
    void refreshOrdersMenuPendingReview()
  }
}

async function refreshOrders() {
  await loadOrders()
}

onMounted(() => {
  void loadOrders()
})

watch(status, () => {
  if (!isCardPackageDataPage.value) {
    void loadOrders()
  }
})

watch(
  () => route.name,
  (name) => {
    if (name !== 'orders-card-data') {
      repayFilter.value = '全部'
    }
    void loadOrders()
  },
)
</script>

<template>
  <div class="panel">
    <div class="toolbar">
      <el-select
        v-if="!isCardPackageDataPage"
        v-model="status"
        class="toolbar-select"
      >
        <el-option label="全部状态" value="全部" />
        <el-option label="待发货" value="待发货" />
        <el-option label="待收货" value="待收货" />
        <el-option label="已完成" value="已完成" />
      </el-select>
      <el-select
        v-else
        v-model="repayFilter"
        class="toolbar-select"
      >
        <el-option value="全部">
          <span class="repay-filter-opt repay-filter-opt--all">全部</span>
        </el-option>
        <el-option value="待还款">
          <span class="repay-filter-opt repay-filter-opt--pending">待还款</span>
        </el-option>
        <el-option value="已还款">
          <span class="repay-filter-opt repay-filter-opt--paid">已还款</span>
        </el-option>
        <el-option value="已逾期">
          <span class="repay-filter-opt repay-filter-opt--late">已逾期</span>
        </el-option>
      </el-select>
      <el-date-picker
        v-model="orderDate"
        class="toolbar-date"
        type="date"
        value-format="YYYY-MM-DD"
        placeholder="下单日期"
      />
      <el-input
        v-model="keyword"
        class="toolbar-input"
        placeholder="搜索订单号 / 用户 / 商品"
        clearable
      />
      
      <button
        class="btn btn-secondary"
        type="button"
        :disabled="loading"
        @click="loadOrders"
      >
        查询
      </button>
      <button
        class="btn btn-refresh"
        type="button"
        :disabled="loading"
        @click="refreshOrders"
      >
        刷新
      </button>
    </div>

    <div class="orders-table-scroll">
      <table class="table orders-page-table">
      <thead>
        <tr>
          <th>订单号</th>
          <th>用户</th>
          <th>新老客户</th>
          <th>备注</th>
          <th>商品</th>
          <th>下单时间</th>
          <th>订单金额</th>
          <th>订单状态</th>
          <th>快递单号</th>
          <th>合同签署</th>
          <th>紧急联系人</th>
          <th>卡包发放</th>
          <th>到期应还</th>
          <th>还款到期日</th>
          <th v-if="isCardPackageDataPage">
            还款状态
          </th>
          <th>{{ canOperateOrders ? '操作' : '查看' }}</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="item in filteredOrders"
          :key="item.id"
        >
          <td>{{ item.id }}</td>
          <td class="td-user-risk">
            <el-tag
              type="info"
              effect="light"
              round
              size="small"
              class="order-user-risk-tag"
              :disabled="resolvingRiskUserOrderId === item.id"
              @click="openUserRiskFromOrder(item)"
            >
              {{ item.user }}
            </el-tag>
          </td>
          <td class="td-customer-type">
            <el-tag
              :type="customerTypeTagType(item)"
              effect="light"
              round
              size="small"
            >
              {{ customerTypeLabel(item) }}
            </el-tag>
          </td>
          <td class="td-user-remark">
            <p
              class="order-user-remark-text"
              :class="(item.userRemark || '').trim() ? 'order-user-remark-text--filled' : 'order-user-remark-text--empty'"
              :title="(item.userRemark || '').trim() ? item.userRemark : ''"
            >
              {{ (item.userRemark || '').trim() ? item.userRemark : '暂无备注' }}
            </p>
          </td>
          <td
            class="td-product"
            :title="item.product"
          >
            {{ item.product }}
          </td>
          <td>{{ item.createdAt }}</td>
          <td>¥ {{ item.totalAmount }}</td>
          <td class="td-order-status">
            <el-dropdown
              v-if="canOperateOrders && !item.cardPackageIssued"
              trigger="click"
              :disabled="changingStatusOrderId === item.id"
              @command="(cmd: string) => handleOrderStatusCommand(item, cmd)"
            >
              <span class="order-status-dropdown-trigger">
                <el-tag
                  :type="orderStatusTagType(displayOrderStatus(item))"
                  effect="light"
                  round
                  size="small"
                  class="order-status-tag order-status-tag--clickable"
                >
                  {{ displayOrderStatus(item) }}
                </el-tag>
              </span>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item
                    v-for="opt in ORDER_STATUS_EDIT_OPTIONS"
                    :key="opt"
                    :command="opt"
                    :disabled="orderStatusOptionDisabled(item, opt)"
                    :title="orderStatusOptionTitle(item, opt)"
                  >
                    {{ opt }}
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
            <el-tag
              v-else-if="canOperateOrders && item.cardPackageIssued"
              :type="orderStatusTagType(displayOrderStatus(item))"
              effect="light"
              round
              size="small"
              class="order-status-tag order-status-tag--locked"
              title="卡包已发放，不可修改订单状态；请先将卡包改为未发放"
            >
              {{ displayOrderStatus(item) }}
            </el-tag>
            <el-tag
              v-else
              :type="orderStatusTagType(displayOrderStatus(item))"
              effect="light"
              round
              size="small"
              class="order-status-tag"
            >
              {{ displayOrderStatus(item) }}
            </el-tag>
          </td>
          <td class="td-tracking">
            <template v-if="canOperateOrders && showTrackingEditor(item)">
              <button
                type="button"
                class="tracking-display-btn"
                :class="{ 'is-empty': !item.trackingNumber?.trim() }"
                :disabled="trackingSavingId === item.id"
                @click="openTrackingDialog(item)"
              >
                {{ item.trackingNumber?.trim() || '填写单号' }}
              </button>
            </template>
            <template v-else>
              {{ item.trackingNumber?.trim() || '填写单号' }}
            </template>
          </td>
          <td class="td-card-contract">
            <template v-if="orderHasCardPackageContract(item)">
              <template v-if="canOperateOrders">
                <el-dropdown
                  trigger="click"
                  :disabled="cardPackageContractSavingId === item.id"
                  @command="(cmd: string) => handleCardPackageContractCmd(item, cmd)"
                >
                  <span class="card-package-dropdown-trigger">
                    <el-tag
                      :type="contractSignedTagType(item.cardPackageContractSigned)"
                      effect="light"
                      round
                      size="small"
                      class="card-package-tag"
                      :title="item.cardPackageContractSigned ? formatContractSignedTooltip(item.cardPackageContractSignedAt) : ''"
                    >
                      {{ item.cardPackageContractSigned ? '已签署' : '未签署' }}
                    </el-tag>
                  </span>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item
                        command="unsigned"
                        :disabled="!item.cardPackageContractSigned || item.cardPackageIssued"
                      >
                        未签署
                      </el-dropdown-item>
                      <el-dropdown-item
                        command="signed"
                        :disabled="item.cardPackageContractSigned"
                      >
                        已签署
                      </el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
              </template>
              <el-tag
                v-else
                :type="contractSignedTagType(item.cardPackageContractSigned)"
                effect="light"
                round
                size="small"
                class="card-package-tag"
                :title="item.cardPackageContractSigned ? formatContractSignedTooltip(item.cardPackageContractSignedAt) : ''"
              >
                {{ item.cardPackageContractSigned ? '已签署' : '未签署' }}
              </el-tag>
            </template>
            <span
              v-else
              class="order-contract-na"
            >—</span>
          </td>
          <td class="td-emergency-contact">
            <template v-if="item.emergencyContactsComplete === true">
              <el-tag
                type="success"
                effect="light"
                round
                size="small"
                class="emergency-contact-tag"
              >
                已添加
              </el-tag>
            </template>
            <el-tag
              v-else-if="item.emergencyContactsComplete === false"
              type="info"
              effect="light"
              round
              size="small"
              class="emergency-contact-tag"
            >
              未添加
            </el-tag>
            <span
              v-else
              class="order-contract-na"
            >—</span>
          </td>
          <td class="td-card-package">
            <template v-if="canOperateOrders">
              <el-dropdown
                trigger="click"
                :disabled="cardPackageSavingId === item.id"
                @command="(cmd: string) => handleCardPackageCmd(item, cmd)"
              >
                <span class="card-package-dropdown-trigger">
                  <el-tag
                    :type="cardPackageTagType(item.cardPackageIssued)"
                    effect="light"
                    round
                    size="small"
                    class="card-package-tag"
                  >
                    {{ item.cardPackageIssued ? '已发放' : '未发放' }}
                  </el-tag>
                </span>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item
                      command="pending"
                      :disabled="!item.cardPackageIssued"
                    >
                      未发放
                    </el-dropdown-item>
                    <el-dropdown-item
                      v-if="!item.cardPackageIssued && canMarkCardPackageIssued(item)"
                      command="issued"
                    >
                      已发放
                    </el-dropdown-item>
                    <el-tooltip
                      v-else-if="issuedOptionNeedsContractTip(item)"
                      content="未签署合同"
                      placement="top"
                    >
                      <span class="card-package-issued-tip-wrap">
                        <el-dropdown-item
                          command="issued"
                          disabled
                        >
                          已发放
                        </el-dropdown-item>
                      </span>
                    </el-tooltip>
                    <el-tooltip
                      v-else-if="issuedOptionNeedsEmergencyContactTip(item)"
                      content="未添加紧急联系人，无法发放卡包"
                      placement="top"
                    >
                      <span class="card-package-issued-tip-wrap">
                        <el-dropdown-item
                          command="issued"
                          disabled
                        >
                          已发放
                        </el-dropdown-item>
                      </span>
                    </el-tooltip>
                    <el-dropdown-item
                      v-else
                      command="issued"
                      disabled
                    >
                      已发放
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </template>
            <el-tag
              v-else
              :type="cardPackageTagType(item.cardPackageIssued)"
              effect="light"
              round
              size="small"
              class="card-package-tag"
            >
              {{ item.cardPackageIssued ? '已发放' : '未发放' }}
            </el-tag>
          </td>
          <td>¥ {{ item.periodAmount }}</td>
          <td>{{ item.nextRepayDate }}</td>
          <td v-if="isCardPackageDataPage">
            <el-tag
              :type="repayBucketTagType(orderRepayBucket(item))"
              effect="light"
              round
              size="small"
            >
              {{ orderRepayBucket(item) }}
            </el-tag>
          </td>
          <td class="actions-cell">
            <div class="actions">
              <button
                class="btn btn-primary"
                type="button"
                :disabled="openingPlanOrderId === item.id"
                @click="openPlan(item)"
              >
                {{ openingPlanOrderId === item.id ? '加载中…' : '查看还款' }}
              </button>
              <template v-if="canOperateOrders">
                <button
                  v-if="displayOrderStatus(item) !== '已完成' && !item.cardPackageIssued"
                  class="btn btn-warning"
                  type="button"
                  :disabled="changingStatusOrderId === item.id || displayOrderStatus(item) === '待审核'"
                  @click="rollbackToReview(item)"
                >
                  {{ changingStatusOrderId === item.id ? '处理中...' : '打回审核' }}
                </button>
                <button
                  class="btn btn-danger"
                  type="button"
                  :disabled="deletingOrderId === item.id"
                  @click="handleDeleteOrder(item)"
                >
                  {{ deletingOrderId === item.id ? '删除中...' : '删除' }}
                </button>
              </template>
            </div>
          </td>
        </tr>
        <tr v-if="!loading && filteredOrders.length === 0">
          <td
            :colspan="orderTableColspan"
            style="text-align: center; color: #9ca3af;"
          >
            {{ isCardPackageDataPage ? '暂无卡包已发放的订单' : '暂无未发放卡包的订单' }}
          </td>
        </tr>
      </tbody>
    </table>
    </div>
  </div>

  <div
    v-if="selectedOrder"
    class="modal-mask"
    @click.self="closePlan"
  >
    <div class="modal-panel">
      <div class="modal-header">
        <h3>还款详情 - {{ selectedOrder.id }}</h3>
        <button
          class="btn"
          type="button"
          @click="closePlan"
        >
          关闭
        </button>
      </div>
      <p class="modal-summary">
        <span>用户：{{ selectedOrder.user }}</span>
        <button
          type="button"
          class="btn btn-link-risk"
          :disabled="!!resolvingRiskUserOrderId"
          @click="openUserRiskFromOrder(selectedOrder)"
        >
          查看风控档案
        </button>
        <span> ｜ 商品：{{ selectedOrder.product }} </span>
      </p>

      <table class="table table--plan-modal">
        <thead>
          <tr>
            <th>还款日</th>
            <th>订单金额</th>
            <th>应还金额</th>
            <th>状态</th>
            <th v-if="selectedOrderHasNegotiationHistory">
              协商还款金额
            </th>
            <th v-if="selectedOrderHasNegotiationHistory">
              协商还款日
            </th>
            <th v-if="canOperateOrders">
              操作
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="plan in selectedOrder.installmentPlan"
            :key="plan.period"
          >
            <td>{{ plan.dueDate }}</td>
            <td>¥ {{ selectedOrder.totalAmount }}</td>
            <td>
              ¥ {{ plan.amount }}
              
            </td>
            <td>
              <el-tag
                :type="repayBucketTagType(periodRepayStatus(plan))"
                effect="light"
                round
                size="small"
              >
                {{ periodRepayStatus(plan) }}
              </el-tag>
            </td>
            <td v-if="selectedOrderHasNegotiationHistory">
              <template v-if="selectedOrderNegotiationByPeriod[plan.period]">
                ¥ {{ selectedOrderNegotiationByPeriod[plan.period].negotiatedAmount }}
              </template>
              <span v-else class="plan-modal-negotiate-empty">—</span>
            </td>
            <td v-if="selectedOrderHasNegotiationHistory">
              <template v-if="selectedOrderNegotiationByPeriod[plan.period]?.remainderDueDate">
                {{ selectedOrderNegotiationByPeriod[plan.period].remainderDueDate }}
              </template>
              <span v-else class="plan-modal-negotiate-empty">—</span>
            </td>
            <td v-if="canOperateOrders">
              <div class="plan-modal-actions">
                <template v-if="plan.paid">
                  <button
                    class="btn btn-warning"
                    type="button"
                    :disabled="!!deferDueSavingKey || !!negotiateSavingKey || !!negotiationHistorySavingKey || !!settleAmountSavingKey"
                    @click="toggleRepay(selectedOrder, plan)"
                  >
                    标记未还
                  </button>
                </template>
                <el-tooltip
                  v-else
                  content="卡包未发放"
                  placement="top"
                  :disabled="selectedOrder.cardPackageIssued"
                >
                  <span class="plan-modal-action-tooltip-host">
                    <button
                      class="btn btn-success"
                      type="button"
                      :disabled="!selectedOrder.cardPackageIssued || !!deferDueSavingKey || !!negotiateSavingKey || !!negotiationHistorySavingKey || !!settleAmountSavingKey"
                      @click="toggleRepay(selectedOrder, plan)"
                    >
                      标记已还
                    </button>
                  </span>
                </el-tooltip>
                <el-tooltip
                  v-if="!plan.paid"
                  :content="deferRepaymentTooltip(plan)"
                  placement="top"
                  :disabled="deferRepaymentTooltip(plan) === ''"
                >
                  <span class="plan-modal-action-tooltip-host">
                    <button
                      class="btn btn-warning"
                      type="button"
                      :disabled="!selectedOrder.cardPackageIssued || !!deferDueSavingKey || !!negotiateSavingKey || !!negotiationHistorySavingKey || !!settleAmountSavingKey || planHasNegotiationHistory(plan)"
                      @click="deferRepaymentDue(selectedOrder, plan)"
                    >
                      {{ deferDueSavingKey === `${selectedOrder.id}-${plan.period}` ? '处理中…' : '延期还款' }}
                    </button>
                  </span>
                </el-tooltip>
                <el-tooltip
                  v-if="!plan.paid"
                  :content="!selectedOrder.cardPackageIssued ? '卡包未发放' : (plan.negotiationPayPending ? '待用户在前台完成协商支付' : '')"
                  placement="top"
                  :disabled="selectedOrder.cardPackageIssued && !plan.negotiationPayPending"
                >
                  <span class="plan-modal-action-tooltip-host">
                    <button
                      class="btn btn-danger"
                      type="button"
                      :disabled="!selectedOrder.cardPackageIssued || !!deferDueSavingKey || !!negotiateSavingKey || !!negotiationHistorySavingKey || !!settleAmountSavingKey || !!plan.negotiationPayPending"
                      @click="openNegotiateRepayDialog(selectedOrder, plan)"
                    >
                      {{ negotiateSavingKey === `${selectedOrder.id}-${plan.period}` ? '处理中…' : '协商部分还款' }}
                    </button>
                  </span>
                </el-tooltip>
                <el-tooltip
                  v-if="!plan.paid"
                  :content="settleAmountTooltip(plan)"
                  placement="top"
                  :disabled="settleAmountTooltip(plan) === ''"
                >
                  <span class="plan-modal-action-tooltip-host">
                    <button
                      class="btn btn-danger-settle"
                      type="button"
                      :disabled="!selectedOrder.cardPackageIssued || !!deferDueSavingKey || !!negotiateSavingKey || !!negotiationHistorySavingKey || !!settleAmountSavingKey || !!plan.negotiationPayPending || planHasNegotiationHistory(plan)"
                      @click="promptSettleRepayAmount(selectedOrder, plan)"
                    >
                      {{ settleAmountSavingKey === `${selectedOrder.id}-${plan.period}` ? '处理中…' : '协商结清还款' }}
                    </button>
                  </span>
                </el-tooltip>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <section
        v-if="selectedOrderHasNegotiationHistory"
        class="modal-negotiation-records"
      >
        <h4 class="modal-negotiation-records__title">
          协商记录
        </h4>
        <template
          v-for="plan in selectedOrder.installmentPlan"
          :key="`neg-${plan.period}`"
        >
          <div
            v-if="plan.negotiationHistory?.length"
            class="modal-negotiation-records__period"
          >
            <p class="modal-negotiation-records__period-label">
              第 {{ plan.period }} 期
            </p>
            <div class="modal-negotiation-records__table-wrap">
              <table
                class="table table--negotiation-records"
                :class="{ 'table--negotiation-records--with-actions': canOperateOrders }"
              >
                <colgroup>
                  <col class="table--negotiation-records__col-datetime">
                  <col class="table--negotiation-records__col-money">
                  <col class="table--negotiation-records__col-money">
                  <col class="table--negotiation-records__col-due">
                  <col class="table--negotiation-records__col-status">
                  <col
                    v-if="canOperateOrders"
                    class="table--negotiation-records__col-actions"
                  />
                </colgroup>
                <thead>
                  <tr>
                    <th class="table--negotiation-records__th-datetime">
                      协商日期
                    </th>
                    <th class="table--negotiation-records__num">
                      协商还款金额
                    </th>
                    <th class="table--negotiation-records__num">
                      剩余未还金额
                    </th>
                    <th class="table--negotiation-records__th-due">
                      协商还款日
                    </th>
                    <th class="table--negotiation-records__th-status">
                      协商金额还款状态
                    </th>
                    <th
                      v-if="canOperateOrders"
                      class="table--negotiation-records__th-actions"
                    >
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="(row, idx) in plan.negotiationHistory"
                    :key="`${row.createdAt}-${idx}`"
                  >
                    <td class="table--negotiation-records__datetime">
                      {{ formatNegotiationCreatedAt(row.createdAt) }}
                    </td>
                    <td class="table--negotiation-records__num table--negotiation-records__amt">
                      ¥{{ Number(row.negotiatedAmount).toFixed(2) }}
                    </td>
                    <td class="table--negotiation-records__num table--negotiation-records__remainder">
                      ¥{{ Number(row.remainderAmount).toFixed(2) }}
                    </td>
                    <td class="table--negotiation-records__due">
                      {{ row.remainderDueDate || '—' }}
                    </td>
                    <td class="table--negotiation-records__status">
                      <template
                        v-for="st in [negotiationRowPayStatus(plan, row, idx)]"
                        :key="`st-${row.createdAt}-${idx}`"
                      >
                        <el-tag
                          :type="st.tag"
                          effect="light"
                          round
                          size="small"
                          class="table--negotiation-records__status-tag"
                        >
                          {{ st.text }}
                        </el-tag>
                      </template>
                    </td>
                    <td
                      v-if="canOperateOrders"
                      class="table--negotiation-records__actions"
                    >
                      <div class="table--negotiation-records__actions-inner">
                        <button
                          v-if="negotiationRowCanMarkPaid(plan, row, idx)"
                          class="btn btn-success"
                          type="button"
                          :disabled="!selectedOrder.cardPackageIssued || !!deferDueSavingKey || !!negotiateSavingKey || !!negotiationHistorySavingKey || !!settleAmountSavingKey"
                          @click="toggleNegotiationHistoryPaid(selectedOrder, plan, idx, true)"
                        >
                          {{ negotiationHistorySavingKey === `${selectedOrder.id}-${plan.period}-${idx}` ? '处理中…' : '标记已还' }}
                        </button>
                        <button
                          v-if="negotiationRowCanMarkUnpaid(plan, row, idx)"
                          class="btn btn-warning"
                          type="button"
                          :disabled="!selectedOrder.cardPackageIssued || !!deferDueSavingKey || !!negotiateSavingKey || !!negotiationHistorySavingKey || !!settleAmountSavingKey"
                          @click="toggleNegotiationHistoryPaid(selectedOrder, plan, idx, false)"
                        >
                          {{ negotiationHistorySavingKey === `${selectedOrder.id}-${plan.period}-${idx}` ? '处理中…' : '标记未还' }}
                        </button>
                        <span
                          v-else-if="negotiationRowShowFullRepayHint(plan, row, idx)"
                          class="table--negotiation-records__full-repay-hint"
                        >已全额还款</span>
                        <span
                          v-else-if="negotiationRowShowSupersededEndedHint(plan, row, idx)"
                          class="table--negotiation-records__full-repay-hint"
                        >此协商已完结</span>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </template>
      </section>
    </div>
  </div>

  <el-dialog
    v-model="negotiateDialogOpen"
    title="协商详情"
    width="500px"
    align-center
    destroy-on-close
    class="negotiate-repay-dialog"
    body-class="negotiate-repay-dialog__body"
    @closed="onNegotiateRepayDialogClosed"
  >
    <template v-if="negotiateDialogOrder && negotiateDialogPlan">
      <div class="negotiate-repay-dialog__head">
        <p class="negotiate-repay-dialog__meta">
          订单 <span class="negotiate-repay-dialog__mono">{{ negotiateDialogOrder.id }}</span>
          <span class="negotiate-repay-dialog__dot">·</span>
          第 {{ negotiateDialogPlan.period }} 期
        </p>
        <el-alert
          type="info"
          :closable="false"
          show-icon
          class="negotiate-repay-dialog__due-alert"
        >
          <template #title>
            <span class="negotiate-repay-dialog__due-alert-title">当前应还金额</span>
            <span class="negotiate-repay-dialog__due-alert-amt">¥ {{ negotiateDialogCurrentDueNumber.toFixed(2) }}</span>
          </template>
          <span class="negotiate-repay-dialog__due-alert-sub">协商还款金额不可大于该数额；须小于全额以便保留未还本金。</span>
        </el-alert>
      </div>

      <div
        v-if="negotiateDialogPlan.negotiationHistory?.length"
        class="negotiate-repay-dialog__history-block"
      >
        <p class="negotiate-repay-dialog__history-title">
          历史协商记录
        </p>
        <div class="negotiate-repay-dialog__history-cards">
          <div
            v-for="(row, idx) in negotiateDialogPlan.negotiationHistory"
            :key="`${row.createdAt}-${idx}`"
            class="negotiate-repay-dialog__history-card"
          >
            <div class="negotiate-repay-dialog__history-card-top">
              <span class="negotiate-repay-dialog__history-date">{{ formatNegotiationCreatedAt(row.createdAt) }}</span>
              <el-tag
                :type="negotiationRowPayStatus(negotiateDialogPlan, row, idx).tag === 'warning' ? 'warning' : 'success'"
                effect="light"
                round
                size="small"
              >
                {{ negotiationRowPayStatus(negotiateDialogPlan, row, idx).text }}
              </el-tag>
            </div>
            <div class="negotiate-repay-dialog__history-card-grid">
              <div class="negotiate-repay-dialog__history-cell">
                <span class="negotiate-repay-dialog__history-label">协商还款金额</span>
                <span class="negotiate-repay-dialog__history-val negotiate-repay-dialog__history-val--amt">¥ {{ Number(row.negotiatedAmount).toFixed(2) }}</span>
              </div>
              <div class="negotiate-repay-dialog__history-cell">
                <span class="negotiate-repay-dialog__history-label">剩余未还</span>
                <span class="negotiate-repay-dialog__history-val negotiate-repay-dialog__history-val--rem">¥ {{ Number(row.remainderAmount).toFixed(2) }}</span>
              </div>
              <div class="negotiate-repay-dialog__history-cell negotiate-repay-dialog__history-cell--full">
                <span class="negotiate-repay-dialog__history-label">协商还款日</span>
                <span class="negotiate-repay-dialog__history-val negotiate-repay-dialog__history-val--due">{{ row.remainderDueDate || '—' }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <el-form label-position="top" class="negotiate-repay-dialog__form">
        <el-form-item label="协商还款金额（元）">
          <el-input-number
            v-model="negotiateFormAmount"
            :min="0.01"
            :max="negotiateDialogMaxNegotiatedAmount"
            :precision="2"
            :step="0.01"
            :controls="false"
            class="negotiate-repay-dialog__amount"
            @change="onNegotiateAmountChange"
          />
          <p class="negotiate-repay-dialog__amount-hint">
            可填范围：0.01 ～ ¥{{ negotiateDialogMaxNegotiatedAmount.toFixed(2) }}（须小于应还 ¥{{ negotiateDialogCurrentDueNumber.toFixed(2) }}）
          </p>
        </el-form-item>
        <el-form-item label="协商还款延迟天数">
          <el-input
            v-model="negotiateFormDelayDays"
            placeholder="相对当前期还款日顺延的天数，0 表示不推迟"
            clearable
            inputmode="numeric"
            maxlength="4"
            class="negotiate-repay-dialog__delay-days"
          />
          <p
            v-if="negotiateRemainderDuePreview"
            class="negotiate-repay-dialog__due-preview"
          >
            <span class="negotiate-repay-dialog__due-preview-label">预览</span>
            协商后还款日 <strong>{{ negotiateRemainderDuePreview }}</strong>
          </p>
        </el-form-item>
      </el-form>
    </template>
    <template #footer>
      <el-button @click="negotiateDialogOpen = false">
        取消
      </el-button>
      <el-button
        type="primary"
        :loading="!!negotiateSavingKey"
        @click="confirmNegotiateRepay"
      >
        确定
      </el-button>
    </template>
  </el-dialog>

  <el-dialog
    v-model="trackingDialogOpen"
    title="快递单号"
    width="420px"
    align-center
    destroy-on-close
    class="tracking-shipment-dialog"
    body-class="tracking-shipment-dialog__body"
    @closed="onTrackingDialogClosed"
  >
    <template v-if="trackingDialogOrder">
      <p class="tracking-dialog-meta">
        订单 {{ trackingDialogOrder.id }} ｜ {{ trackingDialogOrder.product }}
      </p>
      <el-input
        v-model="trackingDialogInput"
        placeholder="请输入快递单号"
        clearable
        :disabled="!!trackingSavingId"
        @keyup.enter="confirmTrackingDialog"
      />
    </template>
    <template #footer>
      <el-button @click="trackingDialogOpen = false">
        取消
      </el-button>
      <el-button
        type="primary"
        :loading="!!trackingSavingId"
        @click="confirmTrackingDialog"
      >
        保存
      </el-button>
    </template>
  </el-dialog>

  <UserRiskDetailDialog
    v-if="userRiskDialogVisible"
    v-model="userRiskDialogVisible"
    :user-id="riskDialogUserId"
    :context-order-shipping="riskContextOrderShipping"
    @user-updated="onRiskDialogUserUpdated"
  />
</template>

<style scoped>
.negotiate-repay-dialog__body {
  padding-top: 4px;
}

.negotiate-repay-dialog__head {
  margin-bottom: 14px;
}

.negotiate-repay-dialog__meta {
  margin: 0 0 10px;
  font-size: 13px;
  color: #64748b;
}

.negotiate-repay-dialog__mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-weight: 600;
  color: #334155;
}

.negotiate-repay-dialog__dot {
  margin: 0 0.35em;
  opacity: 0.55;
}

.negotiate-repay-dialog__due-alert {
  border-radius: 10px;
}

.negotiate-repay-dialog__due-alert :deep(.el-alert__title) {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.35rem 0.6rem;
  font-size: 14px;
  line-height: 1.45;
}

.negotiate-repay-dialog__due-alert-title {
  font-weight: 600;
  color: #1e40af;
}

.negotiate-repay-dialog__due-alert-amt {
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: #0f172a;
  font-variant-numeric: tabular-nums;
}

.negotiate-repay-dialog__due-alert :deep(.el-alert__description) {
  margin-top: 4px;
}

.negotiate-repay-dialog__due-alert-sub {
  display: block;
  font-size: 12px;
  line-height: 1.45;
  color: #64748b;
}

.negotiate-repay-dialog__history-block {
  margin-bottom: 16px;
}

.negotiate-repay-dialog__history-title {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 600;
  color: #334155;
  letter-spacing: 0.02em;
}

.negotiate-repay-dialog__history-cards {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 220px;
  overflow-y: auto;
  padding-right: 2px;
}

.negotiate-repay-dialog__history-card {
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 10px 12px;
  background: linear-gradient(180deg, #fafbff 0%, #f8fafc 100%);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}

.negotiate-repay-dialog__history-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid #e2e8f0;
}

.negotiate-repay-dialog__history-date {
  font-size: 12px;
  font-weight: 500;
  color: #64748b;
  font-variant-numeric: tabular-nums;
}

.negotiate-repay-dialog__history-card-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 12px;
}

.negotiate-repay-dialog__history-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.negotiate-repay-dialog__history-cell--full {
  grid-column: 1 / -1;
}

.negotiate-repay-dialog__history-label {
  font-size: 11px;
  color: #94a3b8;
  letter-spacing: 0.02em;
}

.negotiate-repay-dialog__history-val {
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.negotiate-repay-dialog__history-val--amt {
  color: #047857;
}

.negotiate-repay-dialog__history-val--rem {
  color: #c2410c;
}

.negotiate-repay-dialog__history-val--due {
  color: #1d4ed8;
}

.negotiate-repay-dialog__form {
  margin-top: 4px;
}

.negotiate-repay-dialog__amount {
  width: 100%;
}

.negotiate-repay-dialog__amount-hint {
  margin: 6px 0 0;
  font-size: 12px;
  color: #94a3b8;
  line-height: 1.45;
}

.negotiate-repay-dialog__delay-days {
  width: 100%;
}

.negotiate-repay-dialog__due-preview {
  margin: 8px 0 0;
  font-size: 13px;
  color: #475569;
  line-height: 1.45;
}

.negotiate-repay-dialog__due-preview-label {
  display: inline-block;
  margin-right: 6px;
  padding: 0 6px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  color: #0369a1;
  background: #e0f2fe;
  vertical-align: middle;
}

.negotiate-repay-dialog__due-preview strong {
  color: #0f172a;
  font-variant-numeric: tabular-nums;
}

.orders-table-scroll {
  width: 100%;
  max-width: 100%;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

.orders-page-table {
  /* 覆盖全局 .table { width:100% }，按内容撑开以便横向滚动能看到最右侧「操作」列 */
  width: max-content;
  min-width: 100%;
  table-layout: auto;
}

.orders-page-table th,
.orders-page-table td {
  box-sizing: border-box;
}

.orders-page-table th:nth-child(1),
.orders-page-table td:nth-child(1) {
  min-width: 9.5rem;
  max-width: 11rem;
  word-break: break-all;
}

.orders-page-table th:nth-child(2),
.orders-page-table td:nth-child(2) {
  min-width: 4.5rem;
  white-space: nowrap;
}

.orders-page-table th:nth-child(3),
.orders-page-table td:nth-child(3) {
  min-width: 5rem;
  max-width: 7.5rem;
}

.orders-page-table th:nth-child(4),
.orders-page-table td:nth-child(4) {
  width: 9rem;
  max-width: 9rem;
}

.orders-page-table .td-product {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.orders-page-table th:last-child,
.orders-page-table td.actions-cell {
  min-width: 26rem;
  width: auto;
  white-space: nowrap;
  vertical-align: middle;
}

.card-package-issued-tip-wrap {
  display: block;
  width: 100%;
}

.card-data-hint {
  margin-bottom: 14px;
}

.plan-modal-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.plan-modal-action-tooltip-host {
  display: inline-block;
}

/* 先享后付弹窗：禁用态置灰（否则 success/warning 仍显示饱和色） */
.plan-modal-actions .btn:disabled {
  border-color: #cbd5e1;
  background: #e2e8f0;
  color: #94a3b8;
  cursor: not-allowed;
  opacity: 1;
}

.table--plan-modal {
  margin-top: 8px;
}

.plan-modal-negotiate-empty {
  color: #94a3b8;
}

.plan-modal-pending-negotiate-hint {
  margin: 4px 0 0;
  font-size: 12px;
  font-weight: 500;
  color: #b45309;
  line-height: 1.35;
}

.modal-negotiation-records {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid #e5e7eb;
}

.modal-negotiation-records__title {
  margin: 0 0 10px;
  font-size: 14px;
  font-weight: 600;
  color: #111827;
}

.modal-negotiation-records__period {
  margin-bottom: 12px;
}

.modal-negotiation-records__period:last-child {
  margin-bottom: 0;
}

.modal-negotiation-records__period-label {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 600;
  color: #374151;
}

.modal-negotiation-records__table-wrap {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  overflow: hidden;
  background: #fff;
}

.table--negotiation-records {
  margin: 0;
  font-size: 13px;
  table-layout: fixed;
  width: 100%;
}

/* 五列按比例占满宽度 */
.table--negotiation-records__col-datetime {
  width: 20%;
}

.table--negotiation-records__col-money {
  width: 17%;
}

.table--negotiation-records__col-due {
  width: 13%;
}

.table--negotiation-records__col-status {
  width: 33%;
}

.table--negotiation-records--with-actions .table--negotiation-records__col-datetime {
  width: 17%;
}

.table--negotiation-records--with-actions .table--negotiation-records__col-money {
  width: 15%;
}

.table--negotiation-records--with-actions .table--negotiation-records__col-due {
  width: 12%;
}

.table--negotiation-records--with-actions .table--negotiation-records__col-status {
  width: 18%;
}

.table--negotiation-records__col-actions {
  width: 18%;
}

.table--negotiation-records__th-actions {
  text-align: center;
}

.table--negotiation-records__actions {
  text-align: center;
  vertical-align: middle;
}

.table--negotiation-records__actions-inner {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: center;
  align-items: center;
}

.table--negotiation-records__actions-inner .btn {
  padding: 4px 10px;
  font-size: 12px;
}

.table--negotiation-records__full-repay-hint {
  font-size: 12px;
  line-height: 1.45;
  color: #64748b;
  max-width: 7.5rem;
  text-align: center;
}

.table--negotiation-records thead th {
  padding: 9px 10px;
  font-size: 12px;
  letter-spacing: 0.02em;
  color: #64748b;
  background: linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%);
  border-bottom: 1px solid #e2e8f0;
  white-space: nowrap;
}

.table--negotiation-records__th-datetime {
  text-align: left;
}

.table--negotiation-records__th-due {
  text-align: center;
}

.table--negotiation-records__th-status {
  text-align: center;
}

.table--negotiation-records tbody td {
  padding: 10px 10px;
  border-bottom: 1px solid #f1f5f9;
  vertical-align: middle;
}

.table--negotiation-records tbody tr:last-child td {
  border-bottom: none;
}

.table--negotiation-records tbody tr:hover td {
  background: #fafbfc;
}

.table--negotiation-records__datetime {
  color: #334155;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.table--negotiation-records__num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.table--negotiation-records__amt {
  color: #047857;
  font-weight: 600;
}

.table--negotiation-records__remainder {
  color: #c2410c;
  font-weight: 600;
}

.table--negotiation-records__due {
  color: #1d4ed8;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  text-align: center;
}

.table--negotiation-records__status {
  text-align: center;
  vertical-align: middle;
}

.table--negotiation-records__status-tag {
  max-width: 100%;
  height: auto;
  white-space: normal;
  line-height: 1.35;
  padding: 4px 10px;
  text-align: center;
}

.repay-filter-opt {
  font-weight: 600;
}

.repay-filter-opt--all {
  color: #64748b;
}

.repay-filter-opt--pending {
  color: #c2410c;
}

.repay-filter-opt--paid {
  color: #15803d;
}

.repay-filter-opt--late {
  color: #b91c1c;
}

.btn {
  height: 30px;
  border-radius: 6px;
  border: 1px solid #d1d5db;
  background: #fff;
  cursor: pointer;
  padding: 0 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
}

.btn-primary {
  border-color: #2563eb;
  background: #2563eb;
  color: #fff;
}

.btn-secondary {
  border-color: #9ca3af;
  background: #f8fafc;
  color: #374151;
}

.btn-success {
  border-color: #059669;
  background: #059669;
  color: #fff;
}

.btn-warning {
  border-color: #d97706;
  background: #d97706;
  color: #fff;
}

.btn-danger {
  border-color: #dc2626;
  background: #dc2626;
  color: #fff;
}

/* 协商结清金额：比「协商部分还款」更深的红色，强调不可逆/高危操作 */
.btn-danger-settle {
  border-color: #7f1d1d;
  background: #991b1b;
  color: #fff;
}

.btn-link-risk {
  margin-left: 6px;
  padding: 0 8px;
  height: 28px;
  border: none;
  background: transparent;
  color: #2563eb;
  cursor: pointer;
  font-size: 13px;
  text-decoration: underline;
  vertical-align: baseline;
}

.btn-link-risk:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.td-user-risk {
  vertical-align: middle;
}

.td-user-remark {
  vertical-align: middle;
}

.order-user-remark-text {
  margin: 0;
  line-height: 1.45;
  word-break: break-word;
  overflow: hidden;
  display: block;
  width: 100%;
  max-height: 4.35em;
}

.order-user-remark-text--filled {
  font-size: 16px;
  font-weight: 700;
  color: #dc2626;
}

.order-user-remark-text--empty {
  font-size: 12px;
  font-weight: 400;
  color: #a8a1a1;
}

.order-user-risk-tag {
  cursor: pointer;
  user-select: none;
  font-weight: 600;
  max-width: 220px;
  transition: filter 0.15s ease, transform 0.12s ease;
}

.order-user-risk-tag:hover:not(.is-disabled) {
  filter: brightness(0.96);
}

.order-user-risk-tag:active:not(.is-disabled) {
  transform: scale(0.98);
}

.toolbar-input {
  width: 260px;
}

.toolbar-select,
.toolbar-date {
  width: 160px;
}

.td-tracking {
  vertical-align: middle;
  max-width: 200px;
}

.tracking-display-btn {
  display: inline-block;
  max-width: 100%;
  padding: 0;
  border: none;
  background: none;
  font: inherit;
  line-height: inherit;
  color: #1e40af;
  text-align: left;
  cursor: pointer;
  text-decoration: underline;
  text-decoration-style: dotted;
  text-underline-offset: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tracking-display-btn:hover:not(:disabled) {
  color: #1d4ed8;
}

.tracking-display-btn.is-empty {
  color: #94a3b8;
}

.tracking-display-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.td-order-status {
  vertical-align: middle;
}

/* 订单状态：与卡包列区分色（待发货保留琥珀色） */
.td-order-status :deep(.el-tag--warning) {
  --el-tag-bg-color: #fffbeb;
  --el-tag-border-color: #fbbf24;
  --el-tag-text-color: #b45309;
}

.td-order-status :deep(.el-tag--primary) {
  --el-tag-bg-color: #eff6ff;
  --el-tag-border-color: #93c5fd;
  --el-tag-text-color: #1d4ed8;
}

.td-order-status :deep(.el-tag--success) {
  --el-tag-bg-color: #ecfdf5;
  --el-tag-border-color: #6ee7b7;
  --el-tag-text-color: #047857;
}

.order-status-tag {
  font-weight: 600;
}

.order-status-dropdown-trigger {
  cursor: pointer;
  outline: none;
}

.order-status-tag--clickable:hover {
  filter: brightness(0.97);
}

.order-status-tag--locked {
  cursor: default;
}

.td-card-package {
  vertical-align: middle;
}

.td-card-contract {
  vertical-align: middle;
}

.order-contract-na {
  color: #9ca3af;
  font-size: 0.9rem;
}

/* 未签署 / 未发放 / 未添加：统一中性灰 */
.td-card-package :deep(.el-tag--info),
.td-card-contract :deep(.el-tag--info),
.td-emergency-contact :deep(.el-tag--info) {
  --el-tag-bg-color: #f8fafc;
  --el-tag-border-color: #cbd5e1;
  --el-tag-text-color: #64748b;
}

.td-card-package :deep(.el-tag--success),
.td-card-contract :deep(.el-tag--success),
.td-emergency-contact :deep(.el-tag--success) {
  --el-tag-bg-color: #ecfdf5;
  --el-tag-border-color: #6ee7b7;
  --el-tag-text-color: #047857;
}

.td-emergency-contact {
  vertical-align: middle;
}

.emergency-contact-tag {
  font-weight: 600;
}

.card-package-dropdown-trigger {
  display: inline-flex;
  vertical-align: middle;
}

.card-package-tag {
  cursor: pointer;
  user-select: none;
  font-weight: 600;
  transition: filter 0.15s ease, transform 0.12s ease;
}

.card-package-tag:hover {
  filter: brightness(0.96);
}

.card-package-tag:active {
  transform: scale(0.98);
}

.actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: nowrap;
  min-width: max-content;
}

.actions-cell {
  overflow: visible;
}

.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.35);
  display: grid;
  place-items: center;
  padding: 20px;
}

.modal-panel {
  width: 900px;
  max-width: 100%;
  border-radius: 12px;
  background: #fff;
  border: 1px solid #e5e7eb;
  padding: 16px;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.modal-header h3 {
  margin: 0;
}

.modal-summary {
  margin: 0 0 12px;
  color: #4b5563;
  font-size: 14px;
}
</style>

<style>
/* el-dialog 内容挂到 body，与 scoped 分离 */
.defer-repay-msgbox-confirm.el-button--primary {
  background-color: #d97706;
  border-color: #d97706;
  color: #fff;
}

.defer-repay-msgbox-confirm.el-button--primary:hover,
.defer-repay-msgbox-confirm.el-button--primary:focus {
  background-color: #b45309;
  border-color: #b45309;
  color: #fff;
}

.tracking-shipment-dialog__body .tracking-dialog-meta {
  margin: 0 0 12px;
  font-size: 13px;
  color: #64748b;
}
</style>
