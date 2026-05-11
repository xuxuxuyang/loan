<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { InstallmentItem, OrderItem } from '../stores/useOrdersStore'
import { getAdminSession } from '../composables/useAdminAuth'
import { withAdminAuthHeaders } from '../composables/useAdminApi'
import { useOrdersStore } from '../stores/useOrdersStore'
import UserRiskDetailDialog, { type UserItem } from '../components/UserRiskDetailDialog.vue'
import { donePageProgress, startPageProgress } from '../utils/progress'

const MALL_API_BASE = `${(import.meta.env.VITE_MALL_API_BASE || 'http://localhost:3110/api').replace(/\/$/, '')}`

const route = useRoute()
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
const changingStatusOrderId = ref('')
const trackingSavingId = ref('')
const cardPackageSavingId = ref('')
const cardPackageContractSavingId = ref('')
const deletingOrderId = ref('')
const trackingDialogOpen = ref(false)
const trackingDialogOrder = ref<OrderItem | null>(null)
const trackingDialogInput = ref('')
const addressDialogOpen = ref(false)
const addressDialogOrder = ref<OrderItem | null>(null)
const userRiskDialogVisible = ref(false)
const riskDialogUserId = ref<string | null>(null)
const resolvingRiskUserOrderId = ref<string | null>(null)
const { orders, recalculateOrderFields, fetchOrders, updateInstallmentPaid, updateInstallmentDueDate, updateOrderStatus, updateOrderShipment, updateOrderCardPackage, updateOrderCardPackageContract, deleteOrder } = useOrdersStore()
const canOperateOrders = computed(() => getAdminSession()?.role === 'super_admin')

function normalizePhone(raw: string): string {
  return String(raw || '').replace(/\D/g, '')
}

watch(userRiskDialogVisible, (open) => {
  if (!open)
    riskDialogUserId.value = null
})

function onRiskDialogUserUpdated(_user: UserItem) {
  void loadOrders().catch(() => {})
}

async function openUserRiskFromOrder(order: OrderItem) {
  const digits = normalizePhone(order.receiverPhone || '')
  if (digits.length !== 11) {
    ElMessage.error('订单无有效收货手机号，无法打开用户风控档案')
    return
  }
  if (resolvingRiskUserOrderId.value) {
    return
  }
  resolvingRiskUserOrderId.value = order.id
  try {
    const url = `${MALL_API_BASE}/users/by-phone?phone=${encodeURIComponent(digits)}`
    const response = await fetch(url, {
      method: 'GET',
      headers: withAdminAuthHeaders(),
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
  return item.status === '待发货' || item.status === '待收货'
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

const deferDueSavingKey = ref('')

const orderTableColspan = computed(() => (isCardPackageDataPage.value ? 14 : 13))

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

function openPlan(order: OrderItem) {
  selectedOrder.value = order
}

function closePlan() {
  selectedOrder.value = null
}

async function toggleRepay(order: OrderItem, period: InstallmentItem) {
  if (!canOperateOrders.value) return
  const nextPaid = !period.paid
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

function openAddressDialog(order: OrderItem) {
  addressDialogOrder.value = order
  addressDialogOpen.value = true
}

function onAddressDialogClosed() {
  addressDialogOrder.value = null
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
  if (order.status === label) {
    return
  }
  if (changingStatusOrderId.value) {
    return
  }
  changingStatusOrderId.value = order.id
  try {
    await updateOrderStatus(order.id, orderStatusToApi[key])
    ElMessage.success('订单状态已更新')
    await loadOrders()
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
    await loadOrders()
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
    await loadOrders()
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

/** 先享后付：仅合同已签署后才允许标记卡包已发放 */
function canMarkCardPackageIssued(order: OrderItem): boolean {
  if (!orderHasCardPackageContract(order)) {
    return true
  }
  return Boolean(order.cardPackageContractSigned)
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
    ElMessage.warning('请先完成合同签署后再标记卡包已发放')
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
  const key = `${order.id}-${plan.period}`
  if (deferDueSavingKey.value) {
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
    <el-alert
      v-if="isCardPackageDataPage"
      class="card-data-hint"
      type="info"
      :closable="false"
      show-icon
      title="本页以卡包发放状态为准，仅展示已标记为「卡包已发放」的订单。筛选为还款维度：结合各期「还款日」与当前日期、以及是否已还。"
    />
    <div class="toolbar">
      <el-input
        v-model="keyword"
        class="toolbar-input"
        placeholder="搜索订单号 / 用户 / 商品"
        clearable
      />
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
          <th>备注</th>
          <th>商品</th>
          <th>总金额</th>
          <th>本期应还</th>
          <th>下次还款日</th>
          <th v-if="isCardPackageDataPage">
            还款状态
          </th>
          <th>下单时间</th>
          <th>订单状态</th>
          <th>快递单号</th>
          <th>卡包发放</th>
          <th>合同签署</th>
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
          <td class="td-user-remark">
            <p
              class="order-user-remark-text"
              :title="(item.userRemark || '').trim() ? item.userRemark : ''"
            >
              {{ (item.userRemark || '').trim() ? item.userRemark : '—' }}
            </p>
          </td>
          <td
            class="td-product"
            :title="item.product"
          >
            {{ item.product }}
          </td>
          <td>¥ {{ item.totalAmount }}</td>
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
          <td>{{ item.createdAt }}</td>
          <td class="td-order-status">
            <el-dropdown
              v-if="canOperateOrders && !item.cardPackageIssued"
              trigger="click"
              :disabled="changingStatusOrderId === item.id"
              @command="(cmd: string) => handleOrderStatusCommand(item, cmd)"
            >
              <span class="order-status-dropdown-trigger">
                <el-tag
                  :type="orderStatusTagType(item.status)"
                  effect="light"
                  round
                  size="small"
                  class="order-status-tag order-status-tag--clickable"
                >
                  {{ item.status }}
                </el-tag>
              </span>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item
                    v-for="opt in ORDER_STATUS_EDIT_OPTIONS"
                    :key="opt"
                    :command="opt"
                    :disabled="item.status === opt"
                  >
                    {{ opt }}
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
            <el-tag
              v-else-if="canOperateOrders && item.cardPackageIssued"
              :type="orderStatusTagType(item.status)"
              effect="light"
              round
              size="small"
              class="order-status-tag order-status-tag--locked"
              title="卡包已发放，不可修改订单状态；请先将卡包改为未发放"
            >
              {{ item.status }}
            </el-tag>
            <el-tag
              v-else
              :type="orderStatusTagType(item.status)"
              effect="light"
              round
              size="small"
              class="order-status-tag"
            >
              {{ item.status }}
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
          <td class="actions-cell">
            <div class="actions">
              <button
                class="btn btn-primary"
                type="button"
                @click="openPlan(item)"
              >
                查看先享后付
              </button>
              <button
                class="btn btn-secondary"
                type="button"
                @click="openAddressDialog(item)"
              >
                查看收货地址
              </button>
              <template v-if="canOperateOrders">
                <button
                  v-if="item.status !== '已完成' && !item.cardPackageIssued"
                  class="btn btn-warning"
                  type="button"
                  :disabled="changingStatusOrderId === item.id || item.status === '待审核'"
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
        <h3>先享后付计划 - {{ selectedOrder.id }}</h3>
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
        <span> ｜ 商品：{{ selectedOrder.product }} ｜ 总金额：¥ {{ selectedOrder.totalAmount }}</span>
      </p>

      <table class="table table--plan-modal">
        <thead>
          <tr>
            <th>还款日</th>
            <th>订单金额</th>
            <th>应还金额</th>
            <th>状态</th>
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
            <td>¥ {{ plan.amount }}</td>
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
            <td v-if="canOperateOrders">
              <div class="plan-modal-actions">
                <button
                  class="btn"
                  :class="plan.paid ? 'btn-warning' : 'btn-success'"
                  type="button"
                  :disabled="!!deferDueSavingKey"
                  @click="toggleRepay(selectedOrder, plan)"
                >
                  {{ plan.paid ? '标记未还' : '标记已还' }}
                </button>
                <button
                  v-if="!plan.paid"
                  class="btn btn-warning"
                  type="button"
                  :disabled="!!deferDueSavingKey"
                  @click="deferRepaymentDue(selectedOrder, plan)"
                >
                  {{ deferDueSavingKey === `${selectedOrder.id}-${plan.period}` ? '处理中…' : '延期还款' }}
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

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

  <el-dialog
    v-model="addressDialogOpen"
    title="收货地址"
    width="440px"
    align-center
    destroy-on-close
    class="order-address-dialog"
    body-class="order-address-dialog__body"
    @closed="onAddressDialogClosed"
  >
    <template v-if="addressDialogOrder">
      <p class="order-address-dialog__meta">
        订单 {{ addressDialogOrder.id }} ｜ {{ addressDialogOrder.product }}
      </p>
      <dl class="order-address-dl">
        <dt>收货人</dt>
        <dd>{{ addressDialogOrder.user || '—' }}</dd>
        <dt>手机号</dt>
        <dd>{{ addressDialogOrder.receiverPhone?.trim() || '—' }}</dd>
        <dt>详细地址</dt>
        <dd>{{ addressDialogOrder.receiverAddress?.trim() || '（无）' }}</dd>
      </dl>
    </template>
    <template #footer>
      <el-button
        type="primary"
        @click="addressDialogOpen = false"
      >
        关闭
      </el-button>
    </template>
  </el-dialog>

  <UserRiskDetailDialog
    v-model="userRiskDialogVisible"
    :user-id="riskDialogUserId"
    @user-updated="onRiskDialogUserUpdated"
  />
</template>

<style scoped>
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

.table--plan-modal {
  margin-top: 8px;
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
  font-size: 13px;
  color: #374151;
  line-height: 1.45;
  word-break: break-word;
  overflow: hidden;
  display: block;
  width: 100%;
  max-height: 4.35em;
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

/* 卡包发放：冷色紫灰系，避免与订单「待发货」黄色气泡混淆 */
.td-card-package :deep(.el-tag--info),
.td-card-contract :deep(.el-tag--info) {
  --el-tag-bg-color: #f5f3ff;
  --el-tag-border-color: #c4b5fd;
  --el-tag-text-color: #5b21b6;
}

.td-card-package :deep(.el-tag--success),
.td-card-contract :deep(.el-tag--success) {
  --el-tag-bg-color: #ecfdf5;
  --el-tag-border-color: #6ee7b7;
  --el-tag-text-color: #047857;
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

.order-address-dialog__body .order-address-dialog__meta {
  margin: 0 0 12px;
  font-size: 13px;
  color: #64748b;
}

.order-address-dialog__body .order-address-dl {
  margin: 0;
  display: grid;
  grid-template-columns: 72px 1fr;
  gap: 8px 12px;
  font-size: 14px;
  line-height: 1.5;
}

.order-address-dialog__body .order-address-dl dt {
  margin: 0;
  color: #64748b;
  font-weight: 500;
}

.order-address-dialog__body .order-address-dl dd {
  margin: 0;
  color: #1f2937;
  word-break: break-word;
}
</style>
