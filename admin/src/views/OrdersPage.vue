<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { InstallmentItem, OrderItem } from '../stores/useOrdersStore'
import { getAdminSession } from '../composables/useAdminAuth'
import { useOrdersStore } from '../stores/useOrdersStore'
import { donePageProgress, startPageProgress } from '../utils/progress'

const keyword = ref('')
const status = ref<'全部' | OrderItem['status']>('全部')
const payType = ref<'全部' | OrderItem['payType']>('全部')
const orderDate = ref('')
const selectedOrder = ref<OrderItem | null>(null)
const loading = ref(false)
const changingStatusOrderId = ref('')
const trackingSavingId = ref('')
const cardPackageSavingId = ref('')
const deletingOrderId = ref('')
const trackingDialogOpen = ref(false)
const trackingDialogOrder = ref<OrderItem | null>(null)
const trackingDialogInput = ref('')
const { orders, recalculateOrderFields, fetchOrders, updateInstallmentPaid, updateOrderStatus, updateOrderShipment, updateOrderCardPackage, deleteOrder } = useOrdersStore()
const canOperateOrders = computed(() => getAdminSession()?.role === 'super_admin')

function showTrackingEditor(item: OrderItem): boolean {
  return item.status === '待发货' || item.status === '待收货'
}

const filteredOrders = computed(() => {
  // 订单管理仅展示已通过人工审核后的订单，待审核订单统一在“审核订单”页面处理。
  return orders.value.filter(item => item.status !== '待审核' && item.status !== '风控未通过')
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
  }
  catch (error) {
    period.paid = prevPaid
    recalculateOrderFields(order)
    ElMessage.error('更新分期状态失败，请稍后重试')
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

async function rollbackToReview(order: OrderItem) {
  if (!canOperateOrders.value) return
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
  cardPackageSavingId.value = order.id
  try {
    await updateOrderCardPackage(order.id, next)
    ElMessage.success('卡包发放状态已更新')
  }
  catch {
    ElMessage.error('更新卡包状态失败，请稍后重试')
  }
  finally {
    cardPackageSavingId.value = ''
  }
}

async function loadOrders() {
  loading.value = true
  startPageProgress()
  try {
    await fetchOrders({
      keyword: keyword.value.trim(),
      status: status.value,
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
  void loadOrders()
})
</script>

<template>
  <div class="panel">
    <div class="toolbar">
      <el-input
        v-model="keyword"
        class="toolbar-input"
        placeholder="搜索订单号 / 用户 / 商品"
        clearable
      />
      <el-select
        v-model="status"
        class="toolbar-select"
      >
        <el-option label="全部状态" value="全部" />
        <el-option label="待发货" value="待发货" />
        <el-option label="待收货" value="待收货" />
        <el-option label="已完成" value="已完成" />
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

    <table class="table">
      <thead>
        <tr>
          <th>订单号</th>
          <th>用户</th>
          <th>商品</th>
          <th>总金额</th>
          <th>分期期数</th>
          <th>每期应还</th>
          <th>当前期数</th>
          <th>下次还款日</th>
          <th>支付方式</th>
          <th>下单时间</th>
          <th>订单状态</th>
          <th>快递单号</th>
          <th>卡包发放</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="item in filteredOrders"
          :key="item.id"
        >
          <td>{{ item.id }}</td>
          <td>{{ item.user }}</td>
          <td>{{ item.product }}</td>
          <td>¥ {{ item.totalAmount }}</td>
          <td>{{ item.periods }} 期</td>
          <td>¥ {{ item.periodAmount }}</td>
          <td>{{ item.currentPeriod }} / {{ item.periods }}</td>
          <td>{{ item.nextRepayDate }}</td>
          <td>{{ item.payType }}</td>
          <td>{{ item.createdAt }}</td>
          <td class="td-order-status">
            <el-tag
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
                      command="issued"
                      :disabled="item.cardPackageIssued"
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
          <td class="actions-cell">
            <div class="actions">
              <button
                class="btn btn-primary"
                type="button"
                @click="openPlan(item)"
              >
                查看分期
              </button>
              <button
                v-if="canOperateOrders"
                class="btn btn-warning"
                type="button"
                :disabled="changingStatusOrderId === item.id || item.status === '待审核'"
                @click="rollbackToReview(item)"
              >
                {{ changingStatusOrderId === item.id ? '处理中...' : '打回审核' }}
              </button>
              <button
                v-if="canOperateOrders"
                class="btn btn-danger"
                type="button"
                :disabled="deletingOrderId === item.id"
                @click="handleDeleteOrder(item)"
              >
                {{ deletingOrderId === item.id ? '删除中...' : '删除' }}
              </button>
            </div>
          </td>
        </tr>
        <tr v-if="!loading && filteredOrders.length === 0">
          <td colspan="14" style="text-align: center; color: #9ca3af;">
            暂无订单数据
          </td>
        </tr>
      </tbody>
    </table>
  </div>

  <div
    v-if="selectedOrder"
    class="modal-mask"
    @click.self="closePlan"
  >
    <div class="modal-panel">
      <div class="modal-header">
        <h3>分期计划 - {{ selectedOrder.id }}</h3>
        <button
          class="btn"
          type="button"
          @click="closePlan"
        >
          关闭
        </button>
      </div>
      <p class="modal-summary">
        用户：{{ selectedOrder.user }} ｜ 商品：{{ selectedOrder.product }} ｜ 总金额：¥ {{ selectedOrder.totalAmount }}
      </p>

      <table class="table">
        <thead>
          <tr>
            <th>期数</th>
            <th>还款日</th>
            <th>本金</th>
            <th>手续费</th>
            <th>应还金额</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="plan in selectedOrder.installmentPlan"
            :key="plan.period"
          >
            <td>第 {{ plan.period }} 期</td>
            <td>{{ plan.dueDate }}</td>
            <td>¥ {{ plan.principal }}</td>
            <td>¥ {{ plan.fee }}</td>
            <td>¥ {{ plan.amount }}</td>
            <td>{{ plan.paid ? '已还款' : '待还款' }}</td>
            <td>
              <button
                v-if="canOperateOrders"
                class="btn"
                :class="plan.paid ? 'btn-warning' : 'btn-success'"
                type="button"
                @click="toggleRepay(selectedOrder, plan)"
              >
                {{ plan.paid ? '标记未还' : '标记已还' }}
              </button>
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
</template>

<style scoped>
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

.td-card-package {
  vertical-align: middle;
}

/* 卡包发放：冷色紫灰系，避免与订单「待发货」黄色气泡混淆 */
.td-card-package :deep(.el-tag--info) {
  --el-tag-bg-color: #f5f3ff;
  --el-tag-border-color: #c4b5fd;
  --el-tag-text-color: #5b21b6;
}

.td-card-package :deep(.el-tag--success) {
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
  overflow-x: auto;
}

.actions-cell::-webkit-scrollbar {
  height: 6px;
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
.tracking-shipment-dialog__body .tracking-dialog-meta {
  margin: 0 0 12px;
  font-size: 13px;
  color: #64748b;
}
</style>
