<script setup lang="ts">
import { CopyDocument, Delete, EditPen, Plus, Refresh } from '@element-plus/icons-vue'
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { withAdminAuthHeaders } from '../composables/useAdminApi'
import { donePageProgress, startPageProgress } from '../utils/progress'

interface TrafficChannelRow {
  id: string
  code: string
  name: string
  remark: string
  disabled: boolean
  createdAt: string
  updatedAt: string
  registerCount: number
}

const MALL_API_BASE = `${(import.meta.env.VITE_MALL_API_BASE || 'http://localhost:3110/api').replace(/\/$/, '')}`

/** 商城 H5 根地址（build 时注入）。未配置时退回 window.location.origin，本地后台与商城不同端口时请设 VITE_MALL_H5_ORIGIN */
const MALL_H5_ORIGIN = (import.meta.env.VITE_MALL_H5_ORIGIN || '').replace(/\/$/, '')

const isViteDev = import.meta.env.DEV

const showH5OriginDevHint = computed(
  () => isViteDev && !MALL_H5_ORIGIN,
)

const h5BaseForLink = computed(() => {
  if (MALL_H5_ORIGIN)
    return MALL_H5_ORIGIN
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin.replace(/\/$/, '')
  }
  return ''
})

const loading = ref(false)
const rows = ref<TrafficChannelRow[]>([])
const showCreate = ref(false)
const showEdit = ref(false)
const submitting = ref(false)
const deleteTarget = ref<TrafficChannelRow | null>(null)
const showDeleteDialog = ref(false)
const deleting = ref(false)
const errorMessage = ref('')

const createForm = reactive({
  code: '',
  name: '',
  remark: '',
  disabled: false,
})

const editForm = reactive({
  id: '',
  name: '',
  remark: '',
  disabled: false,
})

function promotionPathAndQuery(code: string) {
  return `/?channel=${encodeURIComponent(code)}`
}

function fullPromotionUrl(code: string) {
  const base = h5BaseForLink.value
  return base ? `${base}${promotionPathAndQuery(code)}` : promotionPathAndQuery(code)
}

async function copyPromotionLink(code: string) {
  const full = fullPromotionUrl(code)
  try {
    await navigator.clipboard.writeText(full)
    ElMessage.success('推广链接已复制')
  }
  catch {
    ElMessage.error('复制失败，请手动复制')
  }
}

function formatDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  const yyyy = date.getFullYear()
  const mm = `${date.getMonth() + 1}`.padStart(2, '0')
  const dd = `${date.getDate()}`.padStart(2, '0')
  const hh = `${date.getHours()}`.padStart(2, '0')
  const min = `${date.getMinutes()}`.padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`
}

async function fetchChannels() {
  loading.value = true
  startPageProgress()
  errorMessage.value = ''
  try {
    const response = await fetch(`${MALL_API_BASE}/admin/traffic-channels`, {
      method: 'GET',
      headers: withAdminAuthHeaders(),
    })
    const payload = await response.json() as {
      success?: boolean
      msg?: string
      data?: TrafficChannelRow[]
    }
    if (!response.ok || payload.success === false) {
      const msg = payload.msg || `加载失败 (${response.status})`
      if (response.status === 401 || response.status === 403) {
        throw new Error(`${msg} — 请使用超级管理员登录`)
      }
      throw new Error(msg)
    }
    rows.value = Array.isArray(payload.data) ? payload.data : []
  }
  catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '加载失败'
    rows.value = []
    ElMessage.error(errorMessage.value)
  }
  finally {
    loading.value = false
    donePageProgress()
  }
}

function openCreate() {
  showCreate.value = true
  createForm.code = ''
  createForm.name = ''
  createForm.remark = ''
  createForm.disabled = false
  errorMessage.value = ''
}

function closeCreate() {
  if (submitting.value)
    return
  showCreate.value = false
}

function openEdit(row: TrafficChannelRow) {
  showEdit.value = true
  editForm.id = row.id
  editForm.name = row.name
  editForm.remark = row.remark || ''
  editForm.disabled = row.disabled
  errorMessage.value = ''
}

function closeEdit() {
  if (submitting.value)
    return
  showEdit.value = false
}

async function submitCreate() {
  if (submitting.value)
    return
  submitting.value = true
  errorMessage.value = ''
  try {
    const response = await fetch(`${MALL_API_BASE}/admin/traffic-channels`, {
      method: 'POST',
      headers: withAdminAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        code: createForm.code.trim(),
        name: createForm.name.trim(),
        remark: createForm.remark.trim(),
        disabled: createForm.disabled,
      }),
    })
    const payload = await response.json() as { msg?: string }
    if (!response.ok) {
      throw new Error(payload.msg || `创建失败: ${response.status}`)
    }
    ElMessage.success('渠道已创建')
    showCreate.value = false
    await fetchChannels()
  }
  catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '创建失败'
    ElMessage.error(errorMessage.value)
  }
  finally {
    submitting.value = false
  }
}

async function submitEdit() {
  if (submitting.value)
    return
  submitting.value = true
  errorMessage.value = ''
  try {
    const response = await fetch(`${MALL_API_BASE}/admin/traffic-channels/${encodeURIComponent(editForm.id)}`, {
      method: 'PATCH',
      headers: withAdminAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        name: editForm.name.trim(),
        remark: editForm.remark.trim(),
        disabled: editForm.disabled,
      }),
    })
    const payload = await response.json() as { msg?: string }
    if (!response.ok) {
      throw new Error(payload.msg || `保存失败: ${response.status}`)
    }
    ElMessage.success('已保存')
    showEdit.value = false
    await fetchChannels()
  }
  catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '保存失败'
    ElMessage.error(errorMessage.value)
  }
  finally {
    submitting.value = false
  }
}

function openDelete(row: TrafficChannelRow) {
  deleteTarget.value = row
  showDeleteDialog.value = true
}

function closeDelete() {
  if (deleting.value)
    return
  showDeleteDialog.value = false
  deleteTarget.value = null
}

async function doDelete() {
  const row = deleteTarget.value
  if (!row || deleting.value)
    return
  deleting.value = true
  try {
    const response = await fetch(`${MALL_API_BASE}/admin/traffic-channels/${encodeURIComponent(row.id)}`, {
      method: 'DELETE',
      headers: withAdminAuthHeaders(),
    })
    const payload = await response.json() as { msg?: string }
    if (!response.ok) {
      throw new Error(payload.msg || `删除失败: ${response.status}`)
    }
    ElMessage.success('已删除')
    closeDelete()
    await fetchChannels()
  }
  catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '删除失败')
  }
  finally {
    deleting.value = false
  }
}

onMounted(() => {
  void fetchChannels()
})
</script>

<template>
  <div class="panel traffic-page">
    <el-alert
      type="info"
      :closable="false"
      show-icon
      class="traffic-alert"
    >
      <template #title>
        <span class="traffic-alert__title">使用说明</span>
      </template>
      <p class="traffic-alert__body">
        创建渠道后填写<strong>名称</strong>（将写入注册用户档案并在「注册用户」列表<strong>注册渠道</strong>列展示）。把专属链接发给合作方，用户通过
        <code class="traffic-code">?channel=渠道标识</code>
        进入 H5 后完成注册即计入该渠道；未在后台配置或已停用的标识不会写入用户。
      </p>
    </el-alert>

    <el-alert
      v-if="showH5OriginDevHint"
      type="warning"
      :closable="false"
      show-icon
      class="traffic-h5-hint"
    >
      未设置
      <code class="traffic-code">VITE_MALL_H5_ORIGIN</code>
      时，推广链接会使用<strong>当前浏览器这个标签页</strong>的地址。若商城跑在
      <code class="traffic-code">http://localhost:5174</code>
      而本后台在其它端口，请在
      <code class="traffic-code">admin</code>
      目录新增
      <code class="traffic-code">.env.development</code>
      写入一行（端口按你本机为准）：
      <code class="traffic-code traffic-code--block">VITE_MALL_H5_ORIGIN=http://localhost:5174</code>
      保存后<strong>重启</strong>
      <code class="traffic-code">npm run dev</code>
      。
    </el-alert>

    <div class="toolbar">
      <el-button
        type="primary"
        :icon="Plus"
        :loading="loading"
        @click="openCreate"
      >
        新建渠道
      </el-button>
      <el-button
        :icon="Refresh"
        :loading="loading"
        @click="fetchChannels"
      >
        刷新
      </el-button>
    </div>

    <el-alert
      v-if="errorMessage && !loading"
      type="error"
      :closable="false"
      show-icon
      class="traffic-error"
    >
      {{ errorMessage }}
    </el-alert>

    <div
      v-loading="loading"
      class="table-wrap"
    >
      <el-table
        :data="rows"
        stripe
        border
        size="small"
        class="traffic-table"
        empty-text=""
      >
        <template #empty>
          <el-empty
            description="暂无渠道，点击「新建渠道」添加"
            :image-size="72"
          />
        </template>

        <el-table-column
          label="渠道标识"
          min-width="108"
        >
          <template #default="{ row }">
            <el-tag
              type="info"
              effect="plain"
              class="code-tag"
            >
              {{ row.code }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column
          prop="name"
          label="名称"
          min-width="100"
          show-overflow-tooltip
        />

        <el-table-column
          prop="registerCount"
          label="注册人数"
          width="96"
          align="center"
        />

        <el-table-column
          label="状态"
          width="88"
          align="center"
        >
          <template #default="{ row }">
            <el-tag
              :type="row.disabled ? 'info' : 'success'"
              effect="light"
              round
              size="small"
            >
              {{ row.disabled ? '已停用' : '启用' }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column
          label="推广链接"
          min-width="260"
        >
          <template #default="{ row }">
            <div class="link-cell">
              <el-tooltip
                :content="fullPromotionUrl(row.code)"
                placement="top"
                :show-after="300"
              >
                <el-text
                  class="link-cell__url"
                  truncated
                >
                  {{ fullPromotionUrl(row.code) }}
                </el-text>
              </el-tooltip>
              <el-button
                type="primary"
                link
                size="small"
                :icon="CopyDocument"
                @click="copyPromotionLink(row.code)"
              >
                复制
              </el-button>
            </div>
          </template>
        </el-table-column>

        <el-table-column
          prop="remark"
          label="备注"
          min-width="120"
          show-overflow-tooltip
        >
          <template #default="{ row }">
            {{ row.remark || '—' }}
          </template>
        </el-table-column>

        <el-table-column
          label="创建时间"
          width="156"
        >
          <template #default="{ row }">
            {{ formatDateTime(row.createdAt) }}
          </template>
        </el-table-column>

        <el-table-column
          label="操作"
          width="132"
          fixed="right"
          align="center"
        >
          <template #default="{ row }">
            <el-space
              :size="4"
              spacer="|"
            >
              <el-button
                type="primary"
                link
                size="small"
                :icon="EditPen"
                @click="openEdit(row)"
              >
                编辑
              </el-button>
              <el-button
                type="danger"
                link
                size="small"
                :icon="Delete"
                :disabled="row.registerCount > 0"
                @click="openDelete(row)"
              >
                删除
              </el-button>
            </el-space>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog
      v-model="showCreate"
      title="新建渠道"
      width="520px"
      destroy-on-close
      align-center
      class="traffic-dialog"
      @close="closeCreate"
    >
      <el-form
        label-position="top"
        class="traffic-form"
        @submit.prevent
      >
        <el-form-item
          label="渠道标识"
          required
        >
          <el-input
            v-model="createForm.code"
            placeholder="2～40 位，如 partner_a、shop01"
            maxlength="40"
            show-word-limit
            clearable
          />
        </el-form-item>
        <el-form-item
          label="名称"
          required
        >
          <el-input
            v-model="createForm.name"
            placeholder="显示名称"
            clearable
          />
        </el-form-item>
        <el-form-item label="备注">
          <el-input
            v-model="createForm.remark"
            type="textarea"
            :rows="3"
            placeholder="选填"
            maxlength="200"
            show-word-limit
          />
        </el-form-item>
        <el-form-item label="创建后停用">
          <el-switch
            v-model="createForm.disabled"
            inline-prompt
            active-text="停"
            inactive-text="启"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="closeCreate">
          取消
        </el-button>
        <el-button
          type="primary"
          :loading="submitting"
          @click="submitCreate"
        >
          创建
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="showEdit"
      title="编辑渠道"
      width="520px"
      destroy-on-close
      align-center
      class="traffic-dialog"
      @close="closeEdit"
    >
      <el-alert
        type="warning"
        :closable="false"
        show-icon
        class="dialog-tip"
      >
        渠道标识不可修改；统计以标识为准。
      </el-alert>
      <el-form
        label-position="top"
        class="traffic-form"
        @submit.prevent
      >
        <el-form-item
          label="名称"
          required
        >
          <el-input
            v-model="editForm.name"
            clearable
          />
        </el-form-item>
        <el-form-item label="备注">
          <el-input
            v-model="editForm.remark"
            type="textarea"
            :rows="3"
            placeholder="选填"
            maxlength="200"
            show-word-limit
          />
        </el-form-item>
        <el-form-item label="停用渠道">
          <el-switch
            v-model="editForm.disabled"
            inline-prompt
            active-text="停"
            inactive-text="启"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="closeEdit">
          取消
        </el-button>
        <el-button
          type="primary"
          :loading="submitting"
          @click="submitEdit"
        >
          保存
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="showDeleteDialog"
      title="删除渠道"
      width="420px"
      align-center
      @close="closeDelete"
    >
      <p class="delete-confirm-text">
        确定删除「{{ deleteTarget?.name }}」？
      </p>
      <el-alert
        v-if="deleteTarget && deleteTarget.registerCount > 0"
        type="error"
        :closable="false"
        show-icon
      >
        该渠道已有注册记录，无法删除。
      </el-alert>
      <template #footer>
        <el-button @click="closeDelete">
          取消
        </el-button>
        <el-button
          type="danger"
          :disabled="!deleteTarget || deleteTarget.registerCount > 0"
          :loading="deleting"
          @click="doDelete"
        >
          删除
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.traffic-page {
  max-width: 100%;
}

.traffic-alert {
  margin-bottom: 16px;
  border-radius: 8px;
}

.traffic-h5-hint {
  margin-bottom: 16px;
  border-radius: 8px;
}

.traffic-h5-hint :deep(.el-alert__description),
.traffic-h5-hint .traffic-code--block {
  display: block;
  margin-top: 8px;
  word-break: break-all;
}

.traffic-alert__title {
  font-weight: 600;
}

.traffic-alert__body {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--el-text-color-regular);
}

.traffic-code {
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(139, 107, 74, 0.1);
  font-size: 12px;
  font-family: ui-monospace, monospace;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 16px;
}

.traffic-error {
  margin-bottom: 12px;
  border-radius: 8px;
}

.table-wrap {
  min-height: 160px;
}

.traffic-table {
  width: 100%;
  font-size: 13px;
}

.code-tag {
  font-family: ui-monospace, monospace;
  font-weight: 500;
}

.link-cell {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  max-width: 100%;
}

.link-cell__url {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.dialog-tip {
  margin-bottom: 16px;
  border-radius: 8px;
}

.traffic-form {
  padding-top: 4px;
}

.delete-confirm-text {
  margin: 0 0 12px;
  font-size: 14px;
  color: var(--el-text-color-primary);
}

.panel :deep(.traffic-dialog .el-dialog__body) {
  padding-top: 8px;
}

.panel :deep(.traffic-table .el-table__cell) {
  vertical-align: middle;
}
</style>
