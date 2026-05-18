<script setup lang="ts">
import { CircleCheck, Postcard, WarningFilled } from '@element-plus/icons-vue'
import { ElIcon, ElMessage, ElMessageBox } from 'element-plus'
import { type VNode, computed, h, onMounted, ref, watch } from 'vue'
import type { OrderItem } from '../stores/useOrdersStore'
import { getAdminSession, isSuperAdminRole } from '../composables/useAdminAuth'
import { useOrdersStore } from '../stores/useOrdersStore'
import { withMallTenantHeaders } from '../composables/useAdminApi'
import UserRiskDetailDialog, { type UserItem } from '../components/UserRiskDetailDialog.vue'
import { refreshOrdersMenuPendingReview } from '../composables/useAdminOrderReviewBadge'
import { donePageProgress, startPageProgress } from '../utils/progress'
import {
  mergeApiRiskViewToOrderSevenSnapshot,
  orderRiskDataReadyForAdminApprove,
  type AdminUserRiskViewPayload,
} from '../utils/userRiskApproveReadiness'

const MALL_API_BASE = `${(import.meta.env.VITE_MALL_API_BASE || 'http://localhost:3110/api').replace(/\/$/, '')}`

const loading = ref(false)
const reviewingId = ref('')
const rejectingId = ref('')
const deletingOrderId = ref('')
const userRiskDialogVisible = ref(false)
const riskDialogUserId = ref<string | null>(null)
/** 从「风控结果」列打开时为 true：弹窗仅展示下单七项 + 雷达；从「用户」列打开为 false：含基本信息 */
const riskDetailHideBasicInfoTab = ref(false)
const resolvingRiskOrderId = ref<string | null>(null)
const riskFilter = ref<'全部' | OrderItem['riskStatus']>('全部')
const userFilter = ref('')
const { orders, fetchOrders, updateOrderStatus, rejectOrderReview, deleteOrder } = useOrdersStore()

/** 列表预拉：档案内下单七项 + 雷达是否齐全（仅用于弹窗内第二条提示，不拦截审核） */
type RiskApproveGateState = 'idle' | 'loading' | 'ok' | 'blocked'
const riskApproveGateByOrderId = ref<Record<string, RiskApproveGateState>>({})

const canDeleteOrder = computed(() => isSuperAdminRole(getAdminSession()?.role))

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

/** 列表随 fetchOrders/PATCH/DELTE 变更时，按审核队列签名补跑风控档案闸门（避免新单无闸门状态） */
const reviewQueueSig = computed(() =>
  reviewOrdersBase.value
    .map(o => `${o.id}:${o.riskStatus}`)
    .sort()
    .join('|'),
)

watch(reviewQueueSig, () => {
  void runRiskApproveGateChecks(orders.value.filter(isReviewPageOrder))
})

const reviewOrders = computed(() => {
  let list = reviewOrdersBase.value
  if (riskFilter.value !== '全部') {
    list = list.filter(item => item.riskStatus === riskFilter.value)
  }
  const kw = userFilter.value.trim().toLowerCase()
  if (kw) {
    list = list.filter((item) => {
      const hay = [
        item.user,
        item.buyerPhone,
        item.id,
      ].join(' ').toLowerCase()
      return hay.includes(kw)
    })
  }
  return list
})

function riskApproveGateForOrder(order: OrderItem): RiskApproveGateState {
  if (order.riskStatus !== 'passed') {
    return 'ok'
  }
  return riskApproveGateByOrderId.value[order.id] ?? 'idle'
}

async function fetchAdminUserRiskViewForOrder(order: OrderItem): Promise<AdminUserRiskViewPayload | null> {
  const headers = withMallTenantHeaders()
  try {
    let id = String(order.mallUserId || '').trim()
    if (!id) {
      const digits = normalizePhone(order.buyerPhone || '')
      if (digits.length !== 11) {
        return null
      }
      const r1 = await fetch(`${MALL_API_BASE}/users/by-phone?phone=${encodeURIComponent(digits)}`, {
        method: 'GET',
        headers,
      })
      if (!r1.ok) {
        return null
      }
      const p1 = await r1.json() as { data?: { id?: string } | null }
      id = p1.data && typeof p1.data.id === 'string' ? p1.data.id.trim() : ''
    }
    if (!id) {
      return null
    }
    const r2 = await fetch(`${MALL_API_BASE}/users/${encodeURIComponent(id)}`, {
      method: 'GET',
      headers,
    })
    if (!r2.ok) {
      return null
    }
    const p2 = await r2.json() as { data?: { riskView?: AdminUserRiskViewPayload } }
    return p2.data?.riskView ?? null
  }
  catch {
    return null
  }
}

async function computeRiskGateForOrder(order: OrderItem): Promise<'ok' | 'blocked'> {
  try {
    const rv = await fetchAdminUserRiskViewForOrder(order)
    if (!rv) {
      return 'blocked'
    }
    const snap = mergeApiRiskViewToOrderSevenSnapshot(rv)
    return orderRiskDataReadyForAdminApprove(snap) ? 'ok' : 'blocked'
  }
  catch {
    return 'blocked'
  }
}

/** 点击「审核通过」前若尚未拉取风控档案，可即时补拉一条 */
async function refreshRiskGateForSingleOrder(order: OrderItem) {
  if (order.riskStatus !== 'passed' || !isReviewPageOrder(order)) {
    return
  }
  riskApproveGateByOrderId.value = { ...riskApproveGateByOrderId.value, [order.id]: 'loading' }
  const r = await computeRiskGateForOrder(order)
  riskApproveGateByOrderId.value = { ...riskApproveGateByOrderId.value, [order.id]: r }
}

async function runRiskApproveGateChecks(list: OrderItem[]) {
  const targets = list.filter(o => o.riskStatus === 'passed' && isReviewPageOrder(o))
  const next = { ...riskApproveGateByOrderId.value }
  for (const o of targets) {
    next[o.id] = 'loading'
  }
  riskApproveGateByOrderId.value = next

  await Promise.all(
    targets.map(async (o) => {
      const r = await computeRiskGateForOrder(o)
      riskApproveGateByOrderId.value = { ...riskApproveGateByOrderId.value, [o.id]: r }
    }),
  )
}

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
    void refreshOrdersMenuPendingReview()
  }
}

function buildApproveOrderConfirmContent(riskArchiveOk: boolean): VNode {
  const idLine = '是否已检查用户上传的身份证照片信息和本人一致？'
  const badgeStyles = riskArchiveOk
    ? 'display:inline-block;padding:2px 8px;border-radius:4px;background:#ecfdf5;color:#059669;font-weight:700;font-size:12px;'
    : 'display:inline-block;padding:2px 8px;border-radius:4px;background:#fef2f2;color:#dc2626;font-weight:700;font-size:12px;'
  const badgeText = riskArchiveOk ? '已齐备' : '未齐备'
  const riskBody = riskArchiveOk
    ? '【风控档案】下单七项与全景雷达有历史记录，是否手动查询更新过最新雷达数据？'
    : '【风控档案】下单七项或全景雷达数据尚不完整，或未查询到风控信息，建议先在「用户」或「风控结果」中打开档案完成查询后再审核。您仍可点击下方「已检查审核通过」继续。'
  const riskTextColor = riskArchiveOk ? '#047857' : '#b45309'

  const idIcon = h(
    ElIcon,
    { size: 22, color: '#409eff', style: { flexShrink: 0, marginTop: '2px' } },
    () => h(Postcard),
  )
  const riskIcon = h(
    ElIcon,
    {
      size: 22,
      color: riskArchiveOk ? '#67c23a' : '#f56c6c',
      style: { flexShrink: 0, marginTop: '2px' },
    },
    () => h(riskArchiveOk ? CircleCheck : WarningFilled),
  )

  return h(
    'div',
    { class: 'order-review-approve-confirm', style: { display: 'flex', flexDirection: 'column', gap: '16px' } },
    [
      h(
        'div',
        {
          class: 'order-review-approve-confirm__row',
          style: { display: 'flex', gap: '12px', alignItems: 'flex-start' },
        },
        [
          idIcon,
          h(
            'div',
            {
              style: {
                flex: 1,
                minWidth: 0,
                lineHeight: '1.6',
                fontSize: '15px',
                color: '#303133',
                fontWeight: 500,
              },
            },
            idLine,
          ),
        ],
      ),
      h('div', {
        style: {
          height: 1,
          background: '#ebeef5',
          margin: '0 2px',
        },
      }),
      h(
        'div',
        {
          class: 'order-review-approve-confirm__row',
          style: { display: 'flex', gap: '12px', alignItems: 'flex-start' },
        },
        [
          riskIcon,
          h('div', { style: { flex: 1, minWidth: 0 } }, [
            h('div', { style: { marginBottom: '8px' } }, [
              h('span', { style: badgeStyles }, badgeText),
            ]),
            h(
              'div',
              {
                style: {
                  lineHeight: '1.6',
                  fontSize: '13px',
                  color: riskTextColor,
                },
              },
              riskBody,
            ),
          ]),
        ],
      ),
    ],
  )
}

async function approveOrder(order: OrderItem) {
  if (reviewingId.value || rejectingId.value) {
    return
  }
  if (order.riskStatus !== 'passed') {
    return
  }
  await refreshRiskGateForSingleOrder(order)
  const riskArchiveOk = riskApproveGateForOrder(order) === 'ok'
  try {
    await ElMessageBox.confirm(
      buildApproveOrderConfirmContent(riskArchiveOk),
      '审核通过前请确认',
      {
        confirmButtonText: '已检查审核通过',
        cancelButtonText: '取消',
        customClass: 'order-review-approve-msgbox',
      },
    )
  }
  catch {
    return
  }
  reviewingId.value = order.id
  try {
    await updateOrderStatus(order.id, 'shipping')
    ElMessage.success('审核通过')
    void refreshOrdersMenuPendingReview()
  }
  catch {
    ElMessage.error('审核通过失败，请稍后重试')
  }
  finally {
    reviewingId.value = ''
  }
}

async function rejectOrder(order: OrderItem) {
  if (reviewingId.value || rejectingId.value) {
    return
  }
  if (order.payType !== '先享后付' || order.riskStatus !== 'passed') {
    return
  }
  try {
    await ElMessageBox.confirm(
      `确定将订单 ${order.id} 标记为审核不通过？提交后该单将视为风控未通过，无法再次审核。`,
      '审核不通过',
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
  rejectingId.value = order.id
  try {
    await rejectOrderReview(order.id)
    ElMessage.success('已标记审核不通过')
    void refreshOrdersMenuPendingReview()
  }
  catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '审核不通过失败，请稍后重试')
  }
  finally {
    rejectingId.value = ''
  }
}

async function handleDeleteOrder(order: OrderItem) {
  if (!canDeleteOrder.value || deletingOrderId.value || reviewingId.value || rejectingId.value) {
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
    void refreshOrdersMenuPendingReview()
  }
  catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '删除订单失败，请稍后重试')
  }
  finally {
    deletingOrderId.value = ''
  }
}

function onRiskDialogUserUpdated(_user: UserItem) {
  void refreshOrdersMenuPendingReview()
  void runRiskApproveGateChecks(orders.value.filter(isReviewPageOrder))
}

async function openRiskDetail(order: OrderItem, entry: 'user' | 'risk') {
  if (resolvingRiskOrderId.value) {
    return
  }
  riskDetailHideBasicInfoTab.value = entry === 'risk'
  resolvingRiskOrderId.value = order.id
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
      userRiskDialogVisible.value = true
      return
    }
    const digits = normalizePhone(order.buyerPhone || '')
    if (digits.length !== 11) {
      ElMessage.error('订单缺少注册用户信息（mallUserId / buyerPhone），无法打开风控档案')
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
          <th>备注</th>
          <th>商品</th>
          <th>下单时间</th>
          <th>总金额</th>
          <th>风控结果</th>
          <th>还款到期日</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="item in reviewOrders"
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
              :disabled="resolvingRiskOrderId === item.id"
              @click="openRiskDetail(item, 'user')"
            >
              {{ item.user }}
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
          <td>{{ item.product }}</td>
          <td>{{ item.createdAt }}</td>
          <td>¥ {{ item.totalAmount }}</td>
          <td class="td-credit-status">
            <el-tag
              :type="item.riskStatus === 'passed' ? 'success' : 'danger'"
              effect="light"
              round
              size="small"
              class="credit-status-tag"
              :disabled="resolvingRiskOrderId === item.id"
              @click="openRiskDetail(item, 'risk')"
            >
              {{ item.riskStatus === 'passed' ? '风控通过' : '风控未通过' }}
            </el-tag>
          </td>
          <td>{{ item.nextRepayDate }}</td>
          
          <td>
            <div class="review-actions">
              <button
                :class="['btn', item.riskStatus === 'passed' ? 'btn-success' : 'btn-danger']"
                type="button"
                :disabled="reviewingId === item.id || rejectingId === item.id || item.riskStatus !== 'passed'"
                @click="approveOrder(item)"
              >
                {{
                  item.riskStatus !== 'passed'
                    ? '风控未通过'
                    : (reviewingId === item.id ? '审核中...' : '审核通过')
                }}
              </button>
              <button
                v-if="item.payType === '先享后付' && item.riskStatus === 'passed'"
                class="btn btn-danger"
                type="button"
                :disabled="reviewingId === item.id || rejectingId === item.id || deletingOrderId === item.id"
                @click="rejectOrder(item)"
              >
                {{ rejectingId === item.id ? '提交中...' : '审核不通过' }}
              </button>
              <button
                v-if="canDeleteOrder"
                class="btn btn-outline-danger"
                type="button"
                :disabled="deletingOrderId === item.id || reviewingId === item.id || rejectingId === item.id"
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
      :hide-basic-info-tab="riskDetailHideBasicInfoTab"
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
</style>

<!-- MessageBox 挂载到 body，需非 scoped；隐藏全局状态图标，改由内容区各行自带图标 -->
<style>
.order-review-approve-msgbox .el-message-box__status {
  display: none !important;
}

.order-review-approve-msgbox .el-message-box__message {
  padding-left: 0 !important;
}

.order-review-approve-msgbox .el-message-box__container {
  align-items: flex-start;
}
</style>
