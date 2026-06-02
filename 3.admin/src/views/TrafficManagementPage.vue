<script setup lang="ts">
import { CirclePlus, CopyDocument, Delete, EditPen, Loading, QuestionFilled } from '@element-plus/icons-vue'
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import TrafficChannelNameTag from '../components/TrafficChannelNameTag.vue'
import { withMallTenantHeaders } from '../composables/useAdminApi'
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
  portalAccount?: {
    partnerId?: string
    username: string
    password: string
  }
}

/** 与 GET /admin/traffic-channels/portal-stats、admin-liuliang 数据表同口径 */
interface TrafficPortalStatsRow {
  id: string
  code: string
  name: string
  clickCount: number
  registerCount: number
  applicationCount: number
  approvedCount: number
  overdueCount: number
  registerRate: number | null
  applicationRate: number | null
  approvalRate: number | null
  overdueRate: number | null
  registrationConversionRate: number | null
  applicationConversionRate: number | null
}

/** 列表行 = 渠道基础信息 + 引流统计 */
type TrafficMergedRow = TrafficChannelRow & {
  stats: TrafficPortalStatsRow | null
}

const MALL_API_BASE = `${(import.meta.env.VITE_MALL_API_BASE || 'http://localhost:3110/api').replace(/\/$/, '')}`

/** 商城 H5（shop）根地址，构建时注入。未配置时：开发环境见下方映射；生产常见「后台 :8080 + 商城 :80」会回退为同主机无端口地址 */
const MALL_H5_ORIGIN = (import.meta.env.VITE_MALL_H5_ORIGIN || '').replace(/\/$/, '')

const isViteDev = import.meta.env.DEV

/** 当前后台页 origin，用于判断推广基址是否仍误指向后台 */
const adminPageOrigin = computed(() => {
  if (typeof window === 'undefined' || !window.location?.origin)
    return ''
  return window.location.origin.replace(/\/$/, '')
})

const h5BaseForLink = computed(() => {
  if (MALL_H5_ORIGIN)
    return MALL_H5_ORIGIN
  if (typeof window !== 'undefined' && window.location?.origin) {
    const origin = window.location.origin.replace(/\/$/, '')
    if (isViteDev) {
      try {
        const u = new URL(origin)
        const port = u.port || (u.protocol === 'https:' ? '443' : '80')
        const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1'
        // admin 默认同 vite server.port=5174（见 admin/vite.config）；商城为 shop 5173
        if (local && port === '5174')
          return `${u.protocol}//${u.hostname}:5173`
      }
      catch {
        /* ignore */
      }
    }
    else {
      try {
        const u = new URL(origin)
        // 与子系统常见部署一致：后台 http://IP:8080，商城 http://IP/（默认 80，URL 不写端口）
        if (u.protocol === 'http:' && u.port === '8080')
          return `${u.protocol}//${u.hostname}`
      }
      catch {
        /* ignore */
      }
    }
    return origin
  }
  return ''
})

const showH5OriginDevHint = computed(
  () => isViteDev && !MALL_H5_ORIGIN && h5BaseForLink.value === adminPageOrigin.value,
)

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

const statsRows = ref<TrafficPortalStatsRow[]>([])
const statsLoading = ref(false)
const statsErrorMessage = ref('')
/** 仅展示至少有一笔「通过」（发卡包）订单的流量商 */
const whitelistStatsPositive = ref(false)

const statsByChannelId = computed(() => {
  const m = new Map<string, TrafficPortalStatsRow>()
  for (const s of statsRows.value) {
    m.set(s.id, s)
  }
  return m
})

/** 单一表格数据源：按流量商列表顺序合并统计；白名单时仅保留通过数 > 0 的渠道 */
const displayMergedRows = computed<TrafficMergedRow[]>(() => {
  const out: TrafficMergedRow[] = []
  for (const r of rows.value) {
    const s = statsByChannelId.value.get(r.id) ?? null
    if (whitelistStatsPositive.value && (!s || s.approvedCount <= 0))
      continue
    out.push({ ...r, stats: s })
  }
  return out
})

function mergedRowClassName({ row }: { row: TrafficMergedRow }) {
  return row.disabled ? 'traffic-quality-row--muted' : ''
}

/** 与 api buildTrafficPartnerPortalStatsRow 口径一致 */
const TRAFFIC_PORTAL_STAT_HEADER_TIPS = {
  clickCount:
    '用户打开带本渠道参数（?channel=标识）的商城推广页时累计 +1；渠道已停用则不再累计。',
  registerCount: '注册时「渠道标识」等于本流量商的用户总数。',
  applicationCount: '上述注册用户中，至少存在 1 笔商城订单的用户数（含待审核订单）。',
  approvedCount: '上述用户订单中，状态非「待审核」且已发放卡包的订单笔数。',
  overdueCount:
    '通过订单中的分期订单里，存在已到期且未还清期次的订单笔数（按统计当日计算）。',
  registerRate: '注册数 ÷ 点击数 × 100，保留两位小数；点击数为 0 时显示 —。',
  applicationRate: '申请数 ÷ 注册数 × 100，保留两位小数；注册数为 0 时显示 —。',
  approvalRate: '通过数 ÷ 申请数 × 100，保留两位小数；申请数为 0 时显示 —。',
  overdueRate: '逾期数 ÷ 通过数 × 100，保留两位小数；通过数为 0 时显示 —。',
  registrationConversionRate: '通过数 ÷ 注册数 × 100，保留两位小数；注册数为 0 时显示 —。',
  applicationConversionRate: '通过数 ÷ 申请数 × 100，保留两位小数；申请数为 0 时显示 —。',
} as const

/** 比率展示为两位小数并带 % */
function formatRate(value: number | null | undefined) {
  if (value == null || Number.isNaN(Number(value)))
    return '—'
  return `${Number(value).toFixed(2)}%`
}

const remarkDialogVisible = ref(false)
const remarkSaving = ref(false)
const remarkTarget = ref<TrafficChannelRow | null>(null)
const remarkDraft = ref('')

/** 正在 PATCH 状态的流量商 id，用于行内状态标签 loading */
const statusBusyId = ref<string | null>(null)

const createForm = reactive({
  code: '',
  name: '',
  remark: '',
  disabled: false,
  /** 同步创建 admin-liuliang 流量商数据后台登录账号 */
  createPortalAccount: true,
  portalUsername: '',
  portalPassword: '',
})

const editForm = reactive({
  id: '',
  name: '',
  remark: '',
  portalUsername: '',
  portalPassword: '',
})

/** 打开编辑弹窗时的账号密码快照，仅在实际变更时才提交 PATCH，避免误写 trafficPartners */
const editPortalBaseline = ref({ username: '', password: '' })

function promotionPathAndQuery(code: string) {
  return `/?channel=${encodeURIComponent(code)}`
}

function fullPromotionUrl(code: string) {
  const base = h5BaseForLink.value
  return base ? `${base}${promotionPathAndQuery(code)}` : promotionPathAndQuery(code)
}

/** HTTP / 受限环境无 Clipboard API 时仍能复制（需在点击回调里尽早同步执行 fallback） */
function copyTextViaExecCommand(text: string): boolean {
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;'
    document.body.appendChild(ta)
    ta.focus({ preventScroll: true })
    ta.select()
    ta.setSelectionRange(0, text.length)
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  }
  catch {
    return false
  }
}

async function copyPromotionLink(code: string) {
  const full = fullPromotionUrl(code)
  let ok = false
  if (typeof window !== 'undefined' && window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(full)
      ok = true
    }
    catch {
      ok = copyTextViaExecCommand(full)
    }
  }
  else {
    ok = copyTextViaExecCommand(full)
  }

  if (ok) {
    ElMessage.success({
      message: '复制成功',
      /** 顶栏 .admin-header 高 64px，略微下移使绿条出现在内容区顶部 */
      offset: 72,
    })
  }
  else {
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

/** POST/PATCH 成功后用接口返回的 data 写入列表（新建则插入首行） */
function applyTrafficChannelPatchRow(data: TrafficChannelRow) {
  const idx = rows.value.findIndex(r => r.id === data.id)
  if (idx >= 0)
    rows.value[idx] = { ...rows.value[idx], ...data }
  else
    rows.value = [data, ...rows.value]
}

async function fetchTrafficOverview() {
  loading.value = true
  statsLoading.value = true
  startPageProgress()
  errorMessage.value = ''
  statsErrorMessage.value = ''
  try {
    const response = await fetch(`${MALL_API_BASE}/admin/traffic-channels/overview`, {
      method: 'GET',
      headers: withMallTenantHeaders(),
    })
    const payload = await response.json() as {
      success?: boolean
      msg?: string
      data?: {
        channels?: TrafficChannelRow[]
        portalStats?: TrafficPortalStatsRow[]
      }
    }
    if (!response.ok || payload.success === false) {
      const msg = payload.msg || `加载失败 (${response.status})`
      if (response.status === 401 || response.status === 403) {
        throw new Error(`${msg} — 请重新登录`)
      }
      throw new Error(msg)
    }
    const data = payload.data
    rows.value = Array.isArray(data?.channels) ? data.channels : []
    statsRows.value = Array.isArray(data?.portalStats) ? data.portalStats : []
  }
  catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '加载失败'
    statsErrorMessage.value = errorMessage.value
    rows.value = []
    statsRows.value = []
    ElMessage.error(errorMessage.value)
  }
  finally {
    loading.value = false
    statsLoading.value = false
    donePageProgress()
  }
}

async function refreshTrafficPage() {
  await fetchTrafficOverview()
}

function syncPortalUsernameFromCode() {
  const code = createForm.code.trim()
  if (!code || createForm.portalUsername.trim()) {
    return
  }
  createForm.portalUsername = code
}

function openCreate() {
  showCreate.value = true
  createForm.code = ''
  createForm.name = ''
  createForm.remark = ''
  createForm.disabled = false
  createForm.createPortalAccount = true
  createForm.portalUsername = ''
  createForm.portalPassword = ''
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
  const portalUsername = row.portalAccount?.username || ''
  const portalPassword = row.portalAccount?.password || ''
  editForm.portalUsername = portalUsername
  editForm.portalPassword = portalPassword
  editPortalBaseline.value = { username: portalUsername, password: portalPassword }
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
  syncPortalUsernameFromCode()
  const code = createForm.code.trim()
  const name = createForm.name.trim()
  if (!code || !name) {
    ElMessage.warning('请填写流量商标识与名称')
    return
  }
  if (createForm.createPortalAccount) {
    const portalUsername = createForm.portalUsername.trim()
    const portalPassword = createForm.portalPassword.trim()
    if (!portalUsername) {
      ElMessage.warning('请填写数据后台登录账号')
      return
    }
    if (portalPassword.length < 6) {
      ElMessage.warning('数据后台登录密码至少 6 位')
      return
    }
  }
  submitting.value = true
  errorMessage.value = ''
  try {
    const response = await fetch(`${MALL_API_BASE}/admin/traffic-channels`, {
      method: 'POST',
      headers: withMallTenantHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        code,
        name,
        remark: createForm.remark.trim(),
        disabled: createForm.disabled,
        createPortalAccount: createForm.createPortalAccount,
        portalUsername: createForm.portalUsername.trim(),
        portalPassword: createForm.portalPassword.trim(),
      }),
    })
    const payload = await response.json() as {
      msg?: string
      success?: boolean
      data?: TrafficChannelRow & { portalAccount?: { username: string, merged?: boolean } }
    }
    if (!response.ok || payload.success === false) {
      throw new Error(payload.msg || `创建失败: ${response.status}`)
    }
    const portal = payload.data?.portalAccount
    if (portal?.username) {
      ElMessage.success(
        portal.merged
          ? `流量商已创建；数据后台账号 ${portal.username} 已绑定本渠道`
          : `流量商已创建；数据后台账号 ${portal.username} 已开通`,
      )
    }
    else {
      ElMessage.success('流量商已创建')
    }
    showCreate.value = false
    if (payload.data)
      applyTrafficChannelPatchRow(payload.data)
    void refreshTrafficPage()
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
  const name = editForm.name.trim()
  if (!name) {
    ElMessage.warning('请填写名称')
    return
  }
  const portalUsername = editForm.portalUsername.trim()
  const portalPassword = editForm.portalPassword.trim()
  if (portalUsername && portalPassword.length < 6) {
    ElMessage.warning('数据后台登录密码至少 6 位')
    return
  }
  submitting.value = true
  errorMessage.value = ''
  try {
    const body: Record<string, string> = {
      name,
      remark: editForm.remark.trim(),
    }
    const baseline = editPortalBaseline.value
    const portalChanged = portalUsername !== baseline.username
      || portalPassword !== baseline.password
    if (portalChanged && portalUsername) {
      body.portalUsername = portalUsername
      body.portalPassword = portalPassword
    }
    const response = await fetch(`${MALL_API_BASE}/admin/traffic-channels/${encodeURIComponent(editForm.id)}`, {
      method: 'PATCH',
      headers: withMallTenantHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    })
    const payload = await response.json() as { msg?: string; success?: boolean; data?: TrafficChannelRow }
    if (!response.ok || payload.success === false) {
      throw new Error(payload.msg || `保存失败: ${response.status}`)
    }
    ElMessage.success('已保存')
    showEdit.value = false
    if (payload.data)
      applyTrafficChannelPatchRow(payload.data)
    void refreshTrafficPage()
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
      headers: withMallTenantHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ disabled: nextDisabled }),
    })
    const payload = await response.json() as { msg?: string; data?: TrafficChannelRow }
    if (!response.ok) {
      throw new Error(payload.msg || `操作失败: ${response.status}`)
    }
    if (payload.data)
      applyTrafficChannelPatchRow(payload.data)
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

function closeDelete(opts?: { force?: boolean }) {
  const force = Boolean(opts?.force)
  if (!force && deleting.value)
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
      headers: withMallTenantHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ remark: remarkDraft.value.trim() }),
    })
    const payload = await response.json() as { msg?: string; success?: boolean; data?: TrafficChannelRow }
    if (!response.ok || payload.success === false) {
      throw new Error(payload.msg || `保存备注失败: ${response.status}`)
    }
    ElMessage.success('备注已保存')
    resetRemarkDialog()
    if (payload.data)
      applyTrafficChannelPatchRow(payload.data)
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
      headers: withMallTenantHeaders(),
    })
    const payload = await response.json() as { msg?: string; success?: boolean }
    if (!response.ok || payload.success === false) {
      throw new Error(payload.msg || `删除失败: ${response.status}`)
    }
    ElMessage.success('已删除')
    closeDelete({ force: true })
    const delId = row.id
    rows.value = rows.value.filter(r => r.id !== delId)
    void refreshTrafficPage()
  }
  catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '删除失败')
  }
  finally {
    deleting.value = false
  }
}

onMounted(() => {
  void refreshTrafficPage()
})
</script>

<template>
  <div class="panel traffic-page">
    <el-alert
      v-if="showH5OriginDevHint"
      type="warning"
      :closable="false"
      show-icon
      class="traffic-h5-hint"
    >
      推广链接应指向<strong>商城 H5（shop）</strong>，不应等于本后台地址。本地默认已将后台
      <code class="traffic-code">5174</code>
      对应到商城
      <code class="traffic-code">5173</code>
      ；若你改了端口或仍有误，请在
      <code class="traffic-code">admin/.env.development</code>
      设置（示例，按实际商城地址修改）：
      <code class="traffic-code traffic-code--block">VITE_MALL_H5_ORIGIN=http://localhost:5173</code>
      保存后<strong>重启</strong>
      <code class="traffic-code">npm run dev</code>
      。
    </el-alert>

    <div class="toolbar">
      <button
        class="btn btn-primary"
        type="button"
        :disabled="loading"
        @click="openCreate"
      >
        + 新建流量商
      </button>
      <button
        class="btn btn-refresh"
        type="button"
        :disabled="loading || statsLoading"
        @click="refreshTrafficPage"
      >
        刷新
      </button>
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
      class="traffic-table-card traffic-unified-card"
      shadow="hover"
    >
      <template #header>
        <div class="traffic-table-card-header traffic-unified-card-header">
          <div class="traffic-unified-card-header__title">
            <span class="traffic-table-card-title">流量商</span>
            <el-checkbox
              v-model="whitelistStatsPositive"
              border
              size="small"
            >
              白名单（通过数大于 0）
            </el-checkbox>
          </div>
          <el-tag
            v-if="rows.length"
            type="info"
            effect="plain"
            size="small"
          >
            共 {{ displayMergedRows.length }} / {{ rows.length }} 个
          </el-tag>
        </div>
      </template>

      <el-alert
        v-if="statsErrorMessage && !statsLoading"
        type="error"
        :closable="false"
        show-icon
        class="traffic-quality-error"
      >
        {{ statsErrorMessage }}
      </el-alert>

      <p class="traffic-quality-stats">
        当前展示 <strong>{{ displayMergedRows.length }}</strong> 家
        <template v-if="whitelistStatsPositive && rows.length !== displayMergedRows.length">
          （已过滤 {{ rows.length - displayMergedRows.length }} 家通过数为 0）
        </template>
      </p>

      <div class="traffic-table-wrap">
        <el-table
          v-loading="loading || statsLoading"
          :data="displayMergedRows"
          stripe
          border
          size="default"
          class="traffic-table traffic-unified-table"
          :header-cell-style="tableHeaderCellStyle"
          :highlight-current-row="true"
          :row-class-name="mergedRowClassName"
          empty-text=""
        >
          <template #empty>
            <el-empty
              :description="rows.length === 0 ? '暂无流量商，点击「新建流量商」添加' : (whitelistStatsPositive ? '无符合白名单条件的流量商' : '暂无数据')"
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
          label="流量商标识"
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
          label="渠道名称"
          min-width="120"
          show-overflow-tooltip
        >
          <template #default="{ row }">
            <TrafficChannelNameTag
              :display-key="trafficChannelDisplayKey(undefined, row.name, row.code)"
              :color-seed="row.code"
              size="default"
            />
          </template>
        </el-table-column>

        <el-table-column
          label="备注"
          min-width="140"
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
                  :class="row.remark?.trim() ? 'remark-preview--filled' : 'remark-preview--empty'"
                >{{ row.remark?.trim() ? row.remark : '暂无备注' }}</span>
              </span>
            </el-button>
          </template>
        </el-table-column>

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
          min-width="200"
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
          width="88"
          align="center"
        >
          <template #header>
            <span class="traffic-col-header">
              点击数
              <el-tooltip
                :content="TRAFFIC_PORTAL_STAT_HEADER_TIPS.clickCount"
                placement="top"
                :show-after="300"
              >
                <el-icon
                  class="traffic-col-header__tip"
                  aria-label="点击数计算规则"
                >
                  <QuestionFilled />
                </el-icon>
              </el-tooltip>
            </span>
          </template>
          <template #default="{ row }">
            {{ row.stats ? row.stats.clickCount : '—' }}
          </template>
        </el-table-column>

        <el-table-column
          width="88"
          align="center"
        >
          <template #header>
            <span class="traffic-col-header">
              注册数
              <el-tooltip
                :content="TRAFFIC_PORTAL_STAT_HEADER_TIPS.registerCount"
                placement="top"
                :show-after="300"
              >
                <el-icon
                  class="traffic-col-header__tip"
                  aria-label="注册数计算规则"
                >
                  <QuestionFilled />
                </el-icon>
              </el-tooltip>
            </span>
          </template>
          <template #default="{ row }">
            {{ row.stats ? row.stats.registerCount : '—' }}
          </template>
        </el-table-column>

        <el-table-column
          width="88"
          align="center"
        >
          <template #header>
            <span class="traffic-col-header">
              申请数
              <el-tooltip
                :content="TRAFFIC_PORTAL_STAT_HEADER_TIPS.applicationCount"
                placement="top"
                :show-after="300"
              >
                <el-icon
                  class="traffic-col-header__tip"
                  aria-label="申请数计算规则"
                >
                  <QuestionFilled />
                </el-icon>
              </el-tooltip>
            </span>
          </template>
          <template #default="{ row }">
            <span
              v-if="row.stats"
              class="traffic-stats-link-num"
            >{{ row.stats.applicationCount }}</span>
            <template v-else>
              —
            </template>
          </template>
        </el-table-column>

        <el-table-column
          width="88"
          align="center"
        >
          <template #header>
            <span class="traffic-col-header">
              通过数
              <el-tooltip
                :content="TRAFFIC_PORTAL_STAT_HEADER_TIPS.approvedCount"
                placement="top"
                :show-after="300"
              >
                <el-icon
                  class="traffic-col-header__tip"
                  aria-label="通过数计算规则"
                >
                  <QuestionFilled />
                </el-icon>
              </el-tooltip>
            </span>
          </template>
          <template #default="{ row }">
            <span
              v-if="row.stats"
              class="traffic-stats-link-num"
            >{{ row.stats.approvedCount }}</span>
            <template v-else>
              —
            </template>
          </template>
        </el-table-column>

        <el-table-column
          width="88"
          align="center"
        >
          <template #header>
            <span class="traffic-col-header">
              逾期数
              <el-tooltip
                :content="TRAFFIC_PORTAL_STAT_HEADER_TIPS.overdueCount"
                placement="top"
                :show-after="300"
              >
                <el-icon
                  class="traffic-col-header__tip"
                  aria-label="逾期数计算规则"
                >
                  <QuestionFilled />
                </el-icon>
              </el-tooltip>
            </span>
          </template>
          <template #default="{ row }">
            {{ row.stats ? row.stats.overdueCount : '—' }}
          </template>
        </el-table-column>

        <el-table-column
          width="96"
          align="center"
        >
          <template #header>
            <span class="traffic-col-header">
              注册率
              <el-tooltip
                :content="TRAFFIC_PORTAL_STAT_HEADER_TIPS.registerRate"
                placement="top"
                :show-after="300"
              >
                <el-icon
                  class="traffic-col-header__tip"
                  aria-label="注册率计算规则"
                >
                  <QuestionFilled />
                </el-icon>
              </el-tooltip>
            </span>
          </template>
          <template #default="{ row }">
            {{ row.stats ? formatRate(row.stats.registerRate) : '—' }}
          </template>
        </el-table-column>

        <el-table-column
          width="96"
          align="center"
        >
          <template #header>
            <span class="traffic-col-header">
              申请率
              <el-tooltip
                :content="TRAFFIC_PORTAL_STAT_HEADER_TIPS.applicationRate"
                placement="top"
                :show-after="300"
              >
                <el-icon
                  class="traffic-col-header__tip"
                  aria-label="申请率计算规则"
                >
                  <QuestionFilled />
                </el-icon>
              </el-tooltip>
            </span>
          </template>
          <template #default="{ row }">
            {{ row.stats ? formatRate(row.stats.applicationRate) : '—' }}
          </template>
        </el-table-column>

        <el-table-column
          width="96"
          align="center"
        >
          <template #header>
            <span class="traffic-col-header">
              通过率
              <el-tooltip
                :content="TRAFFIC_PORTAL_STAT_HEADER_TIPS.approvalRate"
                placement="top"
                :show-after="300"
              >
                <el-icon
                  class="traffic-col-header__tip"
                  aria-label="通过率计算规则"
                >
                  <QuestionFilled />
                </el-icon>
              </el-tooltip>
            </span>
          </template>
          <template #default="{ row }">
            {{ row.stats ? formatRate(row.stats.approvalRate) : '—' }}
          </template>
        </el-table-column>

        <el-table-column
          width="96"
          align="center"
        >
          <template #header>
            <span class="traffic-col-header">
              逾期率
              <el-tooltip
                :content="TRAFFIC_PORTAL_STAT_HEADER_TIPS.overdueRate"
                placement="top"
                :show-after="300"
              >
                <el-icon
                  class="traffic-col-header__tip"
                  aria-label="逾期率计算规则"
                >
                  <QuestionFilled />
                </el-icon>
              </el-tooltip>
            </span>
          </template>
          <template #default="{ row }">
            {{ row.stats ? formatRate(row.stats.overdueRate) : '—' }}
          </template>
        </el-table-column>

        <el-table-column
          width="108"
          align="center"
        >
          <template #header>
            <span class="traffic-col-header">
              注册转化率
              <el-tooltip
                :content="TRAFFIC_PORTAL_STAT_HEADER_TIPS.registrationConversionRate"
                placement="top"
                :show-after="300"
              >
                <el-icon
                  class="traffic-col-header__tip"
                  aria-label="注册转化率计算规则"
                >
                  <QuestionFilled />
                </el-icon>
              </el-tooltip>
            </span>
          </template>
          <template #default="{ row }">
            {{ row.stats ? formatRate(row.stats.registrationConversionRate) : '—' }}
          </template>
        </el-table-column>

        <el-table-column
          width="108"
          align="center"
        >
          <template #header>
            <span class="traffic-col-header">
              申请转化率
              <el-tooltip
                :content="TRAFFIC_PORTAL_STAT_HEADER_TIPS.applicationConversionRate"
                placement="top"
                :show-after="300"
              >
                <el-icon
                  class="traffic-col-header__tip"
                  aria-label="申请转化率计算规则"
                >
                  <QuestionFilled />
                </el-icon>
              </el-tooltip>
            </span>
          </template>
          <template #default="{ row }">
            {{ row.stats ? formatRate(row.stats.applicationConversionRate) : '—' }}
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
                :title="row.registerCount > 0 ? `已有 ${row.registerCount} 人通过该流量商注册，为保留统计归因不可删除；可先停用流量商` : '删除流量商'"
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
      title="新建流量商"
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
          label="流量商标识"
          required
        >
          <el-input
            v-model="createForm.code"
            placeholder="2～40 位，如 liuliang1"
            maxlength="40"
            show-word-limit
            clearable
            @blur="syncPortalUsernameFromCode"
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
        <el-form-item label="开通登录账号">
          <el-switch v-model="createForm.createPortalAccount" />
        </el-form-item>
        <template v-if="createForm.createPortalAccount">
          <el-form-item
            label="登录账号"
            required
          >
            <el-input
              v-model="createForm.portalUsername"
              placeholder="默认可与流量商标识相同"
              maxlength="40"
              clearable
              @blur="syncPortalUsernameFromCode"
            />
          </el-form-item>
          <el-form-item
            label="登录密码"
            required
          >
            <el-input
              v-model="createForm.portalPassword"
              type="password"
              placeholder="至少 6 位"
              show-password
              maxlength="64"
              autocomplete="new-password"
            />
          </el-form-item>
        </template>
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
      title="编辑流量商"
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
        流量商标识不可修改；可编辑名称、备注及数据后台登录账号。
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
        <el-form-item label="登录账号">
          <el-input
            v-model="editForm.portalUsername"
            placeholder="数据后台登录账号，未开通可留空"
            maxlength="40"
            clearable
          />
        </el-form-item>
        <el-form-item label="登录密码">
          <el-input
            v-model="editForm.portalPassword"
            placeholder="至少 6 位，明文显示"
            maxlength="64"
            autocomplete="off"
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
      title="流量商备注"
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
        placeholder="请输入添加备注"
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
      title="删除流量商"
      width="420px"
      align-center
      @close="() => closeDelete()"
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
        该流量商已有注册记录，无法删除。
      </el-alert>
      <template #footer>
        <el-button @click="() => closeDelete()">
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

.btn {
  height: 30px;
  border-radius: 6px;
  border: 1px solid #d1d5db;
  background: #fff;
  cursor: pointer;
  padding: 0 10px;
  font-size: 14px;
}

.btn-primary {
  border-color: #2563eb;
  background: #2563eb;
  color: #fff;
}

.btn-refresh {
  border-color: #d1d5db;
  background: #fff;
  color: #374151;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
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

.traffic-unified-card :deep(.el-card__body) {
  padding-top: 16px;
}

.traffic-unified-card-header__title {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
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
  min-width: 1520px;
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
  line-height: 1.45;
  max-height: 4.35em;
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  word-break: break-word;
}

.remark-preview--filled {
  font-size: 16px;
  font-weight: 700;
  color: #dc2626;
}

.remark-preview--empty {
  font-size: 12px;
  font-weight: 400;
  color: #a8a1a1;
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

.traffic-quality-intro {
  margin-bottom: 12px;
  border-radius: 8px;
}

.traffic-quality-intro__p {
  margin: 0 0 6px;
  font-size: 13px;
  line-height: 1.55;
  color: var(--el-text-color-regular);
}

.traffic-quality-intro__p--last {
  margin-bottom: 0;
}

.traffic-quality-error {
  margin-bottom: 12px;
  border-radius: 8px;
}

.traffic-quality-stats {
  margin: 0 0 10px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.traffic-quality-stats strong {
  color: var(--el-text-color-primary);
}

.traffic-stats-link-num {
  color: var(--el-color-primary);
  font-weight: 500;
}

.traffic-col-header {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  line-height: 1.2;
}

.traffic-col-header__tip {
  font-size: 14px;
  color: var(--el-text-color-secondary);
  cursor: help;
}

.traffic-col-header__tip:hover {
  color: var(--el-color-primary);
}

.traffic-unified-table :deep(.traffic-quality-row--muted) {
  opacity: 0.78;
}
</style>
