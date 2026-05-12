<script setup lang="ts">
import { CirclePlus, CopyDocument, Delete, EditPen, Loading, Plus, Refresh } from '@element-plus/icons-vue'
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import TrafficChannelNameTag from '../components/TrafficChannelNameTag.vue'
import { withAdminAuthHeaders } from '../composables/useAdminApi'
import { donePageProgress, startPageProgress } from '../utils/progress'
import { trafficChannelDisplayKey } from '../utils/trafficChannelTagStyle'

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

/** 与待收明细等页 `el-table` 表头风格一致 */
const tableHeaderCellStyle = {
  background: 'var(--el-fill-color-light)',
  color: 'var(--el-text-color-primary)',
  fontWeight: 600 as const,
}

const loading = ref(false)
const rows = ref<TrafficChannelRow[]>([])
const showCreate = ref(false)
const showEdit = ref(false)
const submitting = ref(false)
const deleteTarget = ref<TrafficChannelRow | null>(null)
const showDeleteDialog = ref(false)
const deleting = ref(false)
const errorMessage = ref('')

const remarkDialogVisible = ref(false)
const remarkSaving = ref(false)
const remarkTarget = ref<TrafficChannelRow | null>(null)
const remarkDraft = ref('')

/** 正在 PATCH 状态的渠道 id，用于行内状态标签 loading */
const statusBusyId = ref<string | null>(null)

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

async function toggleChannelDisabled(row: TrafficChannelRow) {
  if (statusBusyId.value === row.id)
    return
  const nextDisabled = !row.disabled
  statusBusyId.value = row.id
  try {
    const response = await fetch(`${MALL_API_BASE}/admin/traffic-channels/${encodeURIComponent(row.id)}`, {
      method: 'PATCH',
      headers: withAdminAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ disabled: nextDisabled }),
    })
    const payload = await response.json() as { msg?: string; data?: TrafficChannelRow }
    if (!response.ok) {
      throw new Error(payload.msg || `操作失败: ${response.status}`)
    }
    const data = payload.data
    if (data) {
      const idx = rows.value.findIndex(r => r.id === row.id)
      if (idx >= 0)
        rows.value[idx] = { ...rows.value[idx], ...data }
    }
    ElMessage.success(nextDisabled ? '已停用' : '已启用')
  }
  catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '操作失败')
  }
  finally {
    statusBusyId.value = null
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

function openRemarkDialog(row: TrafficChannelRow) {
  remarkTarget.value = row
  remarkDraft.value = typeof row.remark === 'string' ? row.remark : ''
  remarkDialogVisible.value = true
}

function resetRemarkDialog() {
  remarkDialogVisible.value = false
  remarkTarget.value = null
  remarkDraft.value = ''
}

function closeRemarkDialog() {
  if (remarkSaving.value)
    return
  resetRemarkDialog()
}

function remarkDialogBeforeClose(done: () => void) {
  if (remarkSaving.value)
    return
  remarkTarget.value = null
  remarkDraft.value = ''
  done()
}

async function saveChannelRemark() {
  if (!remarkTarget.value || remarkSaving.value)
    return
  const row = remarkTarget.value
  remarkSaving.value = true
  try {
    const response = await fetch(`${MALL_API_BASE}/admin/traffic-channels/${encodeURIComponent(row.id)}`, {
      method: 'PATCH',
      headers: withAdminAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ remark: remarkDraft.value.trim() }),
    })
    const payload = await response.json() as { msg?: string }
    if (!response.ok) {
      throw new Error(payload.msg || `保存备注失败: ${response.status}`)
    }
    ElMessage.success('备注已保存')
    resetRemarkDialog()
    await fetchChannels()
  }
  catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '保存备注失败')
  }
  finally {
    remarkSaving.value = false
  }
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

    <el-card
      class="traffic-table-card"
      shadow="hover"
    >
      <template #header>
        <div class="traffic-table-card-header">
          <span class="traffic-table-card-title">渠道列表</span>
          <el-tag
            v-if="rows.length"
            type="info"
            effect="plain"
            size="small"
          >
            共 {{ rows.length }} 个
          </el-tag>
        </div>
      </template>

      <div class="traffic-table-wrap">
        <el-table
          v-loading="loading"
          :data="rows"
          stripe
          border
          size="default"
          class="traffic-table"
          :header-cell-style="tableHeaderCellStyle"
          :highlight-current-row="true"
          empty-text=""
        >
          <template #empty>
            <el-empty
              description="暂无渠道，点击「新建渠道」添加"
              :image-size="88"
            />
          </template>

        <el-table-column
          label="创建时间"
          width="156"
        >
          <template #default="{ row }">
            {{ formatDateTime(row.createdAt) }}
          </template>
        </el-table-column>

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
          label="名称"
          min-width="120"
          show-overflow-tooltip
        >
          <template #default="{ row }">
            <TrafficChannelNameTag
              :display-key="trafficChannelDisplayKey(undefined, row.name, row.code)"
              size="default"
            />
          </template>
        </el-table-column>

        <el-table-column
          prop="registerCount"
          label="注册人数"
          width="96"
          align="center"
        />

        <el-table-column
          label="状态"
          width="100"
          align="center"
        >
          <template #default="{ row }">
            <el-tooltip
              :content="row.disabled ? '点击启用' : '点击停用'"
              placement="top"
              :show-after="400"
            >
              <el-tag
                role="button"
                tabindex="0"
                :type="row.disabled ? 'info' : 'success'"
                effect="light"
                round
                size="small"
                class="status-tag-clickable"
                :class="{ 'status-tag-clickable--busy': statusBusyId === row.id }"
                @click="toggleChannelDisabled(row)"
                @keydown.enter.prevent="toggleChannelDisabled(row)"
                @keydown.space.prevent="toggleChannelDisabled(row)"
              >
                <el-icon
                  v-if="statusBusyId === row.id"
                  class="status-tag-clickable__spin"
                >
                  <Loading />
                </el-icon>
                <template v-else>
                  {{ row.disabled ? '已停用' : '启用' }}
                </template>
              </el-tag>
            </el-tooltip>
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
          label="备注"
          min-width="160"
          class-name="traffic-remark-col"
        >
          <template #default="{ row }">
            <el-button
              type="primary"
              link
              class="remark-table-trigger"
              :title="row.remark?.trim() ? '点击编辑备注' : '点击添加备注'"
              @click="openRemarkDialog(row)"
            >
              <span class="remark-cell">
                <span
                  class="remark-cell__icon-wrap"
                  aria-hidden="true"
                >
                  <el-icon
                    class="remark-cell__icon"
                    :class="row.remark?.trim() ? 'remark-cell__icon--edit' : 'remark-cell__icon--add'"
                    :size="17"
                  >
                    <EditPen v-if="row.remark?.trim()" />
                    <CirclePlus v-else />
                  </el-icon>
                </span>
                <span
                  class="remark-cell__text remark-preview"
                  :class="{ 'remark-preview--empty': !row.remark?.trim() }"
                >{{ row.remark?.trim() ? row.remark : '—' }}</span>
              </span>
            </el-button>
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
                :title="row.registerCount > 0 ? `已有 ${row.registerCount} 人通过该渠道注册，为保留统计归因不可删除；可先停用渠道` : '删除渠道'"
                @click="openDelete(row)"
              >
                删除
              </el-button>
            </el-space>
          </template>
        </el-table-column>
      </el-table>
      </div>
    </el-card>

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
        <el-alert
          type="info"
          :closable="false"
          show-icon
          class="dialog-tip dialog-tip--compact"
        >
          启用 / 停用请在列表「状态」列点击标签切换。
        </el-alert>
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
      v-model="remarkDialogVisible"
      title="渠道备注"
      width="480px"
      destroy-on-close
      align-center
      class="traffic-dialog"
      :close-on-click-modal="!remarkSaving"
      :close-on-press-escape="!remarkSaving"
      :before-close="remarkDialogBeforeClose"
    >
      <p
        v-if="remarkTarget"
        class="remark-dialog-hint"
      >
        {{ remarkTarget.name }}
        <el-tag
          type="info"
          effect="plain"
          size="small"
          class="remark-dialog-code"
        >
          {{ remarkTarget.code }}
        </el-tag>
      </p>
      <el-input
        v-model="remarkDraft"
        type="textarea"
        :rows="4"
        maxlength="200"
        show-word-limit
        placeholder="选填，仅后台可见"
        :disabled="remarkSaving"
      />
      <template #footer>
        <el-button
          :disabled="remarkSaving"
          @click="closeRemarkDialog"
        >
          取消
        </el-button>
        <el-button
          type="primary"
          :loading="remarkSaving"
          @click="saveChannelRemark"
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

.traffic-table-card {
  border-radius: 8px;
}

.traffic-table-card :deep(.el-card__header) {
  padding: 14px 18px;
}

.traffic-table-card :deep(.el-card__body) {
  padding: 0 18px 18px;
}

.traffic-table-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.traffic-table-card-title {
  font-weight: 600;
  font-size: 15px;
  color: var(--el-text-color-primary);
}

.traffic-table-wrap {
  min-height: 120px;
  overflow-x: auto;
}

.traffic-table {
  width: 100%;
  min-width: 880px;
}

.traffic-table :deep(.el-table__row:hover > td) {
  background-color: var(--el-fill-color-lighter) !important;
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
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.dialog-tip {
  margin-bottom: 16px;
  border-radius: 8px;
}

.dialog-tip--compact {
  margin-top: 8px;
  margin-bottom: 0;
}

.status-tag-clickable {
  cursor: pointer;
  user-select: none;
  transition: opacity 0.15s ease, transform 0.12s ease;
}

.status-tag-clickable:hover:not(.status-tag-clickable--busy) {
  filter: brightness(0.97);
}

.status-tag-clickable:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}

.status-tag-clickable--busy {
  cursor: wait;
  pointer-events: none;
  opacity: 0.88;
}

.status-tag-clickable__spin {
  display: block;
  font-size: 14px;
  animation: traffic-status-spin 0.9s linear infinite;
}

@keyframes traffic-status-spin {
  to {
    transform: rotate(360deg);
  }
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

.panel :deep(.traffic-table .traffic-remark-col) {
  vertical-align: top;
}

.remark-dialog-hint {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--el-text-color-regular);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.remark-dialog-code {
  font-family: ui-monospace, monospace;
}

.remark-preview {
  margin: 0;
  font-size: 13px;
  color: #f10202;
  line-height: 1.45;
  max-height: 4.35em;
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  word-break: break-word;
}

.remark-preview--empty {
  color: #000;
}

.remark-cell {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  max-width: 100%;
  text-align: left;
}

.remark-cell__icon-wrap {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  padding-top: 2px;
}

.remark-cell__icon {
  vertical-align: middle;
}

.remark-cell__icon--add {
  color: #059669;
}

.remark-cell__icon--edit {
  color: #64748b;
}

.remark-table-trigger {
  height: auto;
  padding: 2px 6px 2px 2px;
  margin: 0;
  justify-content: flex-start;
  max-width: 100%;
  font-weight: inherit;
}

.remark-table-trigger :deep(.el-button__inner) {
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
  width: 100%;
  min-width: 0;
}

.remark-table-trigger:hover .remark-cell__icon--add {
  color: #047857;
}

.remark-table-trigger:hover .remark-cell__icon--edit {
  color: #475569;
}
</style>
