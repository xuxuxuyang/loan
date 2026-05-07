<script setup lang="ts">
import { CircleCheck, CircleClose, Clock, Cpu, DataAnalysis, Document, User } from '@element-plus/icons-vue'
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { OrderItem, OrderRiskDetail } from '../stores/useOrdersStore'
import { getAdminSession } from '../composables/useAdminAuth'
import { useOrdersStore } from '../stores/useOrdersStore'
import { donePageProgress, startPageProgress } from '../utils/progress'

function splitFactorLine(line: string): { label: string, value: string } {
  const cn = line.indexOf('：')
  const en = line.indexOf(':')
  let idx = -1
  if (cn >= 0 && en >= 0) {
    idx = Math.min(cn, en)
  }
  else {
    idx = cn >= 0 ? cn : en
  }
  if (idx === -1) {
    return { label: line, value: '' }
  }
  return {
    label: line.slice(0, idx).trim(),
    value: line.slice(idx + 1).trim(),
  }
}

function decisionTagType(decision: string): 'success' | 'danger' | 'warning' | 'info' {
  if (/拒绝|未通过|失败|驳回/i.test(decision)) {
    return 'danger'
  }
  if (/通过|同意|放行|批准/i.test(decision)) {
    return 'success'
  }
  return 'info'
}

function scoreProgressPercent(detail: OrderRiskDetail): number {
  const t = detail.threshold || 1
  return Math.min(100, Math.round((detail.riskScore / t) * 100))
}

function scoreOverThreshold(detail: OrderRiskDetail): boolean {
  return detail.riskScore >= detail.threshold
}

const loading = ref(false)
const reviewingId = ref('')
const deletingOrderId = ref('')
const riskDialogVisible = ref(false)
const riskDetailLoading = ref(false)
const riskDetailError = ref('')
const selectedOrder = ref<OrderItem | null>(null)
const selectedRiskDetail = ref<OrderRiskDetail | null>(null)
const riskFilter = ref<'全部' | OrderItem['riskStatus']>('全部')
const userFilter = ref('')
const { orders, fetchOrders, updateOrderStatus, fetchOrderRiskDetail, deleteOrder } = useOrdersStore()

const canDeleteOrder = computed(() => getAdminSession()?.role === 'super_admin')

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
    if (riskDialogVisible.value && selectedOrder.value?.id === order.id) {
      riskDialogVisible.value = false
      onRiskDialogClosed()
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

function onRiskDialogClosed() {
  selectedOrder.value = null
  selectedRiskDetail.value = null
  riskDetailError.value = ''
}

async function openRiskDetail(order: OrderItem) {
  if (riskDetailLoading.value) {
    return
  }
  selectedOrder.value = order
  selectedRiskDetail.value = null
  riskDetailError.value = ''
  riskDialogVisible.value = true
  riskDetailLoading.value = true
  try {
    selectedRiskDetail.value = await fetchOrderRiskDetail(order.id)
  }
  catch (error) {
    riskDetailError.value = error instanceof Error ? error.message : '获取风控详情失败，请稍后重试'
  }
  finally {
    riskDetailLoading.value = false
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
          <th>支付方式</th>
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
          <td>{{ item.payType }}</td>
          <td class="td-risk-result">
            <el-tag
              :type="item.riskStatus === 'passed' ? 'success' : 'danger'"
              effect="light"
              round
              size="small"
              class="risk-result-tag"
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
            colspan="10"
            style="text-align: center; color: #9ca3af;"
          >
            {{ reviewOrdersBase.length === 0 ? '暂无待审核订单' : '暂无符合筛选条件的订单' }}
          </td>
        </tr>
      </tbody>
    </table>

    <el-dialog
      v-model="riskDialogVisible"
      width="640px"
      append-to-body
      align-center
      class="risk-detail-dialog"
      destroy-on-close
      @closed="onRiskDialogClosed"
    >
      <template #header>
        <div class="risk-detail-dialog__title">
          <span class="risk-detail-dialog__title-icon">
            <el-icon><DataAnalysis /></el-icon>
          </span>
          <span class="risk-detail-dialog__title-text">风控详情</span>
        </div>
      </template>

      <div
        v-if="riskDetailLoading"
        class="risk-detail-state risk-detail-state--muted"
      >
        <el-icon class="risk-detail-state__spin is-loading">
          <DataAnalysis />
        </el-icon>
        <span>风控数据加载中…</span>
      </div>
      <div
        v-else-if="riskDetailError"
        class="risk-detail-state risk-detail-state--error"
      >
        {{ riskDetailError }}
      </div>
      <div
        v-else-if="selectedRiskDetail"
        class="risk-detail-body"
      >
        <div class="risk-hero">
          <div class="risk-hero__main">
            <span class="risk-hero__label">决策结果</span>
            <el-tag
              :type="decisionTagType(selectedRiskDetail.decision)"
              effect="dark"
              round
              size="large"
            >
              {{ selectedRiskDetail.decision }}
            </el-tag>
            <el-tag
              v-if="selectedRiskDetail.riskStatus === 'passed'"
              class="risk-hero__status"
              type="success"
              effect="plain"
              round
            >
              风控通过
            </el-tag>
            <el-tag
              v-else
              class="risk-hero__status"
              type="danger"
              effect="plain"
              round
            >
              风控未通过
            </el-tag>
          </div>
          <div class="risk-score-panel">
            <div class="risk-score-panel__head">
              <span class="risk-score-panel__label">评分相对阈值</span>
              <span
                class="risk-score-panel__nums"
                :class="{ 'risk-score-panel__nums--over': scoreOverThreshold(selectedRiskDetail) }"
              >
                {{ selectedRiskDetail.riskScore }}
                <span class="risk-score-panel__sep">/</span>
                {{ selectedRiskDetail.threshold }}
              </span>
            </div>
            <el-progress
              :percentage="scoreProgressPercent(selectedRiskDetail)"
              :status="scoreOverThreshold(selectedRiskDetail) ? 'exception' : 'success'"
              :stroke-width="10"
              striped
            />
            <p class="risk-score-panel__hint">
              {{
                scoreOverThreshold(selectedRiskDetail)
                  ? '已超过阈值，订单将被风控拦截'
                  : '当前评分尚未超过阈值'
              }}
            </p>
          </div>
        </div>

        <el-descriptions
          :column="2"
          border
          size="small"
          class="risk-desc-table"
        >
          <el-descriptions-item>
            <template #label>
              <span class="risk-desc-label"><el-icon><Document /></el-icon>订单号</span>
            </template>
            {{ selectedRiskDetail.orderId }}
          </el-descriptions-item>
          <el-descriptions-item>
            <template #label>
              <span class="risk-desc-label"><el-icon><User /></el-icon>用户</span>
            </template>
            {{ selectedOrder?.user || '—' }}
          </el-descriptions-item>
          <el-descriptions-item>
            <template #label>
              <span class="risk-desc-label"><el-icon><Cpu /></el-icon>模型版本</span>
            </template>
            {{ selectedRiskDetail.modelVersion }}
          </el-descriptions-item>
          <el-descriptions-item>
            <template #label>
              <span class="risk-desc-label"><el-icon><Clock /></el-icon>检查时间</span>
            </template>
            {{ selectedRiskDetail.checkedAt }}
          </el-descriptions-item>
        </el-descriptions>

        <el-alert
          v-if="selectedRiskDetail.reason"
          class="risk-reason-alert"
          type="error"
          :closable="false"
          show-icon
        >
          <template #title>
            风控说明
          </template>
          {{ selectedRiskDetail.reason }}
        </el-alert>

        <section class="risk-block">
          <h4 class="risk-block__title">
            <span class="risk-block__title-bar" />
            风险因子
          </h4>
          <div class="risk-factor-grid">
            <div
              v-for="(factor, idx) in selectedRiskDetail.factors"
              :key="`${selectedRiskDetail.orderId}-${idx}`"
              class="risk-factor-cell"
            >
              <span class="risk-factor-cell__label">{{ splitFactorLine(factor).label }}</span>
              <span class="risk-factor-cell__value">{{ splitFactorLine(factor).value || factor }}</span>
            </div>
          </div>
        </section>

        <section class="risk-block">
          <h4 class="risk-block__title">
            <span class="risk-block__title-bar" />
            规则命中
          </h4>
          <div class="risk-rules-grid">
            <div
              v-for="rule in selectedRiskDetail.rules"
              :key="rule.code"
              class="risk-rule-card"
              :data-hit="rule.hit ? '1' : '0'"
            >
              <div class="risk-rule-card__top">
                <span class="risk-rule-card__icon">
                  <el-icon v-if="rule.hit">
                    <CircleClose />
                  </el-icon>
                  <el-icon v-else>
                    <CircleCheck />
                  </el-icon>
                </span>
                <div class="risk-rule-card__titles">
                  <div class="risk-rule-card__name">
                    {{ rule.name }}
                    <span class="risk-rule-card__code">{{ rule.code }}</span>
                  </div>
                </div>
                <el-tag
                  :type="rule.hit ? 'danger' : 'success'"
                  effect="plain"
                  round
                  size="small"
                >
                  {{ rule.hit ? `命中 +${rule.scoreImpact}` : '未命中' }}
                </el-tag>
              </div>
              <p class="risk-rule-card__detail">
                {{ rule.detail }}
              </p>
            </div>
          </div>
        </section>
      </div>
    </el-dialog>
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

.td-risk-result {
  vertical-align: middle;
}

.risk-result-tag {
  cursor: pointer;
  user-select: none;
  font-weight: 600;
  transition: filter 0.15s ease, transform 0.12s ease;
}

.risk-result-tag:hover {
  filter: brightness(0.96);
}

.risk-result-tag:active {
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

.review-tip-input {
  flex: 1 1 280px;
  min-width: 200px;
  max-width: 100%;
}

.toolbar-input {
  width: 200px;
  max-width: 100%;
}

.toolbar-select {
  width: 160px;
  max-width: 100%;
}

.risk-detail-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.risk-detail-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 36px 16px;
  font-size: 14px;
}

.risk-detail-state--muted {
  color: #64748b;
}

.risk-detail-state--error {
  color: #b91c1c;
  font-weight: 500;
}

.risk-detail-state__spin {
  font-size: 22px;
}

.risk-hero {
  display: grid;
  gap: 14px;
  padding: 14px 16px;
  border-radius: 12px;
  background: linear-gradient(135deg, #f8fafc 0%, #eef2ff 48%, #faf5ff 100%);
  border: 1px solid rgba(99, 102, 241, 0.18);
}

.risk-hero__main {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 12px;
}

.risk-hero__label {
  font-size: 13px;
  color: #64748b;
  font-weight: 500;
}

.risk-hero__status {
  margin-left: 4px;
}

.risk-score-panel {
  padding-top: 4px;
}

.risk-score-panel__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.risk-score-panel__label {
  font-size: 13px;
  color: #475569;
  font-weight: 500;
}

.risk-score-panel__nums {
  font-family: ui-monospace, 'Cascadia Mono', 'Segoe UI Mono', monospace;
  font-size: 15px;
  font-weight: 700;
  color: #0f766e;
}

.risk-score-panel__nums--over {
  color: #b91c1c;
}

.risk-score-panel__sep {
  font-weight: 600;
  opacity: 0.55;
  margin: 0 2px;
}

.risk-score-panel__hint {
  margin: 8px 0 0;
  font-size: 12px;
  color: #64748b;
  line-height: 1.45;
}

.risk-desc-table {
  border-radius: 10px;
  overflow: hidden;
}

.risk-desc-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.risk-desc-label .el-icon {
  font-size: 14px;
  color: #64748b;
}

.risk-reason-alert {
  border-radius: 10px;
}

.risk-block__title {
  margin: 0 0 10px;
  font-size: 14px;
  font-weight: 700;
  color: #1e293b;
  display: flex;
  align-items: center;
  gap: 8px;
}

.risk-block__title-bar {
  width: 4px;
  height: 14px;
  border-radius: 2px;
  background: linear-gradient(180deg, #6366f1, #8b5cf6);
}

.risk-factor-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

@media (max-width: 520px) {
  .risk-factor-grid {
    grid-template-columns: 1fr;
  }
}

.risk-factor-cell {
  padding: 10px 12px;
  border-radius: 10px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.risk-factor-cell__label {
  font-size: 12px;
  color: #64748b;
  font-weight: 500;
}

.risk-factor-cell__value {
  font-size: 14px;
  color: #0f172a;
  font-weight: 600;
}

.risk-rules-grid {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.risk-rule-card {
  border-radius: 12px;
  padding: 12px 14px;
  background: #fff;
  border: 1px solid #e2e8f0;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
  border-left: 4px solid #94a3b8;
  transition: box-shadow 0.15s ease;
}

.risk-rule-card[data-hit='1'] {
  border-left-color: #ef4444;
  background: linear-gradient(90deg, rgba(254, 226, 226, 0.35) 0%, #fff 28%);
}

.risk-rule-card[data-hit='0'] {
  border-left-color: #10b981;
  background: linear-gradient(90deg, rgba(209, 250, 229, 0.35) 0%, #fff 28%);
}

.risk-rule-card:hover {
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.07);
}

.risk-rule-card__top {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.risk-rule-card__icon {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
}

.risk-rule-card[data-hit='1'] .risk-rule-card__icon {
  background: rgba(239, 68, 68, 0.12);
  color: #dc2626;
}

.risk-rule-card[data-hit='0'] .risk-rule-card__icon {
  background: rgba(16, 185, 129, 0.12);
  color: #059669;
}

.risk-rule-card__titles {
  flex: 1;
  min-width: 0;
}

.risk-rule-card__name {
  font-size: 14px;
  font-weight: 700;
  color: #1e293b;
  line-height: 1.35;
}

.risk-rule-card__code {
  margin-left: 8px;
  font-size: 12px;
  font-weight: 600;
  color: #64748b;
  font-family: ui-monospace, monospace;
}

.risk-rule-card__detail {
  margin: 10px 0 0 42px;
  font-size: 13px;
  color: #475569;
  line-height: 1.5;
}
</style>

<style>
/* append-to-body 对话框需全局类名样式 */
.risk-detail-dialog.el-dialog {
  border-radius: 14px;
  overflow: hidden;
}

.risk-detail-dialog .el-dialog__header {
  padding: 16px 20px 14px;
  margin-right: 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.risk-detail-dialog .el-dialog__body {
  padding: 18px 20px 22px;
  max-height: min(72vh, 720px);
  overflow-y: auto;
}

.risk-detail-dialog__title {
  display: flex;
  align-items: center;
  gap: 10px;
}

.risk-detail-dialog__title-icon {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: #fff;
  font-size: 18px;
}

.risk-detail-dialog__title-text {
  font-size: 17px;
  font-weight: 700;
  color: #1e293b;
  letter-spacing: 0.02em;
}
</style>
