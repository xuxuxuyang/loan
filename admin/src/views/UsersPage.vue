<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'

interface UserItem {
  id: string
  name: string
  phone: string
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
const keyword = ref('')
const previewUser = ref<UserItem | null>(null)
const editingUserId = ref<string | null>(null)
let syncTimer: number | null = null

const editForm = reactive({
  name: '',
  phone: '',
  locationText: '',
  creditStatus: '良好' as UserItem['creditStatus'],
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
  return {
    id: user.id,
    name: user.name,
    phone: user.phone,
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
  try {
    const query = keyword.value.trim() ? `?keyword=${encodeURIComponent(keyword.value.trim())}` : ''
    const response = await fetch(`${MALL_API_BASE}/users${query}`, { method: 'GET' })
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
  previewUser.value = user
  editingUserId.value = user.id
  editForm.name = user.name
  editForm.phone = user.phone
  editForm.locationText = user.locationText
  editForm.creditStatus = user.creditStatus
}

async function saveEdit() {
  if (!previewUser.value || editingUserId.value !== previewUser.value.id) {
    return
  }
  if (!editForm.name.trim() || !/^1\d{10}$/.test(editForm.phone.trim())) {
    return
  }

  const target = users.value.find(item => item.id === previewUser.value?.id)
  if (!target) {
    return
  }

  try {
    const response = await fetch(`${MALL_API_BASE}/users/${target.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: editForm.name.trim(),
        phone: editForm.phone.trim(),
        locationText: editForm.locationText.trim(),
        creditStatus: editForm.creditStatus,
      }),
    })
    if (!response.ok) {
      const payload = await response.json() as { msg?: string }
      throw new Error(payload.msg || `更新用户失败: ${response.status}`)
    }
    await fetchUsers()
    previewUser.value = users.value.find(item => item.id === target.id) || null
    editingUserId.value = null
  }
  catch (error) {
    console.error('保存用户失败', error)
  }
}

onMounted(() => {
  void fetchUsers()
  syncTimer = window.setInterval(() => {
    void fetchUsers()
  }, 3000)
})

onBeforeUnmount(() => {
  if (syncTimer !== null) {
    window.clearInterval(syncTimer)
  }
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
</script>

<template>
  <div class="panel">
    <div class="toolbar">
      <input
        v-model="keyword"
        placeholder="搜索用户ID / 姓名 / 手机号"
      >
    </div>

    <table class="table">
      <thead>
        <tr>
          <th>用户ID</th>
          <th>姓名</th>
          <th>手机号</th>
          <th>订单数</th>
          <th>累计消费</th>
          <th>信誉状态</th>
          <th>注册时间</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="loading">
          <td colspan="8" style="text-align: center; color: #6b7280;">
            数据加载中...
          </td>
        </tr>
        <tr
          v-for="item in filteredUsers"
          :key="item.id"
        >
          <td>{{ item.id }}</td>
          <td>{{ item.name }}</td>
          <td>{{ item.phone }}</td>
          <td>{{ item.orderCount }}</td>
          <td>¥ {{ item.totalAmount }}</td>
          <td>
            <span :class="getStatusClass(item.creditStatus)">
              {{ item.creditStatus }}
            </span>
          </td>
          <td>{{ item.registerAt }}</td>
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
                class="btn btn-primary"
                type="button"
                @click="startEdit(item)"
              >
                修改
              </button>
            </div>
          </td>
        </tr>
        <tr v-if="!loading && filteredUsers.length === 0">
          <td colspan="8" style="text-align: center; color: #9ca3af;">
            暂无用户数据
          </td>
        </tr>
      </tbody>
    </table>
  </div>

  <div
    v-if="previewUser"
    class="modal-mask"
    @click.self="closePreview"
  >
    <div class="modal-panel">
      <div class="modal-header">
        <h3>用户注册信息</h3>
        <button
          type="button"
          class="btn btn-ghost"
          @click="closePreview"
        >
          关闭
        </button>
      </div>

      <div class="modal-grid">
        <label>
          姓名
          <input
            v-if="editingUserId === previewUser.id"
            v-model="editForm.name"
          >
          <p v-else>
            {{ previewUser.name }}
          </p>
        </label>
        <label>
          手机号
          <input
            v-if="editingUserId === previewUser.id"
            v-model="editForm.phone"
          >
          <p v-else>
            {{ previewUser.phone }}
          </p>
        </label>
        <label class="full">
          注册定位
          <input
            v-if="editingUserId === previewUser.id"
            v-model="editForm.locationText"
          >
          <p v-else>
            {{ previewUser.locationText }}
          </p>
        </label>
        <label class="full">
          注册时间
          <p>{{ previewUser.registerAt }}</p>
        </label>
        <label class="full">
          信誉状态
          <select
            v-if="editingUserId === previewUser.id"
            v-model="editForm.creditStatus"
          >
            <option value="优秀">
              优秀
            </option>
            <option value="良好">
              良好
            </option>
            <option value="一般">
              一般
            </option>
            <option value="风险">
              风险
            </option>
          </select>
          <p v-else>
            <span :class="getStatusClass(previewUser.creditStatus)">
              {{ previewUser.creditStatus }}
            </span>
          </p>
        </label>
      </div>

      <div class="card-images">
        <div>
          <p>身份证正面</p>
          <img
            :src="previewUser.idCardFront"
            alt="身份证正面"
          >
        </div>
        <div>
          <p>身份证反面</p>
          <img
            :src="previewUser.idCardBack"
            alt="身份证反面"
          >
        </div>
        <div>
          <p>手持身份证照片</p>
          <img
            :src="previewUser.idCardHandheld"
            alt="手持身份证照片"
          >
        </div>
      </div>

      <div class="risk-panel">
        <h4>信誉报告（模拟风控数据）</h4>
        <div class="risk-grid">
          <article class="risk-item">
            <p>信用评分</p>
            <strong>{{ previewUser.riskReport.creditScore }}</strong>
          </article>
          <article class="risk-item">
            <p>风险等级</p>
            <strong>{{ previewUser.riskReport.riskLevel }}</strong>
          </article>
          <article class="risk-item">
            <p>近30日还款率</p>
            <strong>{{ previewUser.riskReport.repayRate30d }}%</strong>
          </article>
          <article class="risk-item">
            <p>历史逾期次数</p>
            <strong>{{ previewUser.riskReport.overdueCount }}</strong>
          </article>
          <article class="risk-item">
            <p>建议授信额度</p>
            <strong>¥ {{ previewUser.riskReport.suggestedLimit }}</strong>
          </article>
          <article class="risk-item">
            <p>平均分期金额</p>
            <strong>¥ {{ previewUser.riskReport.avgInstallmentAmount }}</strong>
          </article>
        </div>
        <div class="tags">
          <span
            v-for="tag in previewUser.riskReport.tags"
            :key="tag"
          >
            {{ tag }}
          </span>
        </div>
        <p class="summary">
          {{ previewUser.riskReport.summary }}
        </p>
      </div>

      <div class="actions actions-right">
        <button
          v-if="editingUserId === previewUser.id"
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

.btn-ghost {
  color: #374151;
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

.card-images {
  margin-top: 14px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.card-images p {
  margin: 0 0 6px;
  color: #6b7280;
  font-size: 14px;
}

.card-images img {
  width: 100%;
  height: 120px;
  object-fit: cover;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
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

.risk-panel {
  margin-top: 14px;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 12px;
  background: #fafafa;
}

.risk-panel h4 {
  margin: 0 0 10px;
}

.risk-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.risk-item {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 8px;
}

.risk-item p {
  margin: 0;
  color: #6b7280;
  font-size: 12px;
}

.risk-item strong {
  display: block;
  margin-top: 4px;
}

.tags {
  margin-top: 10px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tags span {
  background: #e5edff;
  color: #3456b8;
  border-radius: 999px;
  padding: 4px 8px;
  font-size: 12px;
}

.summary {
  margin: 10px 0 0;
  font-size: 13px;
  color: #4b5563;
}
</style>
