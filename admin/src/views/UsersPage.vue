<script setup lang="ts">
import { CircleCheck, CircleClose, Clock, Cpu, DataAnalysis, Document, Picture, User } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { withAdminAuthHeaders } from '../composables/useAdminApi'
import { getAdminSession } from '../composables/useAdminAuth'
import type { OrderRiskDetail, RiskDetailRule } from '../stores/useOrdersStore'
import { donePageProgress, startPageProgress } from '../utils/progress'

const DEFAULT_USER_QUOTA = 3000

interface UserItem {
  id: string
  name: string
  phone: string
  quota: number
  orderCount: number
  totalAmount: number
  locationText: string
  registerAt: string
  idCardFront: string
  idCardBack: string
  idCardHandheld: string
  creditStatus: '优秀' | '良好' | '一般' | '风险'
  riskReport: {
    creditScore: number
    riskLevel: '低风险' | '中风险' | '高风险'
    overdueCount: number
    repayRate30d: number
    suggestedLimit: number
    avgInstallmentAmount: number
    tags: string[]
    summary: string
  }
}

interface ApiUserItem {
  id: string
  name: string
  phone: string
  quota?: number
  orderCount?: number
  totalAmount?: number
  locationText: string
  registerAt?: string
  idCardFront: string
  idCardBack: string
  idCardHandheld: string
  creditStatus?: UserItem['creditStatus']
}

const MALL_API_BASE = `${(import.meta.env.VITE_MALL_API_BASE || 'http://localhost:3110/api').replace(/\/$/, '')}`

const users = ref<UserItem[]>([])
const loading = ref(false)
const deletingId = ref('')
const pendingDeleteId = ref('')
const creating = ref(false)
const quotaDialogVisible = ref(false)
const quotaSaving = ref(false)
const quotaTarget = ref<UserItem | null>(null)
const quotaInput = ref('')
const createDialogVisible = ref(false)
const keyword = ref('')
const previewUser = ref<UserItem | null>(null)
const editingUserId = ref<string | null>(null)
const userRiskDialogVisible = ref(false)
const selectedUserForRisk = ref<UserItem | null>(null)
const displayedUserRiskDetail = ref<OrderRiskDetail | null>(null)

const createForm = reactive({
  name: '',
  phone: '',
  locationText: '',
  creditStatus: '良好' as UserItem['creditStatus'],
  /** 可选；至少 6 位才会写入商城登录密码 */
  initialPassword: '',
})

const canManageUsers = computed(() => getAdminSession()?.role === 'super_admin')

const editForm = reactive({
  name: '',
  phone: '',
  locationText: '',
  creditStatus: '良好' as UserItem['creditStatus'],
  /** 留空则不修改；填写则更新商城登录密码，至少 6 位 */
  newPassword: '',
})

const filteredUsers = computed(() => users.value)

function formatDateTime(value?: string) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const yyyy = date.getFullYear()
  const mm = `${date.getMonth() + 1}`.padStart(2, '0')
  const dd = `${date.getDate()}`.padStart(2, '0')
  const hh = `${date.getHours()}`.padStart(2, '0')
  const min = `${date.getMinutes()}`.padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`
}

function splitFactorLine(line: string): { label: string; value: string } {
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
  if (/有条件通过/i.test(decision)) {
    return 'warning'
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

function creditStatusTagType(status: UserItem['creditStatus']): 'success' | 'warning' | 'info' | 'danger' {
  if (status === '优秀') return 'success'
  if (status === '良好') return 'info'
  if (status === '一般') return 'warning'
  return 'danger'
}

function buildUserCreditRiskRules(user: UserItem): RiskDetailRule[] {
  const s = user.creditStatus
  return [
    {
      code: 'UCR-01',
      name: '实名与证件一致性',
      hit: s === '风险',
      scoreImpact: 10,
      detail: s === '风险' ? '存在证件信息异常或历史争议记录。' : '证件核验通过，无异常命中。',
    },
    {
      code: 'UCR-02',
      name: '逾期与还款表现',
      hit: s === '风险' || s === '一般',
      scoreImpact: 14,
      detail:
        s === '风险'
          ? '近端存在多次逾期或还款波动较大。'
          : s === '一般'
            ? '偶有波动，建议持续观察后续履约。'
            : '还款记录稳定，未发现异常。',
    },
    {
      code: 'UCR-03',
      name: '消费与负债综合评估',
      hit: s === '风险',
      scoreImpact: 12,
      detail:
        s === '风险'
          ? '多头分期或负债率偏高，建议收紧授信。'
          : '消费能力、订单履约与授信匹配度正常。',
    },
    {
      code: 'UCR-04',
      name: '黑名单与司法核查',
      hit: s === '风险',
      scoreImpact: 20,
      detail: s === '风险' ? '命中高风险关注项，建议人工复核。' : '未命中司法公示及黑名单规则。',
    },
  ]
}

function buildUserCreditRiskDetail(user: UserItem): OrderRiskDetail {
  const { riskReport, creditStatus } = user
  const passed = creditStatus !== '风险'
  const riskScoreMap: Record<UserItem['creditStatus'], number> = {
    优秀: 34,
    良好: 46,
    一般: 61,
    风险: 86,
  }
  const threshold = 72
  const riskScore = riskScoreMap[creditStatus]
  const decisionMap: Record<UserItem['creditStatus'], string> = {
    优秀: '授信通过',
    良好: '授信通过',
    一般: '有条件通过',
    风险: '拒绝授信',
  }
  let reason = ''
  if (!passed) {
    reason = riskReport.summary
  }
  else if (creditStatus === '一般') {
    reason = '建议持续关注还款行为，必要时动态调整授信与分期策略。'
  }
  const factors = [
    `信用评分：${riskReport.creditScore}`,
    `风险等级：${riskReport.riskLevel}`,
    `历史逾期次数：${riskReport.overdueCount}`,
    `近30日还款率：${riskReport.repayRate30d}%`,
    `建议授信额度：¥${riskReport.suggestedLimit}`,
    `平均分期金额：¥${riskReport.avgInstallmentAmount}`,
    `平台当前额度：¥${user.quota}`,
    `累计消费金额：¥${user.totalAmount}`,
    `历史订单数：${user.orderCount}`,
    `信誉标签：${riskReport.tags.join('、')}`,
  ]
  return {
    orderId: user.id,
    riskStatus: passed ? 'passed' : 'failed',
    decision: decisionMap[creditStatus],
    riskScore,
    threshold,
    checkedAt: formatDateTime(new Date().toISOString()),
    reason,
    modelVersion: 'mall-user-risk-v2.3',
    factors,
    rules: buildUserCreditRiskRules(user),
  }
}

function openUserRiskDetail(user: UserItem) {
  selectedUserForRisk.value = user
  displayedUserRiskDetail.value = buildUserCreditRiskDetail(user)
  userRiskDialogVisible.value = true
}

function onUserRiskDialogClosed() {
  selectedUserForRisk.value = null
  displayedUserRiskDetail.value = null
}

function isMockImgSrc(src: string) {
  const s = String(src || '').trim()
  return !s || s.startsWith('mock://')
}

function buildRiskReport(user: ApiUserItem): UserItem['riskReport'] {
  const orderCount = Number(user.orderCount || 0)
  const totalAmount = Number(user.totalAmount || 0)
  const creditStatus = user.creditStatus || '良好'
  const scoreMap: Record<UserItem['creditStatus'], number> = { 优秀: 92, 良好: 78, 一般: 68, 风险: 56 }
  const riskLevelMap: Record<UserItem['creditStatus'], UserItem['riskReport']['riskLevel']> = { 优秀: '低风险', 良好: '中风险', 一般: '中风险', 风险: '高风险' }
  const overdueMap: Record<UserItem['creditStatus'], number> = { 优秀: 0, 良好: 1, 一般: 2, 风险: 4 }
  const repayRateMap: Record<UserItem['creditStatus'], number> = { 优秀: 100, 良好: 92, 一般: 84, 风险: 61 }
  const baseTags: Record<UserItem['creditStatus'], string[]> = {
    优秀: ['实名一致', '稳定消费', '无逾期'],
    良好: ['消费活跃', '履约正常'],
    一般: ['消费波动', '建议持续观察'],
    风险: ['多次逾期', '高频分期', '还款波动'],
  }

  return {
    creditScore: scoreMap[creditStatus],
    riskLevel: riskLevelMap[creditStatus],
    overdueCount: overdueMap[creditStatus],
    repayRate30d: repayRateMap[creditStatus],
    suggestedLimit: Math.max(8000, Math.round(totalAmount * 2.5) || 12000),
    avgInstallmentAmount: orderCount > 0 ? Number((totalAmount / orderCount).toFixed(2)) : 0,
    tags: baseTags[creditStatus],
    summary:
      creditStatus === '风险'
        ? '用户近期连续出现逾期，建议收紧额度并加强人工复核。'
        : creditStatus === '优秀'
          ? '用户近期还款稳定，未发现风险预警，可提高分期额度。'
          : '用户具备持续消费能力，建议结合订单履约情况动态调整额度。',
  }
}

function mapApiUser(user: ApiUserItem): UserItem {
  const creditStatus = user.creditStatus || '良好'
  const quotaRaw = user.quota
  const quota = Number.isFinite(Number(quotaRaw)) && Number(quotaRaw) >= 0
    ? Math.round(Number(quotaRaw))
    : DEFAULT_USER_QUOTA
  return {
    id: user.id,
    name: user.name,
    phone: user.phone,
    quota,
    orderCount: Number(user.orderCount || 0),
    totalAmount: Number(user.totalAmount || 0),
    locationText: user.locationText || '-',
    registerAt: formatDateTime(user.registerAt),
    idCardFront: user.idCardFront || '',
    idCardBack: user.idCardBack || '',
    idCardHandheld: user.idCardHandheld || '',
    creditStatus,
    riskReport: buildRiskReport(user),
  }
}

async function fetchUsers() {
  loading.value = true
  startPageProgress()
  try {
    const query = keyword.value.trim() ? `?keyword=${encodeURIComponent(keyword.value.trim())}` : ''
    const response = await fetch(`${MALL_API_BASE}/users${query}`, {
      method: 'GET',
      headers: withAdminAuthHeaders(),
    })
    if (!response.ok) {
      throw new Error(`请求用户失败: ${response.status}`)
    }
    const payload = await response.json() as { data?: ApiUserItem[] }
    const list = Array.isArray(payload.data) ? payload.data : []
    users.value = list.map(mapApiUser)
  }
  catch (error) {
    console.error('加载用户失败', error)
  }
  finally {
    loading.value = false
    donePageProgress()
  }
}

function openPreview(user: UserItem) {
  previewUser.value = user
  editingUserId.value = null
}

function closePreview() {
  previewUser.value = null
  editingUserId.value = null
}

function startEdit(user: UserItem) {
  if (!canManageUsers.value) return
  previewUser.value = user
  editingUserId.value = user.id
  editForm.name = user.name
  editForm.phone = user.phone
  editForm.locationText = user.locationText
  editForm.creditStatus = user.creditStatus
  editForm.newPassword = ''
}

function openCreateDialog() {
  if (!canManageUsers.value) return
  createDialogVisible.value = true
  createForm.name = ''
  createForm.phone = ''
  createForm.locationText = ''
  createForm.creditStatus = '良好'
  createForm.initialPassword = ''
}

function closeCreateDialog() {
  if (creating.value) {
    return
  }
  createDialogVisible.value = false
}

async function createUser() {
  if (!canManageUsers.value) return
  if (creating.value) {
    return
  }
  if (!createForm.name.trim() || !/^1\d{10}$/.test(createForm.phone.trim())) {
    return
  }
  const initPwd = createForm.initialPassword.trim()
  if (initPwd.length > 0 && initPwd.length < 6) {
    ElMessage.warning('初始登录密码至少 6 位，或留空稍后在编辑中设置')
    return
  }
  creating.value = true
  try {
    const response = await fetch(`${MALL_API_BASE}/users`, {
      method: 'POST',
      headers: withAdminAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        name: createForm.name.trim(),
        phone: createForm.phone.trim(),
        locationText: createForm.locationText.trim(),
        creditStatus: createForm.creditStatus,
        ...(initPwd.length >= 6 ? { initialPassword: initPwd } : {}),
      }),
    })
    if (!response.ok) {
      const payload = await response.json() as { msg?: string }
      throw new Error(payload.msg || `新增用户失败: ${response.status}`)
    }
    createDialogVisible.value = false
    ElMessage.success('用户已添加')
    await fetchUsers()
  }
  catch (error) {
    console.error('新增用户失败', error)
    ElMessage.error((error as Error)?.message || '新增用户失败')
  }
  finally {
    creating.value = false
  }
}

async function saveEdit() {
  if (!canManageUsers.value) return
  if (!previewUser.value || editingUserId.value !== previewUser.value.id) {
    return
  }
  if (!editForm.name.trim() || !/^1\d{10}$/.test(editForm.phone.trim())) {
    return
  }
  const pwd = editForm.newPassword.trim()
  if (pwd.length > 0 && pwd.length < 6) {
    ElMessage.warning('新登录密码至少 6 位，或留空保持原密码')
    return
  }

  const target = users.value.find(item => item.id === previewUser.value?.id)
  if (!target) {
    return
  }

  try {
    const response = await fetch(`${MALL_API_BASE}/users/${target.id}`, {
      method: 'PATCH',
      headers: withAdminAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        name: editForm.name.trim(),
        phone: editForm.phone.trim(),
        locationText: editForm.locationText.trim(),
        creditStatus: editForm.creditStatus,
        ...(pwd.length >= 6 ? { newPassword: pwd } : {}),
      }),
    })
    if (!response.ok) {
      const payload = await response.json() as { msg?: string }
      throw new Error(payload.msg || `更新用户失败: ${response.status}`)
    }
    await fetchUsers()
    ElMessage.success('已保存')
    closePreview()
  }
  catch (error) {
    console.error('保存用户失败', error)
    ElMessage.error((error as Error)?.message || '保存用户失败')
  }
}

function toggleDeleteConfirm(userId: string) {
  if (pendingDeleteId.value === userId) {
    pendingDeleteId.value = ''
    return
  }
  pendingDeleteId.value = userId
}

function cancelDelete() {
  pendingDeleteId.value = ''
}

async function confirmDelete(user: UserItem) {
  if (!canManageUsers.value) return
  if (deletingId.value) {
    return
  }
  deletingId.value = user.id
  try {
    const response = await fetch(`${MALL_API_BASE}/users/${encodeURIComponent(user.id)}`, {
      method: 'DELETE',
      headers: withAdminAuthHeaders(),
    })
    if (!response.ok) {
      const payload = await response.json() as { msg?: string }
      throw new Error(payload.msg || `删除用户失败: ${response.status}`)
    }
    if (previewUser.value?.id === user.id) {
      closePreview()
    }
    pendingDeleteId.value = ''
    await fetchUsers()
  }
  catch (error) {
    console.error('删除用户失败', error)
  }
  finally {
    deletingId.value = ''
  }
}

onMounted(() => {
  void fetchUsers()
  pendingDeleteId.value = ''
})

watch(keyword, () => {
  void fetchUsers()
})

watch(users, () => {
  if (!previewUser.value) return
  const latest = users.value.find(item => item.id === previewUser.value?.id)
  if (latest) {
    previewUser.value = latest
  }
})

function getStatusClass(status: UserItem['creditStatus']) {
  if (status === '优秀') return 'credit-badge badge-good'
  if (status === '良好') return 'credit-badge badge-ok'
  if (status === '一般') return 'credit-badge badge-mid'
  return 'credit-badge badge-risk'
}

function openQuotaDialog(user: UserItem) {
  if (!canManageUsers.value) return
  quotaTarget.value = user
  quotaInput.value = `${user.quota}`
  quotaDialogVisible.value = true
}

function closeQuotaDialog() {
  if (quotaSaving.value) return
  quotaDialogVisible.value = false
  quotaTarget.value = null
  quotaInput.value = ''
}

async function saveQuota() {
  if (!canManageUsers.value || !quotaTarget.value || quotaSaving.value) return
  const n = Number(String(quotaInput.value).trim())
  if (!Number.isFinite(n) || n < 0) {
    return
  }
  const id = quotaTarget.value.id
  quotaSaving.value = true
  try {
    const response = await fetch(`${MALL_API_BASE}/users/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: withAdminAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ quota: Math.round(n) }),
    })
    if (!response.ok) {
      const payload = await response.json() as { msg?: string }
      throw new Error(payload.msg || `更新额度失败: ${response.status}`)
    }
    await fetchUsers()
    closeQuotaDialog()
  }
  catch (error) {
    console.error('更新额度失败', error)
  }
  finally {
    quotaSaving.value = false
  }
}
</script>

<template>
  <div class="panel">
    <div class="toolbar">
      <el-input
        v-model="keyword"
        class="toolbar-input"
        placeholder="搜索姓名 / 手机号"
        clearable
      />
      <button
        class="btn btn-refresh"
        type="button"
        :disabled="loading"
        @click="fetchUsers"
      >
        刷新
      </button>
      <button
        v-if="canManageUsers"
        class="btn btn-primary"
        type="button"
        @click="openCreateDialog"
      >
        添加用户
      </button>
    </div>

    <table class="table">
      <thead>
        <tr>
          <th>注册时间</th>
          <th>姓名</th>
          <th>手机号</th>
          <th>信誉状态</th>
          <th>额度</th>
          <th>订单数</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="item in filteredUsers"
          :key="item.id"
        >
          <td>{{ item.registerAt }}</td>
          <td>{{ item.name }}</td>
          <td>{{ item.phone }}</td>
          <td class="td-credit-status">
            <el-tag
              :type="creditStatusTagType(item.creditStatus)"
              effect="light"
              round
              size="small"
              class="credit-status-tag"
              @click="openUserRiskDetail(item)"
            >
              {{ item.creditStatus }}
            </el-tag>
          </td>
          <td class="quota-cell">
            <button
              v-if="canManageUsers"
              type="button"
              class="quota-trigger"
              @click="openQuotaDialog(item)"
            >
              ¥ {{ item.quota }}
            </button>
            <span
              v-else
              class="quota-plain"
            >¥ {{ item.quota }}</span>
          </td>
          <td>{{ item.orderCount }}</td>
          <td>
            <div class="actions">
              <button
                class="btn btn-ghost"
                type="button"
                @click="openPreview(item)"
              >
                查看
              </button>
              <button
                v-if="canManageUsers"
                class="btn btn-primary"
                type="button"
                @click="startEdit(item)"
              >
                修改
              </button>
              <div
                v-if="canManageUsers"
                class="delete-wrap"
              >
                <button
                  class="btn btn-danger"
                  type="button"
                  :disabled="Boolean(deletingId) && deletingId !== item.id"
                  @click="toggleDeleteConfirm(item.id)"
                >
                  {{ deletingId === item.id ? '删除中...' : '删除' }}
                </button>
                <div
                  v-if="pendingDeleteId === item.id"
                  class="delete-pop"
                >
                  <p>确定删除该用户？</p>
                  <div class="delete-pop-actions">
                    <button
                      class="btn btn-danger"
                      type="button"
                      :disabled="deletingId === item.id"
                      @click="confirmDelete(item)"
                    >
                      删除
                    </button>
                    <button
                      class="btn btn-ghost"
                      type="button"
                      :disabled="deletingId === item.id"
                      @click="cancelDelete"
                    >
                      取消
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </td>
        </tr>
        <tr v-if="!loading && filteredUsers.length === 0">
          <td colspan="7" style="text-align: center; color: #9ca3af;">
            暂无用户数据
          </td>
        </tr>
      </tbody>
    </table>
  </div>

  <div
    v-if="createDialogVisible && canManageUsers"
    class="modal-mask"
    @click.self="closeCreateDialog"
  >
    <div class="modal-panel create-modal">
      <div class="modal-header">
        <h3>添加用户</h3>
        <button
          type="button"
          class="btn btn-ghost"
          :disabled="creating"
          @click="closeCreateDialog"
        >
          关闭
        </button>
      </div>
      <div class="modal-grid">
        <label>
          姓名
          <el-input
            v-model="createForm.name"
            class="form-input"
            clearable
          />
        </label>
        <label>
          手机号
          <el-input
            v-model="createForm.phone"
            class="form-input"
            clearable
          />
        </label>
        <label class="full">
          注册定位
          <el-input
            v-model="createForm.locationText"
            class="form-input"
            clearable
          />
        </label>
        <label class="full">
          信誉状态
          <el-select
            v-model="createForm.creditStatus"
            class="form-select"
          >
            <el-option label="优秀" value="优秀" />
            <el-option label="良好" value="良好" />
            <el-option label="一般" value="一般" />
            <el-option label="风险" value="风险" />
          </el-select>
        </label>
        <label class="full">
          初始登录密码（可选）
          <el-input
            v-model="createForm.initialPassword"
            class="form-input"
            type="password"
            show-password
            clearable
            placeholder="至少 6 位，留空则用户需验证码登录或由后台再次设置"
            autocomplete="new-password"
          />
        </label>
      </div>
      <div class="actions actions-right">
        <button
          class="btn btn-primary"
          type="button"
          :disabled="creating"
          @click="createUser"
        >
          {{ creating ? '创建中...' : '确认添加' }}
        </button>
      </div>
    </div>
  </div>

  <div
    v-if="quotaDialogVisible && quotaTarget && canManageUsers"
    class="modal-mask"
    @click.self="closeQuotaDialog"
  >
    <div class="modal-panel create-modal">
      <div class="modal-header">
        <h3>修改额度</h3>
        <button
          type="button"
          class="btn btn-ghost"
          :disabled="quotaSaving"
          @click="closeQuotaDialog"
        >
          关闭
        </button>
      </div>
      <p class="quota-hint">
        {{ quotaTarget.name }}（{{ quotaTarget.phone }}）
      </p>
      <label class="quota-label">
        额度（元）
        <el-input
          v-model="quotaInput"
          class="form-input"
          type="number"
          :min="0"
          clearable
        />
      </label>
      <div class="actions actions-right">
        <button
          class="btn btn-primary"
          type="button"
          :disabled="quotaSaving"
          @click="saveQuota"
        >
          {{ quotaSaving ? '保存中...' : '保存' }}
        </button>
      </div>
    </div>
  </div>

  <el-dialog
    v-model="userRiskDialogVisible"
    width="640px"
    append-to-body
    align-center
    class="risk-detail-dialog"
    destroy-on-close
    @closed="onUserRiskDialogClosed"
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
      v-if="displayedUserRiskDetail && selectedUserForRisk"
      class="risk-detail-body"
    >
      <div class="risk-hero">
        <div class="risk-hero__main">
          <span class="risk-hero__label">决策结果</span>
          <el-tag
            :type="decisionTagType(displayedUserRiskDetail.decision)"
            effect="dark"
            round
            size="large"
          >
            {{ displayedUserRiskDetail.decision }}
          </el-tag>
          <el-tag
            v-if="displayedUserRiskDetail.riskStatus === 'passed'"
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
              :class="{ 'risk-score-panel__nums--over': scoreOverThreshold(displayedUserRiskDetail) }"
            >
              {{ displayedUserRiskDetail.riskScore }}
              <span class="risk-score-panel__sep">/</span>
              {{ displayedUserRiskDetail.threshold }}
            </span>
          </div>
          <el-progress
            :percentage="scoreProgressPercent(displayedUserRiskDetail)"
            :status="scoreOverThreshold(displayedUserRiskDetail) ? 'exception' : 'success'"
            :stroke-width="10"
            striped
          />
          <p class="risk-score-panel__hint">
            {{
              scoreOverThreshold(displayedUserRiskDetail)
                ? '已超过阈值，将被风控拦截'
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
            <span class="risk-desc-label"><el-icon><Document /></el-icon>用户编号</span>
          </template>
          {{ displayedUserRiskDetail.orderId }}
        </el-descriptions-item>
        <el-descriptions-item>
          <template #label>
            <span class="risk-desc-label"><el-icon><User /></el-icon>用户</span>
          </template>
          {{ selectedUserForRisk.name }}（{{ selectedUserForRisk.phone }}）
        </el-descriptions-item>
        <el-descriptions-item>
          <template #label>
            <span class="risk-desc-label"><el-icon><Cpu /></el-icon>模型版本</span>
          </template>
          {{ displayedUserRiskDetail.modelVersion }}
        </el-descriptions-item>
        <el-descriptions-item>
          <template #label>
            <span class="risk-desc-label"><el-icon><Clock /></el-icon>检查时间</span>
          </template>
          {{ displayedUserRiskDetail.checkedAt }}
        </el-descriptions-item>
      </el-descriptions>

      <el-alert
        v-if="displayedUserRiskDetail.reason"
        class="risk-reason-alert"
        :type="displayedUserRiskDetail.riskStatus === 'failed' ? 'error' : 'warning'"
        :closable="false"
        show-icon
      >
        <template #title>
          风控说明
        </template>
        {{ displayedUserRiskDetail.reason }}
      </el-alert>

      <section class="risk-block">
        <h4 class="risk-block__title">
          <span class="risk-block__title-bar" />
          风险因子
        </h4>
        <div class="risk-factor-grid">
          <div
            v-for="(factor, idx) in displayedUserRiskDetail.factors"
            :key="`${displayedUserRiskDetail.orderId}-f-${idx}`"
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
            v-for="rule in displayedUserRiskDetail.rules"
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

  <div
    v-if="previewUser"
    class="modal-mask"
    @click.self="closePreview"
  >
    <div class="modal-panel user-preview-panel">
      <header class="user-preview-head">
        <div class="user-preview-head__titles">
          <h3 class="user-preview-title">
            用户注册信息
          </h3>
          <p class="user-preview-meta">
            <span>{{ previewUser.name }}</span>
            <span class="user-preview-meta__sep">·</span>
            <span>{{ previewUser.phone }}</span>
            <span class="user-preview-meta__sep">·</span>
            <span class="user-preview-meta__id">{{ previewUser.id }}</span>
          </p>
        </div>
        <button
          type="button"
          class="btn btn-ghost user-preview-close"
          @click="closePreview"
        >
          关闭
        </button>
      </header>

      <div class="user-preview-scroll">
        <section class="user-preview-block">
          <h4 class="user-preview-block__title">
            <span class="user-preview-block__bar" />
            基本信息
          </h4>

          <div
            v-if="editingUserId === previewUser.id && canManageUsers"
            class="user-preview-edit-grid"
          >
            <label class="user-preview-field">
              <span class="user-preview-field__label">姓名</span>
              <el-input
                v-model="editForm.name"
                class="form-input"
                clearable
              />
            </label>
            <label class="user-preview-field">
              <span class="user-preview-field__label">手机号</span>
              <el-input
                v-model="editForm.phone"
                class="form-input"
                clearable
              />
            </label>
            <label class="user-preview-field user-preview-field--full">
              <span class="user-preview-field__label">注册定位</span>
              <el-input
                v-model="editForm.locationText"
                class="form-input"
                clearable
              />
            </label>
            <label class="user-preview-field user-preview-field--full">
              <span class="user-preview-field__label">信誉状态</span>
              <el-select
                v-model="editForm.creditStatus"
                class="form-select"
              >
                <el-option label="优秀" value="优秀" />
                <el-option label="良好" value="良好" />
                <el-option label="一般" value="一般" />
                <el-option label="风险" value="风险" />
              </el-select>
            </label>
            <label class="user-preview-field user-preview-field--full">
              <span class="user-preview-field__label">新登录密码</span>
              <el-input
                v-model="editForm.newPassword"
                class="form-input"
                type="password"
                show-password
                clearable
                placeholder="留空不修改；填写至少 6 位以重置商城密码登录"
                autocomplete="new-password"
              />
            </label>
            <div class="user-preview-edit-readonly">
              <div class="user-preview-edit-readonly__cell">
                <span class="user-preview-edit-readonly__k">注册时间</span>
                <span class="user-preview-edit-readonly__v">{{ previewUser.registerAt }}</span>
              </div>
              <div class="user-preview-edit-readonly__cell">
                <span class="user-preview-edit-readonly__k">额度</span>
                <span class="user-preview-edit-readonly__v user-preview-quota">¥ {{ previewUser.quota }}</span>
              </div>
            </div>
          </div>

          <template v-else>
            <el-descriptions
              :column="2"
              border
              size="default"
              class="user-preview-desc"
            >
              <el-descriptions-item label="姓名">
                {{ previewUser.name }}
              </el-descriptions-item>
              <el-descriptions-item label="手机号">
                {{ previewUser.phone }}
              </el-descriptions-item>
              <el-descriptions-item
                label="注册定位"
                :span="2"
              >
                {{ previewUser.locationText }}
              </el-descriptions-item>
              <el-descriptions-item label="注册时间">
                {{ previewUser.registerAt }}
              </el-descriptions-item>
              <el-descriptions-item label="额度">
                <span class="user-preview-quota">¥ {{ previewUser.quota }}</span>
              </el-descriptions-item>
              <el-descriptions-item
                label="信誉状态"
                :span="2"
              >
                <div class="user-preview-credit-row">
                  <span :class="getStatusClass(previewUser.creditStatus)">
                    {{ previewUser.creditStatus }}
                  </span>
                  <button
                    type="button"
                    class="user-preview-link-risk"
                    @click="openUserRiskDetail(previewUser)"
                  >
                    查看风控详情
                  </button>
                </div>
              </el-descriptions-item>
            </el-descriptions>
          </template>
        </section>

        <section class="user-preview-block">
          <h4 class="user-preview-block__title">
            <span class="user-preview-block__bar" />
            证件照片
          </h4>
          <div class="user-preview-id-grid">
            <div class="user-preview-id-cell">
              <p class="user-preview-id-label">
                身份证正面
              </p>
              <div class="user-preview-id-frame">
                <template v-if="isMockImgSrc(previewUser.idCardFront)">
                  <div class="user-preview-id-placeholder">
                    <el-icon class="user-preview-id-placeholder__icon"><Picture /></el-icon>
                    <span>模拟证件 · 无图片</span>
                  </div>
                </template>
                <el-image
                  v-else
                  :src="previewUser.idCardFront"
                  fit="cover"
                  class="user-preview-el-image"
                  :preview-src-list="[previewUser.idCardFront]"
                  preview-teleported
                >
                  <template #error>
                    <div class="user-preview-id-placeholder user-preview-id-placeholder--error">
                      <el-icon><Picture /></el-icon>
                      <span>加载失败</span>
                    </div>
                  </template>
                </el-image>
              </div>
            </div>
            <div class="user-preview-id-cell">
              <p class="user-preview-id-label">
                身份证反面
              </p>
              <div class="user-preview-id-frame">
                <template v-if="isMockImgSrc(previewUser.idCardBack)">
                  <div class="user-preview-id-placeholder">
                    <el-icon class="user-preview-id-placeholder__icon"><Picture /></el-icon>
                    <span>模拟证件 · 无图片</span>
                  </div>
                </template>
                <el-image
                  v-else
                  :src="previewUser.idCardBack"
                  fit="cover"
                  class="user-preview-el-image"
                  :preview-src-list="[previewUser.idCardBack]"
                  preview-teleported
                >
                  <template #error>
                    <div class="user-preview-id-placeholder user-preview-id-placeholder--error">
                      <el-icon><Picture /></el-icon>
                      <span>加载失败</span>
                    </div>
                  </template>
                </el-image>
              </div>
            </div>
            <div class="user-preview-id-cell">
              <p class="user-preview-id-label">
                手持身份证照片
              </p>
              <div class="user-preview-id-frame">
                <template v-if="isMockImgSrc(previewUser.idCardHandheld)">
                  <div class="user-preview-id-placeholder">
                    <el-icon class="user-preview-id-placeholder__icon"><Picture /></el-icon>
                    <span>模拟证件 · 无图片</span>
                  </div>
                </template>
                <el-image
                  v-else
                  :src="previewUser.idCardHandheld"
                  fit="cover"
                  class="user-preview-el-image"
                  :preview-src-list="[previewUser.idCardHandheld]"
                  preview-teleported
                >
                  <template #error>
                    <div class="user-preview-id-placeholder user-preview-id-placeholder--error">
                      <el-icon><Picture /></el-icon>
                      <span>加载失败</span>
                    </div>
                  </template>
                </el-image>
              </div>
            </div>
          </div>
        </section>

        <section class="user-preview-block user-preview-block--risk">
          <div class="user-preview-risk-card">
            <div class="user-preview-risk-card__head">
              <div>
                <h4 class="user-preview-risk-card__title">
                  信誉报告
                </h4>
                <p class="user-preview-risk-card__sub">
                  模拟风控数据 · 仅供参考
                </p>
              </div>
              <span :class="getStatusClass(previewUser.creditStatus)">
                {{ previewUser.creditStatus }}
              </span>
            </div>

            <div class="user-preview-risk-stats">
              <article class="user-preview-stat">
                <p class="user-preview-stat__label">
                  信用评分
                </p>
                <strong class="user-preview-stat__value user-preview-stat__value--score">{{ previewUser.riskReport.creditScore }}</strong>
              </article>
              <article class="user-preview-stat">
                <p class="user-preview-stat__label">
                  风险等级
                </p>
                <strong class="user-preview-stat__value">{{ previewUser.riskReport.riskLevel }}</strong>
              </article>
              <article class="user-preview-stat">
                <p class="user-preview-stat__label">
                  近30日还款率
                </p>
                <strong class="user-preview-stat__value">{{ previewUser.riskReport.repayRate30d }}%</strong>
              </article>
              <article class="user-preview-stat">
                <p class="user-preview-stat__label">
                  历史逾期次数
                </p>
                <strong class="user-preview-stat__value">{{ previewUser.riskReport.overdueCount }}</strong>
              </article>
              <article class="user-preview-stat">
                <p class="user-preview-stat__label">
                  建议授信额度
                </p>
                <strong class="user-preview-stat__value">¥ {{ previewUser.riskReport.suggestedLimit }}</strong>
              </article>
              <article class="user-preview-stat">
                <p class="user-preview-stat__label">
                  平均分期金额
                </p>
                <strong class="user-preview-stat__value">¥ {{ previewUser.riskReport.avgInstallmentAmount }}</strong>
              </article>
            </div>

            <div class="user-preview-risk-tags">
              <span
                v-for="tag in previewUser.riskReport.tags"
                :key="tag"
                class="user-preview-tag"
              >
                {{ tag }}
              </span>
            </div>
            <p class="user-preview-risk-summary">
              {{ previewUser.riskReport.summary }}
            </p>
          </div>
        </section>
      </div>

      <div class="user-preview-footer">
        <button
          v-if="editingUserId === previewUser.id && canManageUsers"
          class="btn btn-primary"
          type="button"
          @click="saveEdit"
        >
          保存修改
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.actions {
  display: flex;
  gap: 8px;
}

.actions-right {
  justify-content: flex-end;
  margin-top: 14px;
}

.toolbar-input {
  width: 260px;
}

.btn {
  height: 30px;
  border-radius: 6px;
  border: 1px solid #d1d5db;
  background: #fff;
  cursor: pointer;
  padding: 0 10px;
}

.btn-primary {
  border-color: #2563eb;
  background: #2563eb;
  color: #fff;
}

.quota-cell {
  white-space: nowrap;
}

.quota-plain {
  color: #111827;
}

.quota-trigger {
  margin: 0;
  padding: 0;
  border: none;
  background: none;
  font: inherit;
  color: #0f766e;
  font-weight: 600;
  cursor: pointer;
  text-decoration: underline;
  text-decoration-color: rgba(15, 118, 110, 0.35);
  text-underline-offset: 3px;
}

.quota-trigger:hover {
  color: #0d9488;
  text-decoration-color: #0d9488;
}

.quota-trigger:focus-visible {
  outline: 2px solid #2dd4bf;
  outline-offset: 2px;
  border-radius: 4px;
}

.btn-danger {
  border-color: #dc2626;
  background: #dc2626;
  color: #fff;
}

.btn-ghost {
  color: #374151;
}

.delete-wrap {
  position: relative;
}

.delete-pop {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  min-width: 180px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 8px 20px rgba(15, 23, 42, 0.12);
  padding: 10px;
  z-index: 30;
}

.delete-pop p {
  margin: 0;
  color: #374151;
  font-size: 13px;
}

.delete-pop-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 8px;
}

.delete-pop-actions .btn {
  width: 100%;
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
  width: 760px;
  max-width: 100%;
  border-radius: 12px;
  background: #fff;
  border: 1px solid #e5e7eb;
  padding: 16px;
}

.user-preview-panel {
  width: min(820px, 100%);
  max-height: min(92vh, 900px);
  display: flex;
  flex-direction: column;
  padding: 0;
  border: none;
  box-shadow: 0 25px 50px -12px rgba(15, 23, 42, 0.18);
  overflow: hidden;
  background: linear-gradient(180deg, #fafbfc 0%, #fff 120px);
}

.user-preview-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 22px 16px;
  border-bottom: 1px solid #e8ecf1;
  background: #fff;
}

.user-preview-title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: #0f172a;
  letter-spacing: 0.02em;
}

.user-preview-meta {
  margin: 6px 0 0;
  font-size: 13px;
  color: #64748b;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 6px;
}

.user-preview-meta__sep {
  opacity: 0.45;
}

.user-preview-meta__id {
  font-family: ui-monospace, monospace;
  font-size: 12px;
  color: #94a3b8;
}

.user-preview-close {
  flex-shrink: 0;
  margin-top: 2px;
}

.user-preview-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 16px 22px 12px;
}

.user-preview-block + .user-preview-block {
  margin-top: 20px;
}

.user-preview-block__title {
  margin: 0 0 12px;
  font-size: 14px;
  font-weight: 700;
  color: #1e293b;
  display: flex;
  align-items: center;
  gap: 8px;
}

.user-preview-block__bar {
  width: 4px;
  height: 14px;
  border-radius: 2px;
  background: linear-gradient(180deg, #6366f1, #8b5cf6);
}

.user-preview-desc {
  border-radius: 10px;
  overflow: hidden;
}

.user-preview-desc :deep(.el-descriptions__label) {
  width: 112px;
  font-weight: 600;
  color: #64748b !important;
  background: #f8fafc !important;
}

.user-preview-desc :deep(.el-descriptions__content) {
  color: #0f172a;
}

.user-preview-quota {
  font-weight: 700;
  color: #0f766e;
  font-variant-numeric: tabular-nums;
}

.user-preview-credit-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}

.user-preview-link-risk {
  padding: 0;
  border: none;
  background: none;
  font-size: 13px;
  font-weight: 600;
  color: #4f46e5;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.user-preview-link-risk:hover {
  color: #4338ca;
}

.user-preview-edit-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px 16px;
}

.user-preview-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.user-preview-field--full {
  grid-column: 1 / -1;
}

.user-preview-field__label {
  font-size: 13px;
  font-weight: 600;
  color: #64748b;
}

.user-preview-edit-readonly {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 10px;
  background: #f1f5f9;
  border: 1px dashed #cbd5e1;
}

.user-preview-edit-readonly__cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.user-preview-edit-readonly__k {
  font-size: 12px;
  color: #64748b;
  font-weight: 500;
}

.user-preview-edit-readonly__v {
  font-size: 14px;
  color: #0f172a;
  font-weight: 600;
}

.user-preview-id-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

@media (max-width: 700px) {
  .user-preview-id-grid {
    grid-template-columns: 1fr;
  }
}

.user-preview-id-label {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 600;
  color: #475569;
}

.user-preview-id-frame {
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid #e2e8f0;
  background: #f8fafc;
  aspect-ratio: 4 / 3;
}

.user-preview-el-image {
  width: 100%;
  height: 100%;
  display: block;
}

.user-preview-el-image :deep(.el-image__inner) {
  width: 100%;
  height: 100%;
}

.user-preview-id-placeholder {
  height: 100%;
  min-height: 140px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #94a3b8;
  font-size: 13px;
  padding: 16px;
  text-align: center;
}

.user-preview-id-placeholder--error {
  color: #cbd5e1;
  background: #1e293b;
}

.user-preview-id-placeholder__icon {
  font-size: 36px;
  opacity: 0.65;
}

.user-preview-block--risk {
  margin-top: 8px;
}

.user-preview-risk-card {
  border-radius: 14px;
  border: 1px solid rgba(99, 102, 241, 0.2);
  background: linear-gradient(145deg, #f8fafc 0%, #f5f3ff 45%, #faf5ff 100%);
  padding: 16px 18px 18px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8);
}

.user-preview-risk-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 14px;
  padding-bottom: 14px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.35);
}

.user-preview-risk-card__title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: #1e293b;
}

.user-preview-risk-card__sub {
  margin: 4px 0 0;
  font-size: 12px;
  color: #64748b;
}

.user-preview-risk-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

@media (max-width: 640px) {
  .user-preview-risk-stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .user-preview-edit-grid {
    grid-template-columns: 1fr;
  }

  .user-preview-edit-readonly {
    grid-template-columns: 1fr;
  }
}

.user-preview-stat {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 10px 12px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}

.user-preview-stat__label {
  margin: 0;
  font-size: 11px;
  font-weight: 600;
  color: #64748b;
  text-transform: none;
  letter-spacing: 0.02em;
}

.user-preview-stat__value {
  display: block;
  margin-top: 6px;
  font-size: 15px;
  font-weight: 700;
  color: #0f172a;
  font-variant-numeric: tabular-nums;
}

.user-preview-stat__value--score {
  font-size: 22px;
  background: linear-gradient(120deg, #4f46e5, #7c3aed);
  background-clip: text;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.user-preview-risk-tags {
  margin-top: 14px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.user-preview-tag {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  color: #4338ca;
  background: rgba(99, 102, 241, 0.12);
  border: 1px solid rgba(99, 102, 241, 0.2);
}

.user-preview-risk-summary {
  margin: 14px 0 0;
  padding: 12px 14px;
  border-radius: 10px;
  font-size: 13px;
  line-height: 1.55;
  color: #475569;
  background: rgba(255, 255, 255, 0.75);
  border: 1px solid rgba(226, 232, 240, 0.9);
}

.user-preview-footer {
  flex-shrink: 0;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 22px 18px;
  border-top: 1px solid #e8ecf1;
  background: #fff;
}

.create-modal {
  width: 520px;
}

.quota-hint {
  margin: 0 0 12px;
  font-size: 14px;
  color: #4b5563;
}

.quota-label {
  display: grid;
  gap: 6px;
  font-size: 14px;
  color: #6b7280;
  margin-bottom: 8px;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.modal-header h3 {
  margin: 0;
}

.modal-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.modal-grid label {
  display: grid;
  gap: 6px;
  font-size: 14px;
  color: #6b7280;
}

.modal-grid .full {
  grid-column: 1 / -1;
}

.modal-grid p {
  margin: 0;
  min-height: 36px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 8px 10px;
  color: #111827;
  display: flex;
  align-items: center;
}

.modal-grid input {
  height: 36px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  padding: 0 10px;
}

.modal-grid select {
  height: 36px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  padding: 0 10px;
}

.form-input,
.form-select {
  width: 100%;
}

.credit-badge {
  display: inline-flex;
  align-items: center;
  height: 24px;
  border-radius: 999px;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 600;
}

.badge-good {
  color: #047857;
  background: #d1fae5;
}

.badge-ok {
  color: #1d4ed8;
  background: #dbeafe;
}

.badge-mid {
  color: #b45309;
  background: #fef3c7;
}

.badge-risk {
  color: #b91c1c;
  background: #fee2e2;
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

.risk-detail-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
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
/* append-to-body 风控弹窗（与 OrderReviewPage 一致） */
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
