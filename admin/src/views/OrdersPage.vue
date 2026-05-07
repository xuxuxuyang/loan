<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
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
const statusDraftMap = ref<Record<string, OrderItem['status']>>({})
const { orders, recalculateOrderFields, fetchOrders, updateInstallmentPaid, updateOrderStatus } = useOrdersStore()
const canOperateOrders = computed(() => getAdminSession()?.role === 'super_admin')

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

function toMallOrderStatus(value: OrderItem['status']) {
  if (value === '待收货') return 'receiving'
  if (value === '已完成') return 'enjoying'
  if (value === '待发货') return 'shipping'
  return 'reviewing'
}

function getRowStatusDraft(order: OrderItem) {
  return statusDraftMap.value[order.id] || order.status
}

async function applyOrderStatus(order: OrderItem) {
  if (!canOperateOrders.value) return
  if (changingStatusOrderId.value) {
    return
  }
  const nextStatus = getRowStatusDraft(order)
  if (nextStatus === order.status) {
    return
  }

  changingStatusOrderId.value = order.id
  try {
    await updateOrderStatus(order.id, toMallOrderStatus(nextStatus))
    await loadOrders()
  }
  catch (error) {
    ElMessage.error('更新订单状态失败，请稍后重试')
  }
  finally {
    changingStatusOrderId.value = ''
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
    statusDraftMap.value = Object.fromEntries(
      orders.value.map(item => [item.id, item.status]),
    )
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
          <th>状态</th>
          <th>支付方式</th>
          <th>下单时间</th>
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
          <td>{{ item.status }}</td>
          <td>{{ item.payType }}</td>
          <td>{{ item.createdAt }}</td>
          <td class="actions-cell">
            <div class="actions">
              <el-select
                v-if="canOperateOrders"
                v-model="statusDraftMap[item.id]"
                class="status-select"
              >
                <el-option label="待审核" value="待审核" />
                <el-option label="待发货" value="待发货" />
                <el-option label="待收货" value="待收货" />
                <el-option label="已完成" value="已完成" />
              </el-select>
              <button
                v-if="canOperateOrders"
                class="btn btn-success"
                type="button"
                :disabled="changingStatusOrderId === item.id"
                @click="applyOrderStatus(item)"
              >
                {{ changingStatusOrderId === item.id ? '更新中...' : '更新状态' }}
              </button>
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
            </div>
          </td>
        </tr>
        <tr v-if="!loading && filteredOrders.length === 0">
          <td colspan="12" style="text-align: center; color: #9ca3af;">
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

.toolbar-input {
  width: 260px;
}

.toolbar-select,
.toolbar-date {
  width: 160px;
}

.status-select {
  width: 120px;
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
