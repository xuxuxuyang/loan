<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { withAdminAuthHeaders } from '../composables/useAdminApi'
import { useTenantScope } from '../composables/useTenantScope'

interface TenantSummary {
  tenantId: string
  tenantName?: string
  userCount: number
  orderCount: number
  productCount: number
}

interface PlatformSummary {
  tenantCount: number
  totalUsers: number
  totalOrders: number
  totalProducts: number
  tenants: TenantSummary[]
}

const MALL_API_BASE = `${(import.meta.env.VITE_MALL_API_BASE || 'http://localhost:3110/api').replace(/\/$/, '')}`
const loading = ref(false)
const creatingTenant = ref(false)
const errorMessage = ref('')
const newTenantId = ref('')
const summary = ref<PlatformSummary>({
  tenantCount: 0,
  totalUsers: 0,
  totalOrders: 0,
  totalProducts: 0,
  tenants: [],
})
const keyword = ref('')
const { switchTenant } = useTenantScope()

const filteredTenants = computed(() => {
  const key = keyword.value.trim().toLowerCase()
  if (!key) {
    return summary.value.tenants
  }
  return summary.value.tenants.filter((item) => {
    const id = String(item.tenantId || '').toLowerCase()
    const name = String(item.tenantName || '').toLowerCase()
    return id.includes(key) || name.includes(key)
  })
})

async function fetchSummary() {
  loading.value = true
  errorMessage.value = ''
  try {
    const response = await fetch(`${MALL_API_BASE}/platform/dashboard/summary`, {
      method: 'GET',
      headers: withAdminAuthHeaders({ 'x-workspace-type': 'core' }),
    })
    const payload = await response.json() as {
      success?: boolean
      msg?: string
      data?: PlatformSummary
    }
    if (!response.ok || payload.success === false || !payload.data) {
      throw new Error(payload.msg || `加载总部汇总失败 (${response.status})`)
    }
    summary.value = {
      tenantCount: Number(payload.data.tenantCount || 0),
      totalUsers: Number(payload.data.totalUsers || 0),
      totalOrders: Number(payload.data.totalOrders || 0),
      totalProducts: Number(payload.data.totalProducts || 0),
      tenants: Array.isArray(payload.data.tenants) ? payload.data.tenants : [],
    }
  }
  catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '加载总部汇总失败'
  }
  finally {
    loading.value = false
  }
}

async function createTenant() {
  const tenantId = String(newTenantId.value || '').trim()
  if (!tenantId) {
    errorMessage.value = '请输入租户系统ID'
    return
  }
  creatingTenant.value = true
  errorMessage.value = ''
  try {
    const response = await fetch(`${MALL_API_BASE}/platform/tenants`, {
      method: 'POST',
      headers: withAdminAuthHeaders({ 'Content-Type': 'application/json', 'x-workspace-type': 'core' }),
      body: JSON.stringify({ tenantId }),
    })
    const payload = await response.json() as { success?: boolean, msg?: string }
    if (!response.ok || payload.success === false) {
      throw new Error(payload.msg || `新增租户系统失败 (${response.status})`)
    }
    newTenantId.value = ''
    await fetchSummary()
  }
  catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '新增租户系统失败'
  }
  finally {
    creatingTenant.value = false
  }
}

function jumpToTenant(tenantId: string) {
  switchTenant(tenantId)
}

onMounted(() => {
  void fetchSummary()
})
</script>

<template>
  <div
    v-loading="loading"
    class="platform-console"
  >
    <div class="platform-head">
      <h2>总部控制台</h2>
      <button
        class="btn btn-primary"
        type="button"
        :disabled="loading"
        @click="fetchSummary"
      >
        刷新
      </button>
    </div>

    <p
      v-if="errorMessage"
      class="error"
    >
      {{ errorMessage }}
    </p>

    <div class="kpi-grid">
      <div class="kpi-card">
        <p class="kpi-label">租户数</p>
        <p class="kpi-value">{{ summary.tenantCount }}</p>
      </div>
      <div class="kpi-card">
        <p class="kpi-label">总用户数</p>
        <p class="kpi-value">{{ summary.totalUsers }}</p>
      </div>
      <div class="kpi-card">
        <p class="kpi-label">总订单数</p>
        <p class="kpi-value">{{ summary.totalOrders }}</p>
      </div>
      <div class="kpi-card">
        <p class="kpi-label">总商品数</p>
        <p class="kpi-value">{{ summary.totalProducts }}</p>
      </div>
    </div>

    <div class="tenant-onboarding">
      <div class="tenant-onboarding-head">
        <h3>租户系统开通</h3>
        <p>新开租户的必选步骤：先在这里登记租户系统ID，再去账号管理分配老板账号。</p>
      </div>
      <div class="tenant-onboarding-form">
        <el-input
          v-model="newTenantId"
          class="tenant-create-input"
          clearable
          placeholder="请输入租户系统ID（如 tenant_a）"
        />
        <button
          class="btn btn-primary"
          type="button"
          :disabled="creatingTenant"
          @click="createTenant"
        >
          {{ creatingTenant ? '开通中...' : '开通租户系统' }}
        </button>
      </div>
    </div>

    <div class="tenant-panel">
      <div class="tenant-toolbar">
        <h3>租户列表</h3>
        <el-input
          v-model="keyword"
          class="tenant-search"
          clearable
          placeholder="搜索租户 ID"
        />
      </div>

      <table class="tenant-table">
        <thead>
          <tr>
            <th>租户</th>
            <th>用户数</th>
            <th>订单数</th>
            <th>商品数</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="item in filteredTenants"
            :key="item.tenantId"
          >
            <td>{{ item.tenantName || item.tenantId }}</td>
            <td>{{ item.userCount }}</td>
            <td>{{ item.orderCount }}</td>
            <td>{{ item.productCount }}</td>
            <td>
              <button
                class="btn btn-primary"
                type="button"
                @click="jumpToTenant(item.tenantId)"
              >
                切到该租户
              </button>
            </td>
          </tr>
          <tr v-if="!loading && filteredTenants.length === 0">
            <td
              colspan="5"
              class="empty"
            >
              暂无租户数据
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.platform-console {
  display: grid;
  gap: 14px;
}

.platform-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.platform-head h2 {
  margin: 0;
}

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.kpi-card {
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  background: #fff;
  padding: 12px;
}

.kpi-label {
  margin: 0;
  font-size: 12px;
  color: #64748b;
}

.kpi-value {
  margin: 8px 0 0;
  font-size: 28px;
  font-weight: 700;
  color: #0f172a;
}

.tenant-panel {
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  background: #fff;
  padding: 12px;
}

.tenant-onboarding {
  border: 1px solid #dbeafe;
  border-radius: 10px;
  background: #f8fbff;
  padding: 12px;
  display: grid;
  gap: 10px;
}

.tenant-onboarding-head h3 {
  margin: 0;
  font-size: 16px;
}

.tenant-onboarding-head p {
  margin: 6px 0 0;
  color: #475569;
  font-size: 13px;
}

.tenant-onboarding-form {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tenant-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.tenant-toolbar h3 {
  margin: 0;
  white-space: nowrap;
}

.tenant-create-input {
  width: 260px;
}

.tenant-search {
  width: 220px;
}

.tenant-table {
  width: 100%;
  border-collapse: collapse;
}

.tenant-table th,
.tenant-table td {
  border-bottom: 1px solid #f1f5f9;
  padding: 10px 8px;
  text-align: left;
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

.empty {
  text-align: center;
  color: #94a3b8;
}

.error {
  margin: 0;
  color: #b91c1c;
  font-size: 13px;
}
</style>
