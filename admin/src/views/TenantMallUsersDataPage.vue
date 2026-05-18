<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { withAdminAuthHeaders } from '../composables/useAdminApi'

interface TenantSummary {
  tenantId: string
  tenantName?: string
}

interface MallUserAggRow {
  id: string
  name: string
  phone: string
  orderCount?: number
  totalAmount?: number
  lastOrderAt?: string
  registerAt?: string
  registerChannelLabel?: string
  mergedTenantIds: string[]
  mergedTenantLabel: string
  duplicateSystemCount: number
}

const MALL_API_BASE = `${(import.meta.env.VITE_MALL_API_BASE || 'http://localhost:3110/api').replace(/\/$/, '')}`
const TENANT_EMPTY = ''

const tenants = ref<TenantSummary[]>([])
const rows = ref<MallUserAggRow[]>([])
const loading = ref(false)
const tenantsLoading = ref(false)
const errorMessage = ref('')
const selectedTenantId = ref(TENANT_EMPTY)
const keyword = ref('')

const isAllTenants = computed(() => !String(selectedTenantId.value || '').trim())

const summedRawSnapshots = computed(() =>
  rows.value.reduce((n, item) => n + Number(item.duplicateSystemCount || 1), 0),
)

function tenantOptionLabel(item: TenantSummary) {
  const id = String(item.tenantId || '').trim()
  const name = String(item.tenantName || '').trim()
  if (!id) return '-'
  if (name && name !== id) {
    return `${name}（${id}）`
  }
  return id
}

function formatDateTime(value?: string) {
  if (!value) return '-'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) {
    return value
  }
  return d.toLocaleString('zh-CN', {
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

async function fetchTenants() {
  tenantsLoading.value = true
  try {
    const response = await fetch(`${MALL_API_BASE}/platform/tenants`, {
      method: 'GET',
      headers: withAdminAuthHeaders({ 'x-workspace-type': 'core' }),
    })
    const payload = await response.json() as {
      success?: boolean
      msg?: string
      data?: TenantSummary[]
    }
    if (!response.ok || payload.success === false) {
      throw new Error(payload.msg || `加载子系统列表失败 (${response.status})`)
    }
    tenants.value = Array.isArray(payload.data) ? payload.data : []
  }
  catch (error) {
    tenants.value = []
    const msg = error instanceof Error ? error.message : '加载子系统列表失败'
    ElMessage.error(msg)
  }
  finally {
    tenantsLoading.value = false
  }
}

async function fetchMallUsers() {
  loading.value = true
  errorMessage.value = ''
  try {
    const qs = new URLSearchParams()
    const tid = String(selectedTenantId.value || '').trim()
    if (tid) {
      qs.set('tenantId', tid)
    }
    const key = keyword.value.trim()
    if (key) {
      qs.set('keyword', key)
    }
    const qsStr = qs.toString()
    const url = qsStr.length > 0
      ? `${MALL_API_BASE}/platform/mall-users?${qsStr}`
      : `${MALL_API_BASE}/platform/mall-users`
    const response = await fetch(url, {
      method: 'GET',
      headers: withAdminAuthHeaders({ 'x-workspace-type': 'core' }),
    })
    const payload = await response.json() as {
      success?: boolean
      msg?: string
      data?: MallUserAggRow[]
    }
    if (!response.ok || payload.success === false) {
      throw new Error(payload.msg || `加载用户数据失败 (${response.status})`)
    }
    const list = Array.isArray(payload.data) ? payload.data : []
    rows.value = list.map((item) => ({
      ...item,
      mergedTenantIds: Array.isArray(item.mergedTenantIds) ? item.mergedTenantIds : [],
      mergedTenantLabel: String(item.mergedTenantLabel || item.mergedTenantIds?.join('、') || ''),
      duplicateSystemCount: Number(item.duplicateSystemCount || 1),
    }))
  }
  catch (error) {
    rows.value = []
    errorMessage.value = error instanceof Error ? error.message : '加载用户数据失败'
    ElMessage.error(errorMessage.value)
  }
  finally {
    loading.value = false
  }
}

function rowKey(record: MallUserAggRow, index: number) {
  const m = Array.isArray(record.mergedTenantIds) ? record.mergedTenantIds.join('|') : ''
  return `${record.phone || ''}_${m}_${record.id}_${index}`
}

watch(
  () => selectedTenantId.value,
  () => void fetchMallUsers(),
)

onMounted(() => {
  void fetchTenants()
  void fetchMallUsers()
})
</script>

<template>
  <div v-loading="loading || tenantsLoading" class="tenant-mall-users-page">
    <div class="tenant-mall-users__intro">
      <p class="tenant-mall-users__title">
        商城注册用户（跨子系统）
      </p>
      
    </div>

    <el-alert
      v-if="errorMessage"
      type="error"
      show-icon
      closable
      class="tenant-mall-users__error"
      title="加载失败"
      :description="errorMessage"
      @close="errorMessage = ''"
    />

    <div class="panel">
      <div class="panel-title">
        <h3>筛选</h3>
      </div>
      <div class="toolbar toolbar-left">
        <el-select
          v-model="selectedTenantId"
          class="toolbar-input tenant-mall-users__select"
          clearable
          placeholder="全部子系统"
        >
          <el-option
            v-for="item in tenants"
            :key="`mall-user-filter-${item.tenantId}`"
            :label="tenantOptionLabel(item)"
            :value="item.tenantId"
          />
        </el-select>
        <el-input
          v-model="keyword"
          class="toolbar-input"
          clearable
          placeholder="商城用户 ID / 姓名 / 手机号"
          @keyup.enter="fetchMallUsers"
        />
        <button
          class="btn btn-refresh"
          type="button"
          :disabled="loading"
          @click="fetchMallUsers"
        >
          {{ loading ? '刷新中…' : '刷新' }}
        </button>
      </div>
      <div class="tenant-mall-users__stats">
        当前表格 <strong>{{ rows.length }}</strong> 行
        <template v-if="isAllTenants">
          ，对应跨库原始记录合计 <strong>{{ summedRawSnapshots }}</strong> 条
        </template>
      </div>
    </div>

    <div class="panel tenant-mall-users__panel-table">
      <div class="panel-title tenant-mall-users__panel-title-row">
        <h3>用户列表</h3>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>姓名</th>
              <th>手机号</th>
              <th>商城 ID</th>
              <th>订单数（汇总·卡包已发放）</th>
              <th>成交金额（汇总·卡包已发放）</th>
              <th>最近下单</th>
              <th>注册渠道</th>
              <th>所属子系统</th>
              <th>注册时间</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(item, index) in rows"
              :key="rowKey(item, index)"
            >
              <td>{{ item.name || '-' }}</td>
              <td>{{ item.phone || '-' }}</td>
              <td>{{ item.id || '-' }}</td>
              <td>{{ Number(item.orderCount || 0) }}</td>
              <td>{{ item.totalAmount != null ? Number(item.totalAmount).toFixed(2) : '0.00' }}</td>
              <td>{{ formatDateTime(item.lastOrderAt) }}</td>
              <td>{{ item.registerChannelLabel || '-' }}</td>
              <td>
                <div class="tenant-mall-users__tenant-cell">
                  <span>{{ item.mergedTenantLabel || '-' }}</span>
                  <el-tag
                    v-if="isAllTenants && item.duplicateSystemCount > 1"
                    type="warning"
                    size="small"
                    effect="plain"
                  >
                    跨 {{ item.duplicateSystemCount }} 个子系统
                  </el-tag>
                </div>
              </td>
              <td>{{ formatDateTime(item.registerAt) }}</td>
            </tr>
            <tr v-if="!loading && rows.length === 0">
              <td colspan="9" class="empty">
                暂无数据
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tenant-mall-users-page {
  display: grid;
  gap: 14px;
  align-content: start;
  width: 100%;
  flex: 0 1 auto;
  min-height: 0;
}

.tenant-mall-users__intro {
  display: grid;
  gap: 10px;
}

.tenant-mall-users__title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: #334155;
}

.tenant-mall-users__alert {
  max-width: 920px;
}

.tenant-mall-users__error {
  max-width: 920px;
}

.panel {
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  background: #fff;
  padding: 12px;
}

.panel-title h3 {
  margin: 0;
  font-size: 16px;
}

.toolbar {
  margin-top: 10px;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.toolbar-left {
  justify-content: flex-start;
}

.toolbar-input {
  width: 260px;
}

.tenant-mall-users__select {
  min-width: 240px;
}

.tenant-mall-users__stats {
  margin-top: 12px;
  font-size: 13px;
  color: #64748b;
}

.tenant-mall-users__stats strong {
  color: #0f172a;
}

.table-wrap {
  width: 100%;
  overflow: auto;
  margin-top: 10px;
}

.table {
  width: 100%;
  min-width: 960px;
  border-collapse: collapse;
}

.table th,
.table td {
  border-bottom: 1px solid #f1f5f9;
  padding: 10px 8px;
  text-align: left;
  vertical-align: middle;
}

.tenant-mall-users__tenant-cell {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.btn {
  height: 30px;
  border-radius: 6px;
  border: 1px solid #d1d5db;
  background: #fff;
  cursor: pointer;
  padding: 0 12px;
  font-size: 13px;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-refresh {
  border-color: #16a34a;
  background: #16a34a;
  color: #fff;
}

.empty {
  text-align: center;
  color: #94a3b8;
}
</style>
