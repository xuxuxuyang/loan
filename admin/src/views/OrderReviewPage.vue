<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { OrderItem } from '../stores/useOrdersStore'
import { getAdminSession } from '../composables/useAdminAuth'
import { useOrdersStore } from '../stores/useOrdersStore'
import { withAdminAuthHeaders } from '../composables/useAdminApi'
import UserRiskDetailDialog, { type UserItem } from '../components/UserRiskDetailDialog.vue'
import { donePageProgress, startPageProgress } from '../utils/progress'

const MALL_API_BASE = `${(import.meta.env.VITE_MALL_API_BASE || 'http://localhost:3110/api').replace(/\/$/, '')}`

const loading = ref(false)
const reviewingId = ref('')
const deletingOrderId = ref('')
const userRiskDialogVisible = ref(false)
const riskDialogUserId = ref<string | null>(null)
const resolvingRiskOrderId = ref<string | null>(null)
const riskFilter = ref<'全部' | OrderItem['riskStatus']>('全部')
const userFilter = ref('')
const { orders, fetchOrders, updateOrderStatus, deleteOrder } = useOrdersStore()

const canDeleteOrder = computed(() => getAdminSession()?.role === 'super_admin')

function normalizePhone(raw: string): string {
  return String(raw || '').replace(/\D/g, '')
}

watch(userRiskDialogVisible, (open) => {
  if (!open)
    riskDialogUserId.value = null
})

function isReviewPageOrder(item: OrderItem) {
  return item.status === '待审核' || item.status === '风控未通过'
}

const reviewOrdersBase = computed(() => orders.value.filter(isReviewPageOrder))

const reviewOrders = computed(() => {
  let list = reviewOrdersBase.value
  if (riskFilter.value !== '全部') {
    list = list.filter(item => item.riskStatus === riskFilter.value)
  }
  const kw = userFilter.value.trim().toLowerCase()
  if (kw) {
    list = list.filter(item => item.user.toLowerCase().includes(kw))
  }
  return list
})

async function loadReviewOrders() {
  loading.value = true
  startPageProgress()
  try {
    await fetchOrders({
      status: '待审核',
    })
  }
  finally {
    loading.value = false
    donePageProgress()
  }
}

async function approveOrder(order: OrderItem) {
  if (reviewingId.value) {
    return
  }
  if (order.riskStatus !== 'passed') {
    return
  }
  reviewingId.value = order.id
  try {
    await updateOrderStatus(order.id, 'shipping')
  }
  catch {
    ElMessage.error('审核通过失败，请稍后重试')
  }
  finally {
    reviewingId.value = ''
    await loadReviewOrders()
  }
}

async function handleDeleteOrder(order: OrderItem) {
  if (!canDeleteOrder.value || deletingOrderId.value) {
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
    if (userRiskDialogVisible.value) {
      userRiskDialogVisible.value = false
    }
    await loadReviewOrders()
  }
  catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '删除订单失败，请稍后重试')
  }
  finally {
    deletingOrderId.value = ''
  }
}

function onRiskDialogUserUpdated(_user: UserItem) {
  void fetchOrders({ status: '待审核' }).catch(() => {})
}

async function openRiskDetail(order: OrderItem) {
  const digits = normalizePhone(order.receiverPhone || '')
  if (digits.length !== 11) {
    ElMessage.error('订单无有效收货手机号，无法打开用户风控档案')
    return
  }
  if (resolvingRiskOrderId.value) {
    return
  }
  resolvingRiskOrderId.value = order.id
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
    resolvingRiskOrderId.value = null
  }
}

onMounted(() => {
  void loadReviewOrders()
})
</script>

<template>
  <div class="panel">
    <div class="toolbar review-toolbar">
      <el-select
        v-model="riskFilter"
        class="toolbar-select"
        placeholder="风控结果"
      >
        <el-option
          label="全部风控结果"
          value="全部"
        />
        <el-option
          label="风控通过"
          value="passed"
        />
        <el-option
          label="风控未通过"
          value="failed"
        />
      </el-select>
      <el-input
        v-model="userFilter"
        class="toolbar-input"
        placeholder="按用户筛选"
        clearable
      />
      <button
        class="btn btn-refresh"
        type="button"
        :disabled="loading"
        @click="loadReviewOrders"
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
          <th>风控结果</th>
          <th>当前期数</th>
          <th>下次还款日</th>
          <th>下单时间</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="item in reviewOrders"
          :key="item.id"
        >
          <td>{{ item.id }}</td>
          <td>{{ item.user }}</td>
          <td>{{ item.product }}</td>
          <td>¥ {{ item.totalAmount }}</td>
          <td class="td-credit-status">
            <el-tag
              :type="item.riskStatus === 'passed' ? 'success' : 'danger'"
              effect="light"
              round
              size="small"
              class="credit-status-tag"
              :disabled="resolvingRiskOrderId === item.id"
              @click="openRiskDetail(item)"
            >
              {{ item.riskStatus === 'passed' ? '风控通过' : '风控未通过' }}
            </el-tag>
          </td>
          <td>{{ item.currentPeriod }} / {{ item.periods }}</td>
          <td>{{ item.nextRepayDate }}</td>
          <td>{{ item.createdAt }}</td>
          <td>
            <div class="review-actions">
              <button
                :class="['btn', item.riskStatus === 'passed' ? 'btn-success' : 'btn-danger']"
                type="button"
                :disabled="reviewingId === item.id || item.riskStatus !== 'passed'"
                @click="approveOrder(item)"
              >
                {{
                  item.riskStatus !== 'passed'
                    ? '风控未通过'
                    : (reviewingId === item.id ? '审核中...' : '审核通过')
                }}
              </button>
              <button
                v-if="canDeleteOrder"
                class="btn btn-outline-danger"
                type="button"
                :disabled="deletingOrderId === item.id || reviewingId === item.id"
                @click="handleDeleteOrder(item)"
              >
                {{ deletingOrderId === item.id ? '删除中...' : '删除订单' }}
              </button>
            </div>
          </td>
        </tr>
        <tr v-if="!loading && reviewOrders.length === 0">
          <td
            colspan="9"
            style="text-align: center; color: #9ca3af;"
          >
            {{ reviewOrdersBase.length === 0 ? '暂无待审核订单' : '暂无符合筛选条件的订单' }}
          </td>
        </tr>
      </tbody>
    </table>

    <UserRiskDetailDialog
      v-model="userRiskDialogVisible"
      :user-id="riskDialogUserId"
      @user-updated="onRiskDialogUserUpdated"
    />
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
}

.btn-success {
  border-color: #059669;
  background: #059669;
  color: #fff;
}

.btn-danger {
  border-color: #dc2626;
  background: #dc2626;
  color: #fff;
}

.btn-outline-danger {
  border-color: #dc2626;
  background: #fff;
  color: #dc2626;
}

.btn-outline-danger:hover:not(:disabled) {
  background: #fef2f2;
}

.review-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.td-credit-status {
  vertical-align: middle;
}

.credit-status-tag {
  cursor: pointer;
  user-select: none;
  font-weight: 600;
  transition: filter 0.15s ease, transform 0.12s ease;
}

.credit-status-tag:hover {
  filter: brightness(0.96);
}

.credit-status-tag:active {
  transform: scale(0.98);
}

.review-toolbar {
  align-items: center;
}

.review-toolbar :deep(.el-input__wrapper) {
  min-height: 36px;
  height: 36px;
  box-sizing: border-box;
}

.review-toolbar :deep(.el-select) {
  vertical-align: middle;
}

.review-toolbar .btn {
  height: 36px;
  min-height: 36px;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 14px;
}

.toolbar-input {
  width: 200px;
  max-width: 100%;
}

.toolbar-select {
  width: 160px;
  max-width: 100%;
}
</style>
