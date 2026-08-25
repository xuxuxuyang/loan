<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Document } from '@element-plus/icons-vue'
import {
  fetchAdminSecurityAuditLog,
  fetchAdminSecurityAuditLogs,
  type AdminSecurityAuditLog,
  type AdminSecurityLogStatus,
} from '../api/adminSecurity'

/** 只读数据源：GET /admin/security/audit-logs */
const loading = ref(false)
const detailLoading = ref(false)
const rows = ref<AdminSecurityAuditLog[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(50)
const operationDate = ref<Date>(new Date())
const drawerVisible = ref(false)
const detail = ref<AdminSecurityAuditLog | null>(null)

function selectedDayRange(value: Date) {
  const from = new Date(value)
  const to = new Date(value)
  from.setHours(0, 0, 0, 0)
  to.setHours(23, 59, 59, 999)
  return { from: from.toISOString(), to: to.toISOString() }
}

function roleLabel(role?: string) {
  if (role === 'super_admin') return '超级管理员'
  if (role === 'boss') return '老板'
  if (role === 'reviewer') return '审核员'
  if (role === 'collector') return '催收员'
  return role || '管理员'
}

function statusView(value: AdminSecurityLogStatus) {
  if (value === 'success') return { label: '成功', type: 'success' as const }
  if (value === 'blocked') return { label: '已拦截', type: 'danger' as const }
  if (value === 'failed') return { label: '失败', type: 'danger' as const }
  return { label: '处理中', type: 'warning' as const }
}

function verificationLabel(value?: string) {
  if (value === 'sms') return '本次短信'
  if (value === 'repayment_window') return '5分钟凭证'
  if (value === 'audit') return '仅记录'
  if (value === 'off') return '未启用'
  return value || '-'
}

function formatTime(value?: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(date)
}

function formatFullTime(value?: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(date).replaceAll('/', '-')
}

function targetTitle(row: AdminSecurityAuditLog) {
  const target = row.target || {}
  return target.userName || target.phoneMasked || target.orderId || target.userId || target.view || '-'
}

function targetMeta(row: AdminSecurityAuditLog) {
  const parts = []
  if (row.target?.phoneMasked) parts.push(row.target.phoneMasked)
  if (row.target?.orderId) parts.push(row.target.orderId)
  if (row.target?.period) parts.push(`第 ${row.target.period} 期`)
  if (row.target?.historyIndex !== undefined) parts.push(`协商记录 ${row.target.historyIndex + 1}`)
  return parts.join(' · ') || '-'
}

function displayChangeValue(value: unknown) {
  if (value === null || value === undefined || value === '') return '-'
  if (typeof value === 'boolean') return value ? '是' : '否'
  return String(value)
}

async function loadLogs() {
  if (loading.value) return
  loading.value = true
  try {
    const range = selectedDayRange(operationDate.value)
    const result = await fetchAdminSecurityAuditLogs({
      ...range,
      page: page.value,
      pageSize: pageSize.value,
    })
    rows.value = result.items
    total.value = result.total
  }
  catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '读取操作记录失败')
  }
  finally {
    loading.value = false
  }
}

function changeOperationDate() {
  page.value = 1
  void loadLogs()
}

async function openDetail(row: AdminSecurityAuditLog) {
  drawerVisible.value = true
  detail.value = row
  detailLoading.value = true
  try {
    detail.value = await fetchAdminSecurityAuditLog(row.id)
  }
  catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '读取操作详情失败')
  }
  finally {
    detailLoading.value = false
  }
}

onMounted(() => {
  void loadLogs()
})
</script>

<template>
  <div class="operation-logs-page">
    <section class="operation-logs-page__toolbar">
      <label class="operation-date-filter">
        <span>操作日期</span>
        <el-date-picker
          v-model="operationDate"
          type="date"
          format="YYYY年MM月DD日"
          :clearable="false"
          :editable="false"
          :disabled="loading"
          @change="changeOperationDate"
        />
      </label>
      <span class="operation-count">当日共 <strong>{{ total }}</strong> 条</span>
    </section>

    <section class="operation-logs-page__table-card">
      <el-table v-loading="loading" :data="rows" empty-text="当日暂无操作记录">
        <el-table-column label="时间" width="110">
          <template #default="{ row }"><span class="mono time-cell">{{ formatTime(row.createdAt) }}</span></template>
        </el-table-column>
        <el-table-column label="操作人 / 角色" min-width="160">
          <template #default="{ row }">
            <div class="stack-cell"><strong>{{ row.actor?.name || row.actor?.username || '-' }}</strong><span>{{ roleLabel(row.actor?.role) }}</span></div>
          </template>
        </el-table-column>
        <el-table-column label="操作类型" min-width="140">
          <template #default="{ row }"><span class="action-pill">{{ row.actionLabel }}</span></template>
        </el-table-column>
        <el-table-column label="操作对象" min-width="200">
          <template #default="{ row }">
            <div class="stack-cell"><strong>{{ targetTitle(row) }}</strong><span class="mono">{{ targetMeta(row) }}</span></div>
          </template>
        </el-table-column>
        <el-table-column label="变更内容" min-width="250" show-overflow-tooltip prop="summary" />
        <el-table-column label="IP" width="145">
          <template #default="{ row }"><span class="mono">{{ row.ip || '-' }}</span></template>
        </el-table-column>
        <el-table-column label="结果" width="90">
          <template #default="{ row }">
            <el-tag :type="statusView(row.status).type" size="small">{{ statusView(row.status).label }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="详情" fixed="right" width="76">
          <template #default="{ row }"><el-button link type="primary" @click="openDetail(row)">详情</el-button></template>
        </el-table-column>
      </el-table>

      <div class="operation-logs-page__pagination">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :total="total"
          :page-sizes="[20, 50, 100]"
          layout="sizes, prev, pager, next"
          @change="loadLogs"
        />
      </div>
    </section>

    <el-drawer v-model="drawerVisible" title="操作详情" size="520px" class="operation-log-drawer">
      <div v-loading="detailLoading" class="operation-log-detail">
        <div class="detail-head">
          <el-icon><Document /></el-icon>
          <div><strong>{{ detail?.actionLabel || '-' }}</strong><span class="mono">{{ detail?.requestId || '-' }}</span></div>
          <el-tag v-if="detail" :type="statusView(detail.status).type">{{ statusView(detail.status).label }}</el-tag>
        </div>
        <dl v-if="detail" class="detail-grid">
          <dt>操作人</dt><dd>{{ detail.actor?.name || detail.actor?.username || '-' }} / {{ roleLabel(detail.actor?.role) }}</dd>
          <dt>操作时间</dt><dd>{{ formatFullTime(detail.createdAt) }}</dd>
          <dt>可信 IP</dt><dd class="mono">{{ detail.ip || '-' }}</dd>
          <dt>验证方式</dt><dd>{{ verificationLabel(detail.verificationMode) }}</dd>
          <dt>用户</dt><dd>{{ detail.target?.userName || '-' }} {{ detail.target?.phoneMasked || '' }}</dd>
          <dt>订单 / 期次</dt><dd class="mono">{{ detail.target?.orderId || '-' }}<template v-if="detail.target?.period"> · 第 {{ detail.target.period }} 期</template></dd>
          <dt>操作编号</dt><dd class="mono">{{ detail.id }}</dd>
          <dt>User-Agent</dt><dd class="ua-text">{{ detail.userAgent || '-' }}</dd>
        </dl>
        <div v-if="detail?.changes?.length" class="detail-changes">
          <h3>前后变化</h3>
          <div v-for="item in detail.changes" :key="item.label" class="detail-change-row">
            <span>{{ item.label || '变更' }}</span><strong>{{ displayChangeValue(item.before) }}</strong><b>→</b><strong class="after">{{ displayChangeValue(item.after) }}</strong>
          </div>
        </div>
        <div v-if="detail?.error" class="detail-error"><strong>失败原因</strong><p>{{ detail.error }}</p></div>
        <div v-if="detail" class="detail-summary"><strong>操作摘要</strong><p>{{ detail.summary || '-' }}</p></div>
      </div>
    </el-drawer>
  </div>
</template>

<style scoped>
.operation-logs-page { --trace-red: #a91025; display: flex; min-width: 0; flex-direction: column; gap: 12px; }
.operation-logs-page__toolbar { display: flex; flex: none; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 16px; border: 1px solid #e5e7eb; border-radius: 10px; background: #fff; }
.operation-date-filter { display: flex; align-items: center; gap: 12px; color: #374151; font-size: 14px; font-weight: 600; }
.operation-date-filter :deep(.el-date-editor) { width: 190px; }
.operation-count { color: #6b7280; font-size: 13px; white-space: nowrap; }
.operation-count strong { color: #1f2937; font-size: 15px; }
.operation-logs-page__table-card { flex: 1; min-width: 0; min-height: 0; overflow: hidden; border: 1px solid #e5e7eb; border-radius: 10px; background: #fff; }
.operation-logs-page__table-card :deep(.el-table__header th.el-table__cell) { color: #4b5563; background: #f7f8fa; font-weight: 600; }
.operation-logs-page__pagination { display: flex; justify-content: flex-end; align-items: center; padding: 12px 16px; border-top: 1px solid #eef0f4; overflow-x: auto; }
.mono { font-family: "JetBrains Mono", "Cascadia Code", monospace; font-size: 12px; }
.time-cell { color: #4b5565; }
.stack-cell { display: grid; gap: 3px; }
.stack-cell strong { color: #20283a; font-size: 13px; }
.stack-cell span { color: #8b93a2; font-size: 12px; }
.action-pill { color: #8f1527; font-weight: 600; font-size: 13px; }
.operation-log-detail { min-height: 260px; }
.detail-head { display: grid; grid-template-columns: 36px 1fr auto; gap: 12px; align-items: center; padding: 14px; border: 1px solid #e5e7eb; border-radius: 10px; color: #1f2937; background: #f8fafc; }
.detail-head > .el-icon { color: var(--trace-red); font-size: 22px; }
.detail-head > div { display: grid; gap: 4px; min-width: 0; }
.detail-head span { overflow: hidden; color: #6b7280; text-overflow: ellipsis; white-space: nowrap; }
.detail-grid { display: grid; grid-template-columns: 100px 1fr; margin: 18px 0; border: 1px solid #eaedf2; border-radius: 12px; overflow: hidden; }
.detail-grid dt,.detail-grid dd { margin: 0; padding: 11px 13px; border-bottom: 1px solid #edf0f4; }
.detail-grid dt { color: #747c8b; background: #f8fafc; font-size: 12px; }
.detail-grid dd { color: #252d3d; font-size: 13px; word-break: break-word; }
.ua-text { line-height: 1.6; }
.detail-changes,.detail-error,.detail-summary { margin-top: 14px; padding: 15px; border: 1px solid #e9ecf2; border-radius: 12px; }
.detail-changes h3 { margin: 0 0 12px; font-size: 14px; }
.detail-change-row { display: grid; grid-template-columns: 100px 1fr 22px 1fr; gap: 8px; padding: 8px 0; border-top: 1px dashed #e4e7ed; font-size: 13px; }
.detail-change-row:first-of-type { border-top: 0; }
.detail-change-row > span { color: #7d8492; }
.detail-change-row b { color: #a0a7b4; text-align: center; }
.detail-change-row .after { color: var(--trace-red); }
.detail-error { border-color: #fecaca; color: #991b1b; background: #fef2f2; }
.detail-error p,.detail-summary p { margin: 7px 0 0; line-height: 1.65; }
@media (max-width: 760px) { .operation-logs-page__toolbar { align-items: flex-start; flex-direction: column; gap: 10px; } .operation-date-filter { width: 100%; justify-content: space-between; } .operation-date-filter :deep(.el-date-editor) { flex: 1; max-width: 220px; } .operation-logs-page__pagination { justify-content: flex-start; } :global(.operation-log-drawer) { width: 100% !important; } }
</style>
