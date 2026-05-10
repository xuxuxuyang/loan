<script setup lang="ts">
import { Picture } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { withAdminAuthHeaders } from '../composables/useAdminApi'
import { getAdminSession } from '../composables/useAdminAuth'
import UserRiskDetailDialog, { type UserItem, type UserRiskSnapshot } from '../components/UserRiskDetailDialog.vue'
import { donePageProgress, startPageProgress } from '../utils/progress'

const DEFAULT_USER_QUOTA = 3000

/** 与商城注册、后端校验一致的 18 位身份证号格式（扩展表单校验时可复用） */
const CN_ID_CARD_RE = /^[1-9]\d{5}(18|19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dX]$/

interface MallUserRiskPreview {
  creditScore: number
  riskLevel: '低风险' | '中风险' | '高风险'
  overdueCount: number
  repayRate30d: number
  suggestedLimit: number
  avgInstallmentAmount: number
  tags: string[]
  summary: string
}

/** 列表与预览：档案字段 + 管理端模拟信誉摘要；`riskControlSnapshot` 来自库内用户档案 */
type ListedUser = UserItem & {
  riskReport: MallUserRiskPreview
  riskControlSnapshot?: UserRiskSnapshot | null
  riskUpstreamConfigured?: boolean
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
  idNumber?: string
  riskControlSnapshot?: UserRiskSnapshot | null
  riskUpstreamConfigured?: boolean
}

const MALL_API_BASE = `${(import.meta.env.VITE_MALL_API_BASE || 'http://localhost:3110/api').replace(/\/$/, '')}`

const users = ref<ListedUser[]>([])
const loading = ref(false)
const deletingId = ref('')
const pendingDeleteId = ref('')
const creating = ref(false)
const quotaDialogVisible = ref(false)
const quotaSaving = ref(false)
const quotaTarget = ref<ListedUser | null>(null)
const quotaInput = ref('')
const createDialogVisible = ref(false)
const keyword = ref('')
const previewUser = ref<ListedUser | null>(null)
const editingUserId = ref<string | null>(null)
const userRiskDialogVisible = ref(false)
const riskDialogUserId = ref<string | null>(null)

const createForm = reactive({
  name: '',
  phone: '',
  idNumber: '',
  locationText: '',
  creditStatus: '良好' as UserItem['creditStatus'],
  /** 可选；至少 6 位才会写入商城登录密码 */
  initialPassword: '',
})

const canManageUsers = computed(() => getAdminSession()?.role === 'super_admin')

const editForm = reactive({
  name: '',
  phone: '',
  idNumber: '',
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

function creditStatusTagType(status: UserItem['creditStatus']): 'success' | 'warning' | 'info' | 'danger' {
  if (status === '优秀') return 'success'
  if (status === '良好') return 'info'
  if (status === '一般') return 'warning'
  return 'danger'
}

function openUserRiskDetail(user: ListedUser) {
  riskDialogUserId.value = user.id
  userRiskDialogVisible.value = true
}

function onRiskDialogUserUpdated(mapped: UserItem) {
  const idx = users.value.findIndex(u => u.id === mapped.id)
  if (idx >= 0) {
    const prev = users.value[idx]
    users.value[idx] = {
      ...prev,
      ...mapped,
      riskReport: prev.riskReport,
    }
  }
}

watch(userRiskDialogVisible, (open) => {
  if (!open)
    riskDialogUserId.value = null
})

function isMockImgSrc(src: string) {
  const s = String(src || '').trim()
  return !s || s.startsWith('mock://')
}

function buildRiskReport(user: ApiUserItem): MallUserRiskPreview {
  const orderCount = Number(user.orderCount || 0)
  const totalAmount = Number(user.totalAmount || 0)
  const creditStatus = user.creditStatus || '良好'
  const scoreMap: Record<UserItem['creditStatus'], number> = { 优秀: 92, 良好: 78, 一般: 68, 风险: 56 }
  const riskLevelMap: Record<UserItem['creditStatus'], MallUserRiskPreview['riskLevel']> = { 优秀: '低风险', 良好: '中风险', 一般: '中风险', 风险: '高风险' }
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

function mapApiUser(user: ApiUserItem): ListedUser {
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
    idNumber: typeof user.idNumber === 'string' && user.idNumber.trim()
      ? (CN_ID_CARD_RE.test(user.idNumber.trim().toUpperCase())
          ? user.idNumber.trim().toUpperCase()
          : undefined)
      : undefined,
    creditStatus,
    riskReport: buildRiskReport(user),
    riskControlSnapshot: user.riskControlSnapshot ?? undefined,
    riskUpstreamConfigured: user.riskUpstreamConfigured,
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

function openPreview(user: ListedUser) {
  previewUser.value = user
  editingUserId.value = null
}

function closePreview() {
  previewUser.value = null
  editingUserId.value = null
}

function startEdit(user: ListedUser) {
  if (!canManageUsers.value) return
  previewUser.value = user
  editingUserId.value = user.id
  editForm.name = user.name
  editForm.phone = user.phone
  editForm.idNumber = user.idNumber || ''
  editForm.locationText = user.locationText
  editForm.creditStatus = user.creditStatus
  editForm.newPassword = ''
}

function openCreateDialog() {
  if (!canManageUsers.value) return
  createDialogVisible.value = true
  createForm.name = ''
  createForm.phone = ''
  createForm.idNumber = ''
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
  const idRawCreate = createForm.idNumber.trim().toUpperCase()
  if (idRawCreate.length > 0 && !CN_ID_CARD_RE.test(idRawCreate)) {
    ElMessage.warning('身份证号码需为 18 位合法格式，或留空')
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
        ...(idRawCreate ? { idNumber: idRawCreate } : {}),
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
  const idRaw = editForm.idNumber.trim().toUpperCase()
  if (idRaw.length > 0 && !CN_ID_CARD_RE.test(idRaw)) {
    ElMessage.warning('身份证号码需为 18 位合法格式，或留空可清空档案中的号码')
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
        idNumber: idRaw,
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

async function confirmDelete(user: ListedUser) {
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

function openQuotaDialog(user: ListedUser) {
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
          身份证号码（可选）
          <el-input
            v-model="createForm.idNumber"
            class="form-input"
            maxlength="18"
            clearable
            placeholder="18 位大陆身份证号，风控 B 类接口必填；可留空"
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

  <UserRiskDetailDialog
    v-model="userRiskDialogVisible"
    :user-id="riskDialogUserId"
    @user-updated="onRiskDialogUserUpdated"
  />

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
              <span class="user-preview-field__label">身份证号码</span>
              <el-input
                v-model="editForm.idNumber"
                class="form-input user-preview-id-number-input"
                maxlength="18"
                clearable
                placeholder="18 位大陆身份证号，留空可清空档案中的号码"
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
              <el-descriptions-item label="身份证号码">
                <span
                  v-if="previewUser.idNumber"
                  class="user-preview-id-number"
                >{{ previewUser.idNumber }}</span>
                <span
                  v-else
                  class="user-preview-meta__muted"
                >未填写</span>
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
</style>
