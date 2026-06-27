<script setup lang="ts">
import { CircleCheck, CircleClose, Minus, Picture } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { computed, ref, watch } from 'vue'
import TrafficChannelNameTag from './TrafficChannelNameTag.vue'
import { readApiErrorMessage, withMallTenantHeaders } from '../composables/useAdminApi'
import { trafficChannelDisplayKey } from '../utils/trafficChannelTagStyle'
import { groupRadarV4FactsForTables, chunkRadarFactPairs } from '../utils/radarV4ReputationFacts'
import {
  buildOrderSubmitSevenPanel,
  displayCreditStatusFromOrderSevenSnapshot,
  type OrderSevenPanelSnapshot,
} from '../utils/orderSubmitSevenPanel'

const MALL_API_BASE = `${(import.meta.env.VITE_MALL_API_BASE || 'http://localhost:3110/api').replace(/\/$/, '')}`
const CONTACTS_PAGE_SIZE = 20
const CONTACTS_PREVIEW_SIZE = 20

/** 与用户页「用户注册信息」只读区所需字段一致 */
export interface UserRegistrationInfoUser {
  id: string
  name: string
  phone: string
  quota: number
  orderCount: number
  registerAt: string
  idCardFront: string
  idCardBack: string
  idCardHandheld: string
  idNumber?: string
  adminPasswordPlain?: string
  adminRemark?: string
  registerChannelCode?: string
  registerChannelName?: string
  registerChannelLabel?: string
  emergencyContacts?: Array<{ name: string, phone: string }>
}

/** 订单收货人信息：与 OrdersPage 传入风控弹窗的订单字段一致 */
export interface OrderShippingSnapshot {
  name: string
  phone: string
  address: string
}

interface MallContactUploadSummary {
  uploadId: string
  orderId: string
  uploadedAt: string
  contactsCount: number
}

interface MallContactRow {
  contactId?: string
  displayName?: string
  phones: string[]
}

interface MallContactUploadRecord {
  upload: MallContactUploadSummary | null
  list: MallContactRow[]
  total: number
  page: number
  pageSize: number
}

const props = withDefaults(defineProps<{
  user: UserRegistrationInfoUser
  snapshot?: OrderSevenPanelSnapshot | null
  canManageUsers: boolean
  /** 为 true 时在顶部渲染与用户页弹窗相同的标题栏（含关闭） */
  showEmbeddedHead?: boolean
  /**
   * 为 true 时不包外层 `.user-preview-scroll`（用于已处于 UsersPage 预览滚动容器内）。
   */
  embeddedInParentScroll?: boolean
  /** 仅展示证件照片 + 信誉报告（用于 users 页编辑态下避开重复「基本信息」） */
  photosAndRiskOnly?: boolean
  /**
   * 从订单入口：收货人姓名、电话、详细地址；不传则不展示收货区块。
   */
  orderShippingSnapshot?: OrderShippingSnapshot | null
}>(), {
  snapshot: null,
  showEmbeddedHead: false,
  embeddedInParentScroll: false,
  photosAndRiskOnly: false,
})

const emit = defineEmits<{
  close: []
}>()

const panel = computed(() => buildOrderSubmitSevenPanel(props.snapshot))
const radarGrouped = computed(() => groupRadarV4FactsForTables(panel.value.radarStep.facts))
const displayCredit = computed(() => displayCreditStatusFromOrderSevenSnapshot(props.snapshot))

const orderShippingSectionVisible = computed(() => props.orderShippingSnapshot != null)
const mallContactsLoading = ref(false)
const mallContactsLoaded = ref(false)
const mallContactsError = ref('')
const mallContactsPage = ref(1)
const mallContactsPageSize = ref(CONTACTS_PAGE_SIZE)
const mallContactsTotal = ref(0)
const mallContactsRecords = ref<MallContactUploadRecord[]>([])
const mallContactsActiveRecords = ref<string[]>([])

const orderShippingNameTrim = computed(() => String(props.orderShippingSnapshot?.name ?? '').trim())
const orderShippingPhoneTrim = computed(() => String(props.orderShippingSnapshot?.phone ?? '').trim())
const orderShippingAddressTrim = computed(() => String(props.orderShippingSnapshot?.address ?? '').trim())

function resetMallContactsViewer() {
  mallContactsLoading.value = false
  mallContactsLoaded.value = false
  mallContactsError.value = ''
  mallContactsPage.value = 1
  mallContactsPageSize.value = CONTACTS_PAGE_SIZE
  mallContactsTotal.value = 0
  mallContactsRecords.value = []
  mallContactsActiveRecords.value = []
}

watch(() => props.user.id, resetMallContactsViewer)

function formatMallContactsUploadedAt(value: string) {
  const raw = String(value || '').trim()
  if (!raw) {
    return '暂无'
  }
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) {
    return raw
  }
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

async function fetchMallContacts(page = 1) {
  if (mallContactsLoading.value) {
    return
  }
  mallContactsLoading.value = true
  mallContactsError.value = ''
  try {
    const params = new URLSearchParams()
    params.set('page', String(Math.max(1, page)))
    params.set('pageSize', String(CONTACTS_PAGE_SIZE))
    params.set('contactsPreviewSize', String(CONTACTS_PREVIEW_SIZE))
    const response = await fetch(
      `${MALL_API_BASE}/users/${encodeURIComponent(props.user.id)}/mall-contacts?${params.toString()}`,
      { method: 'GET', headers: withMallTenantHeaders() },
    )
    if (!response.ok) {
      throw new Error(await readApiErrorMessage(response, '读取通讯录失败'))
    }
    const payload = await response.json() as {
      success?: boolean
      msg?: string
      data?: {
        records?: MallContactUploadRecord[]
        total?: number
        page?: number
        pageSize?: number
        contactsPreviewSize?: number
      }
    }
    if (payload.success === false) {
      throw new Error(payload.msg || '读取通讯录失败')
    }
    const data = payload.data || {}
    mallContactsLoaded.value = true
    mallContactsRecords.value = Array.isArray(data.records) ? data.records : []
    mallContactsTotal.value = Math.max(0, Number(data.total || 0) || 0)
    mallContactsPage.value = Math.max(1, Number(data.page || page) || 1)
    mallContactsPageSize.value = Math.max(1, Number(data.pageSize || CONTACTS_PAGE_SIZE) || CONTACTS_PAGE_SIZE)
    mallContactsActiveRecords.value = mallContactsRecords.value[0]?.upload?.uploadId ? [mallContactsRecords.value[0].upload.uploadId] : []
  }
  catch (error) {
    mallContactsLoaded.value = true
    mallContactsError.value = error instanceof Error ? error.message : '读取通讯录失败'
    mallContactsRecords.value = []
    mallContactsActiveRecords.value = []
    mallContactsTotal.value = 0
    ElMessage.error(mallContactsError.value)
  }
  finally {
    mallContactsLoading.value = false
  }
}

function onMallContactsPageChange(page: number) {
  void fetchMallContacts(page)
}

function buildOrderShippingClipboardText(): string {
  const name = orderShippingNameTrim.value || '暂无'
  const phone = orderShippingPhoneTrim.value || '暂无'
  const addr = orderShippingAddressTrim.value || '暂无收货地址'
  return `姓名：${name}\n电话：${phone}\n详细地址：${addr}`
}

async function copyOrderShippingFull() {
  const text = buildOrderShippingClipboardText()
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success('已复制姓名、电话与详细地址')
  }
  catch {
    ElMessage.error('复制失败，请手动选择文字复制')
  }
}

const PREVIEW_RADAR_PAIR_COLUMNS = 3
const PREVIEW_RADAR_TABLE_COLSPAN = PREVIEW_RADAR_PAIR_COLUMNS * 2
const previewRadarPairHeadIndexes = Array.from({ length: PREVIEW_RADAR_PAIR_COLUMNS }, (_, i) => i)

function isMockImgSrc(src: string) {
  const s = String(src || '').trim()
  return !s || s.startsWith('mock://')
}

function getStatusClass(status: ReturnType<typeof displayCreditStatusFromOrderSevenSnapshot>) {
  if (status === '良好') {
    return 'credit-badge badge-ok'
  }
  if (status === '待风控') {
    return 'credit-badge badge-pending'
  }
  return 'credit-badge badge-risk'
}
</script>

<template>
  <div
    class="uri-panel"
    :class="{
      'uri-panel--embedded': showEmbeddedHead,
      'uri-panel--bare': embeddedInParentScroll,
    }"
  >
    <header
      v-if="showEmbeddedHead"
      class="user-preview-head"
    >
      <div class="user-preview-head__titles">
        <h3 class="user-preview-title">
          用户注册信息
        </h3>
        <p class="user-preview-meta">
          <span>{{ user.name }}</span>
          <span class="user-preview-meta__sep">·</span>
          <span>{{ user.phone }}</span>
          <span class="user-preview-meta__sep">·</span>
          <span class="user-preview-meta__id">{{ user.id }}</span>
        </p>
      </div>
      <el-button
        text
        class="uri-close-btn"
        @click="emit('close')"
      >
        关闭
      </el-button>
    </header>

    <div
      class="user-preview-scroll"
      :class="{
        'user-preview-scroll--embedded': showEmbeddedHead && !embeddedInParentScroll,
        'user-preview-scroll--nested': embeddedInParentScroll,
      }"
    >
      <section
        v-if="!photosAndRiskOnly"
        class="user-preview-block"
      >
        <h4 class="user-preview-block__title">
          <span class="user-preview-block__bar" />
          基本信息
        </h4>
        <el-descriptions
          :column="2"
          border
          size="default"
          class="user-preview-desc"
        >
          <el-descriptions-item label="姓名">
            {{ user.name }}
          </el-descriptions-item>
          <el-descriptions-item label="手机号">
            {{ user.phone }}
          </el-descriptions-item>
          <el-descriptions-item
            v-if="canManageUsers"
            label="登录密码"
          >
            <span v-if="user.adminPasswordPlain">{{ user.adminPasswordPlain }}</span>
            <span
              v-else
              class="user-preview-meta__muted"
            >未设置</span>
          </el-descriptions-item>
          <el-descriptions-item label="身份证号码">
            <span
              v-if="user.idNumber"
              class="user-preview-id-number"
            >{{ user.idNumber }}</span>
            <span
              v-else
              class="user-preview-meta__muted"
            >未填写</span>
          </el-descriptions-item>
          <el-descriptions-item label="注册时间">
            {{ user.registerAt }}
          </el-descriptions-item>
          <el-descriptions-item label="注册渠道">
            <TrafficChannelNameTag
              mall-plain-when-empty
              :display-key="trafficChannelDisplayKey(user.registerChannelLabel, user.registerChannelName, user.registerChannelCode)"
              :color-seed="user.registerChannelCode || undefined"
            />
          </el-descriptions-item>
          <el-descriptions-item label="额度">
            <span class="user-preview-quota">¥ {{ user.quota }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="订单数">
            {{ user.orderCount }}
          </el-descriptions-item>
          <el-descriptions-item label="紧急联系人一">
            <template v-if="user.emergencyContacts && user.emergencyContacts[0]">
              {{ user.emergencyContacts[0].name }}　<span class="tabular-nums">{{ user.emergencyContacts[0].phone }}</span>
            </template>
            <span
              v-else
              class="user-preview-meta__muted"
            >暂无</span>
          </el-descriptions-item>
          <el-descriptions-item label="紧急联系人二">
            <template v-if="user.emergencyContacts && user.emergencyContacts[1]">
              {{ user.emergencyContacts[1].name }}　<span class="tabular-nums">{{ user.emergencyContacts[1].phone }}</span>
            </template>
            <span
              v-else
              class="user-preview-meta__muted"
            >暂无</span>
          </el-descriptions-item>
          <el-descriptions-item
            label="备注"
            :span="2"
          >
            <p
              class="remark-preview"
              :class="String(user.adminRemark || '').trim() ? 'remark-preview--filled' : 'remark-preview--empty'"
            >
              {{ String(user.adminRemark || '').trim() ? user.adminRemark : '暂无备注' }}
            </p>
          </el-descriptions-item>
          <el-descriptions-item
            label="信誉状态"
            :span="2"
          >
            <span :class="getStatusClass(displayCredit)">
              {{ displayCredit }}
            </span>
          </el-descriptions-item>
        </el-descriptions>
      </section>

      <section
        v-if="orderShippingSectionVisible"
        class="user-preview-block"
      >
        <h4 class="user-preview-block__title user-preview-shipping-head">
          <span class="user-preview-shipping-head__text">
            <span class="user-preview-block__bar" />
            收货地址
          </span>
          <el-button
            type="primary"
            link
            class="user-preview-shipping-copy-all"
            @click="copyOrderShippingFull"
          >
            复制用户收货地址
          </el-button>
        </h4>
        <div class="user-preview-shipping-table-wrap">
          <table class="user-preview-shipping-table">
            <tbody>
              <tr>
                <th scope="row">
                  姓名
                </th>
                <td>
                  <span
                    :class="{ 'user-preview-meta__muted': !orderShippingNameTrim }"
                  >{{ orderShippingNameTrim || '暂无' }}</span>
                </td>
                <th scope="row">
                  电话
                </th>
                <td>
                  <span
                    class="tabular-nums"
                    :class="{ 'user-preview-meta__muted': !orderShippingPhoneTrim }"
                  >{{ orderShippingPhoneTrim || '暂无' }}</span>
                </td>
              </tr>
              <tr>
                <th scope="row">
                  详细地址
                </th>
                <td colspan="3">
                  <span
                    class="user-preview-receiver-text"
                    :class="{ 'user-preview-meta__muted': !orderShippingAddressTrim }"
                  >{{ orderShippingAddressTrim || '暂无收货地址' }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section
        v-if="!photosAndRiskOnly"
        class="user-preview-block user-preview-contacts-block"
      >
        <h4 class="user-preview-block__title user-preview-contacts-head">
          <span class="user-preview-contacts-head__text">
            <span class="user-preview-block__bar" />
            通讯录名单
          </span>
          <el-button
            type="primary"
            :loading="mallContactsLoading"
            @click="fetchMallContacts(1)"
          >
            {{ mallContactsLoaded ? '重新读取' : '查看通讯录名单' }}
          </el-button>
        </h4>

        <template v-if="mallContactsLoaded">
          <el-alert
            v-if="mallContactsError"
            :title="mallContactsError"
            type="error"
            show-icon
            :closable="false"
          />
          <el-empty
            v-else-if="!mallContactsRecords.length"
            description="暂无通讯录上传记录"
          />
          <div
            v-else
            class="user-preview-contacts"
          >
            <div class="user-preview-contacts__summary">
              共 {{ mallContactsTotal }} 次读取记录，按读取时间倒序展示；每条记录独立关联订单，便于对比客户多次下单时的通讯录变化。
            </div>
            <el-collapse
              v-model="mallContactsActiveRecords"
              class="user-preview-contacts__collapse"
            >
              <el-collapse-item
                v-for="(record, recordIndex) in mallContactsRecords"
                :key="record.upload?.uploadId || recordIndex"
                :name="record.upload?.uploadId || String(recordIndex)"
              >
                <template #title>
                  <div class="user-preview-contacts-record-title">
                    <strong>读取 {{ (mallContactsPage - 1) * mallContactsPageSize + recordIndex + 1 }}</strong>
                    <span>时间：{{ formatMallContactsUploadedAt(record.upload?.uploadedAt || '') }}</span>
                    <span>总数：{{ record.total }}</span>
                    <span v-if="record.upload?.orderId">订单：{{ record.upload.orderId }}</span>
                  </div>
                </template>
                <div class="user-preview-contacts__meta">
                  <span>上传时间：{{ formatMallContactsUploadedAt(record.upload?.uploadedAt || '') }}</span>
                  <span>通讯录总数：{{ record.total }}</span>
                  <span v-if="record.upload?.orderId">关联订单：{{ record.upload.orderId }}</span>
                  <span v-if="record.upload?.uploadId">读取批次：{{ record.upload.uploadId }}</span>
                </div>
                <el-table
                  v-loading="mallContactsLoading"
                  :data="record.list"
                  border
                  size="small"
                  class="user-preview-contacts__table"
                >
                  <el-table-column
                    type="index"
                    width="64"
                    label="序号"
                  />
                  <el-table-column
                    prop="displayName"
                    label="联系人姓名"
                    min-width="160"
                  >
                    <template #default="{ row }">
                      {{ row.displayName || '未命名联系人' }}
                    </template>
                  </el-table-column>
                  <el-table-column
                    label="手机号"
                    min-width="220"
                  >
                    <template #default="{ row }">
                      <span class="tabular-nums">{{ Array.isArray(row.phones) && row.phones.length ? row.phones.join('、') : '暂无号码' }}</span>
                    </template>
                  </el-table-column>
                  <el-table-column
                    prop="contactId"
                    label="通讯录ID"
                    min-width="140"
                  >
                    <template #default="{ row }">
                      <span :class="{ 'user-preview-meta__muted': !row.contactId }">{{ row.contactId || '暂无' }}</span>
                    </template>
                  </el-table-column>
                </el-table>
                <p
                  v-if="record.total > record.list.length"
                  class="user-preview-contacts__preview-note"
                >
                  当前仅预览前 {{ record.list.length }} 条，完整数据已按本次读取批次保存。
                </p>
              </el-collapse-item>
            </el-collapse>
            <div
              v-if="mallContactsTotal > mallContactsPageSize"
              class="user-preview-contacts__pager"
            >
              <el-pagination
                background
                layout="prev, pager, next"
                :current-page="mallContactsPage"
                :page-size="mallContactsPageSize"
                :total="mallContactsTotal"
                @current-change="onMallContactsPageChange"
              />
            </div>
          </div>
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
              <template v-if="isMockImgSrc(user.idCardFront)">
                <div class="user-preview-id-placeholder">
                  <el-icon class="user-preview-id-placeholder__icon"><Picture /></el-icon>
                  <span>模拟证件 · 无图片</span>
                </div>
              </template>
              <el-image
                v-else
                :src="user.idCardFront"
                fit="cover"
                class="user-preview-el-image"
                :preview-src-list="[user.idCardFront]"
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
              <template v-if="isMockImgSrc(user.idCardBack)">
                <div class="user-preview-id-placeholder">
                  <el-icon class="user-preview-id-placeholder__icon"><Picture /></el-icon>
                  <span>模拟证件 · 无图片</span>
                </div>
              </template>
              <el-image
                v-else
                :src="user.idCardBack"
                fit="cover"
                class="user-preview-el-image"
                :preview-src-list="[user.idCardBack]"
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
              手持身份证
            </p>
            <div class="user-preview-id-frame">
              <template v-if="!String(user.idCardHandheld || '').trim()">
                <div class="user-preview-id-placeholder">
                  <el-icon class="user-preview-id-placeholder__icon"><Picture /></el-icon>
                  <span>未上传</span>
                </div>
              </template>
              <template v-else-if="isMockImgSrc(String(user.idCardHandheld))">
                <div class="user-preview-id-placeholder">
                  <el-icon class="user-preview-id-placeholder__icon"><Picture /></el-icon>
                  <span>模拟证件 · 无图片</span>
                </div>
              </template>
              <el-image
                v-else
                :src="String(user.idCardHandheld)"
                fit="cover"
                class="user-preview-el-image"
                :preview-src-list="[String(user.idCardHandheld)]"
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
                <template v-if="panel.checkedAt">
                  档案更新时间 {{ panel.checkedAt }} 
                </template>
              </p>
            </div>
            <span :class="getStatusClass(displayCredit)">
              {{ displayCredit }}
            </span>
          </div>

          <div class="user-preview-risk-seven">
            <article
              v-for="step in panel.steps"
              :key="step.slotKey"
              class="user-preview-risk-step user-preview-risk-step--compact"
            >
              <div class="user-preview-risk-step__head">
                <p class="user-preview-risk-step__label">
                  {{ step.label }}
                </p>
                <div class="user-preview-risk-step__row">
                  <template v-if="step.outcome === 'pass'">
                    <el-icon class="user-preview-risk-icon user-preview-risk-icon--ok" aria-hidden="true">
                      <CircleCheck />
                    </el-icon>
                    <span class="user-preview-risk-outcome">通过</span>
                  </template>
                  <template v-else-if="step.outcome === 'fail'">
                    <el-icon class="user-preview-risk-icon user-preview-risk-icon--bad" aria-hidden="true">
                      <CircleClose />
                    </el-icon>
                    <span class="user-preview-risk-outcome user-preview-risk-outcome--bad">未通过</span>
                  </template>
                  <template v-else-if="step.outcome === 'skip'">
                    <el-icon class="user-preview-risk-icon user-preview-risk-icon--skip" aria-hidden="true">
                      <Minus />
                    </el-icon>
                    <span class="user-preview-risk-outcome user-preview-risk-outcome--skip">已跳过</span>
                  </template>
                  <template v-else>
                    <el-icon class="user-preview-risk-icon user-preview-risk-icon--muted" aria-hidden="true">
                      <Minus />
                    </el-icon>
                    <span class="user-preview-risk-outcome user-preview-risk-outcome--muted">暂无</span>
                  </template>
                </div>
              </div>
              <div
                v-if="step.facts.length"
                class="user-preview-risk-step__facts"
              >
                <div
                  v-for="(line, fi) in step.facts"
                  :key="fi"
                  class="user-preview-risk-fact"
                >
                  <span class="user-preview-risk-fact__k">{{ line.label }}</span>
                  <span
                    class="user-preview-risk-fact__v"
                    :class="{ 'user-preview-risk-fact__v--emph': line.emphasis }"
                    :title="`${line.label}：${line.value}`"
                  >{{ line.value }}</span>
                </div>
              </div>
              <p
                v-if="step.detail"
                class="user-preview-risk-step__detail"
                :title="step.detail"
              >
                {{ step.detail }}
              </p>
            </article>
          </div>

          <div class="user-preview-risk-radar">
            <article class="user-preview-risk-step user-preview-risk-step--compact user-preview-risk-step--radar">
              <div class="user-preview-risk-step__head">
                <p class="user-preview-risk-step__label">
                  {{ panel.radarStep.label }}
                </p>
                <div class="user-preview-risk-step__row">
                  <template v-if="panel.radarStep.outcome === 'pass'">
                    <el-icon class="user-preview-risk-icon user-preview-risk-icon--ok" aria-hidden="true">
                      <CircleCheck />
                    </el-icon>
                    <span class="user-preview-risk-outcome">通过</span>
                  </template>
                  <template v-else-if="panel.radarStep.outcome === 'fail'">
                    <el-icon class="user-preview-risk-icon user-preview-risk-icon--bad" aria-hidden="true">
                      <CircleClose />
                    </el-icon>
                    <span class="user-preview-risk-outcome user-preview-risk-outcome--bad">未通过</span>
                  </template>
                  <template v-else-if="panel.radarStep.outcome === 'skip'">
                    <el-icon class="user-preview-risk-icon user-preview-risk-icon--skip" aria-hidden="true">
                      <Minus />
                    </el-icon>
                    <span class="user-preview-risk-outcome user-preview-risk-outcome--skip">已跳过</span>
                  </template>
                  <template v-else>
                    <el-icon class="user-preview-risk-icon user-preview-risk-icon--muted" aria-hidden="true">
                      <Minus />
                    </el-icon>
                    <span class="user-preview-risk-outcome user-preview-risk-outcome--muted">暂无</span>
                  </template>
                </div>
              </div>
              <div
                v-if="panel.radarStep.facts.length"
                class="user-preview-radar-facts-wrap"
              >
                <template
                  v-if="radarGrouped.sections.length > 0 || radarGrouped.reportNote"
                >
                  <p
                    v-if="radarGrouped.reportNote"
                    class="user-preview-radar-report-note"
                  >
                    {{ radarGrouped.reportNote }}
                  </p>
                  <div
                    v-for="(sec, si) in radarGrouped.sections"
                    :key="si"
                    class="user-preview-radar-sec"
                  >
                    <div class="user-preview-radar-sec__head">
                      <h4 class="user-preview-radar-sec__title">
                        {{ sec.title }}
                      </h4>
                      <p
                        v-if="sec.subtitle"
                        class="user-preview-radar-sec__sub"
                      >
                        {{ sec.subtitle }}
                      </p>
                    </div>
                    <div class="user-preview-radar-table-scroll">
                      <table
                        class="user-preview-radar-table user-preview-radar-table--multi"
                        :aria-label="`${sec.title}指标`"
                      >
                        <thead>
                          <tr>
                            <template
                              v-for="hi in previewRadarPairHeadIndexes"
                              :key="hi"
                            >
                              <th scope="col">
                                指标
                              </th>
                              <th scope="col">
                                取值
                              </th>
                            </template>
                          </tr>
                        </thead>
                        <tbody>
                          <tr v-if="!sec.rows.length">
                            <td
                              :colspan="PREVIEW_RADAR_TABLE_COLSPAN"
                              class="user-preview-radar-table__empty"
                            >
                              查询无数据
                            </td>
                          </tr>
                          <template v-else>
                            <tr
                              v-for="(chunk, ci) in chunkRadarFactPairs(sec.rows, PREVIEW_RADAR_PAIR_COLUMNS)"
                              :key="ci"
                            >
                              <template
                                v-for="(cell, idx) in chunk"
                                :key="idx"
                              >
                                <td class="user-preview-radar-table__label">
                                  {{ cell.label }}
                                </td>
                                <td
                                  class="user-preview-radar-table__value"
                                  :class="{ 'user-preview-radar-table__value--emphasis': cell.emphasis }"
                                >
                                  {{ cell.value }}
                                </td>
                              </template>
                              <td
                                v-if="chunk.length < PREVIEW_RADAR_PAIR_COLUMNS"
                                :colspan="(PREVIEW_RADAR_PAIR_COLUMNS - chunk.length) * 2"
                                class="user-preview-radar-table__pad"
                              ></td>
                            </tr>
                          </template>
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div
                    v-if="radarGrouped.extras.length"
                    class="user-preview-radar-sec"
                  >
                    <div class="user-preview-radar-sec__head">
                      <h4 class="user-preview-radar-sec__title">
                        其它信息
                      </h4>
                    </div>
                    <div class="user-preview-radar-table-scroll">
                      <table
                        class="user-preview-radar-table user-preview-radar-table--multi"
                        aria-label="其它信息"
                      >
                        <thead>
                          <tr>
                            <template
                              v-for="hi in previewRadarPairHeadIndexes"
                              :key="hi"
                            >
                              <th scope="col">
                                项目
                              </th>
                              <th scope="col">
                                内容
                              </th>
                            </template>
                          </tr>
                        </thead>
                        <tbody>
                          <tr
                            v-for="(chunk, ci) in chunkRadarFactPairs(radarGrouped.extras, PREVIEW_RADAR_PAIR_COLUMNS)"
                            :key="ci"
                          >
                            <template
                              v-for="(ex, idx) in chunk"
                              :key="idx"
                            >
                              <td class="user-preview-radar-table__label">
                                {{ ex.label }}
                              </td>
                              <td
                                class="user-preview-radar-table__value"
                                :class="{ 'user-preview-radar-table__value--emphasis': ex.emphasis }"
                              >
                                {{ ex.value }}
                              </td>
                            </template>
                            <td
                              v-if="chunk.length < PREVIEW_RADAR_PAIR_COLUMNS"
                              :colspan="(PREVIEW_RADAR_PAIR_COLUMNS - chunk.length) * 2"
                              class="user-preview-radar-table__pad"
                            ></td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </template>
                <template v-else>
                  <div class="user-preview-radar-table-scroll">
                    <table
                      class="user-preview-radar-table user-preview-radar-table--multi"
                      aria-label="全景雷达数据"
                    >
                      <thead>
                        <tr>
                          <template
                            v-for="hi in previewRadarPairHeadIndexes"
                            :key="hi"
                          >
                            <th scope="col">
                              项目
                            </th>
                            <th scope="col">
                              内容
                            </th>
                          </template>
                        </tr>
                      </thead>
                      <tbody>
                        <tr
                          v-for="(chunk, ci) in chunkRadarFactPairs(panel.radarStep.facts, PREVIEW_RADAR_PAIR_COLUMNS)"
                          :key="ci"
                        >
                          <template
                            v-for="(fl, idx) in chunk"
                            :key="idx"
                          >
                            <td class="user-preview-radar-table__label">
                              {{ fl.label }}
                            </td>
                            <td
                              class="user-preview-radar-table__value"
                              :class="{ 'user-preview-radar-table__value--emphasis': fl.emphasis }"
                            >
                              {{ fl.value }}
                            </td>
                          </template>
                          <td
                            v-if="chunk.length < PREVIEW_RADAR_PAIR_COLUMNS"
                            :colspan="(PREVIEW_RADAR_PAIR_COLUMNS - chunk.length) * 2"
                            class="user-preview-radar-table__pad"
                          ></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </template>
              </div>
              <p
                v-if="panel.radarStep.detail"
                class="user-preview-risk-step__detail user-preview-risk-step__detail--radar"
                :title="panel.radarStep.detail"
              >
                {{ panel.radarStep.detail }}
              </p>
            </article>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.uri-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.uri-panel--bare {
  background: transparent;
  border: none;
  max-height: none;
}

.uri-panel--embedded {
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid #e8ecf1;
  background: linear-gradient(180deg, #fafbfc 0%, #fff 120px);
  max-height: min(72vh, 720px);
}

.user-preview-scroll--nested {
  padding: 0;
  flex: none;
  overflow: visible;
  min-height: 0;
}

.user-preview-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 18px 12px;
  border-bottom: 1px solid #e8ecf1;
  background: #fff;
  flex-shrink: 0;
}

.uri-close-btn {
  flex-shrink: 0;
  margin-top: 2px;
  font-size: 14px;
}

.user-preview-head__titles {
  min-width: 0;
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

.user-preview-meta__muted {
  color: #94a3b8;
}

.user-preview-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 16px 22px 12px;
  min-height: 0;
}

.user-preview-scroll--embedded {
  max-height: min(60vh, 620px);
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

.user-preview-shipping-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px 14px;
  flex-wrap: wrap;
}

.user-preview-shipping-head__text {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.user-preview-shipping-copy-all {
  flex-shrink: 0;
  font-weight: 600;
  padding: 0 4px;
}

.user-preview-shipping-table-wrap {
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid #e2e8f0;
}

.user-preview-shipping-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: 14px;
  line-height: 1.55;
}

.user-preview-shipping-table th,
.user-preview-shipping-table td {
  border: 1px solid #e2e8f0;
  padding: 10px 12px;
  vertical-align: top;
  text-align: left;
}

.user-preview-shipping-table th {
  width: 112px;
  box-sizing: border-box;
  font-weight: 600;
  color: #64748b;
  background: #f8fafc;
  white-space: nowrap;
}

.user-preview-shipping-table td {
  color: #0f172a;
  background: #fff;
  word-break: break-word;
}

.user-preview-receiver-text {
  margin: 0;
  font-size: 14px;
  line-height: 1.55;
  color: #0f172a;
  white-space: pre-wrap;
  word-break: break-word;
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

.remark-preview {
  margin: 0;
  line-height: 1.45;
  max-height: 4.35em;
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
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

.credit-badge {
  display: inline-flex;
  align-items: center;
  height: 24px;
  border-radius: 999px;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 600;
}

.badge-ok {
  color: #1d4ed8;
  background: #dbeafe;
}

.badge-pending {
  color: #b45309;
  background: #fef3c7;
}

.badge-risk {
  color: #b91c1c;
  background: #fee2e2;
}

.user-preview-id-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

@media (max-width: 900px) {
  .user-preview-id-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
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

.user-preview-risk-seven {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

@media (max-width: 720px) {
  .user-preview-risk-seven {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .user-preview-risk-seven {
    grid-template-columns: 1fr;
  }
}

.user-preview-risk-step {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 8px 10px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}

.user-preview-risk-step--compact {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.user-preview-risk-step__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 6px 8px;
  flex-wrap: wrap;
}

.user-preview-risk-step__label {
  margin: 0;
  flex: 1;
  min-width: 0;
  font-size: 11px;
  font-weight: 600;
  color: #334155;
  line-height: 1.35;
}

.user-preview-risk-step__row {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 4px;
  flex-shrink: 0;
}

.user-preview-risk-icon {
  font-size: 16px;
}

.user-preview-risk-outcome {
  font-size: 11px;
  font-weight: 600;
  color: #15803d;
}

.user-preview-risk-icon--ok {
  color: #16a34a;
}

.user-preview-risk-icon--bad {
  color: #dc2626;
}

.user-preview-risk-icon--skip {
  color: #d97706;
}

.user-preview-risk-icon--muted {
  color: #94a3b8;
}

.user-preview-risk-outcome--bad {
  color: #b91c1c;
}

.user-preview-risk-outcome--skip {
  color: #b45309;
}

.user-preview-risk-outcome--muted {
  font-weight: 500;
  color: #64748b;
}

.user-preview-risk-step__facts {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 3px 8px;
  margin-top: 2px;
  font-size: 11px;
  line-height: 1.35;
}

.user-preview-risk-fact {
  display: flex;
  flex-wrap: nowrap;
  align-items: baseline;
  gap: 3px 5px;
  min-width: 0;
}

.user-preview-risk-fact__k {
  flex-shrink: 0;
  color: #64748b;
  white-space: nowrap;
}

.user-preview-risk-fact__v {
  flex: 1;
  min-width: 0;
  color: #475569;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.user-preview-risk-fact__v--emph {
  font-weight: 600;
  color: #0f172a;
}

.user-preview-risk-radar {
  margin-top: 10px;
}

.user-preview-radar-facts-wrap {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 8px;
}

.user-preview-radar-report-note {
  margin: 0;
  padding: 8px 10px;
  font-size: 11px;
  line-height: 1.5;
  color: #334155;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}

.user-preview-radar-sec {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.user-preview-radar-sec__head {
  padding: 0 2px;
}

.user-preview-radar-sec__title {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  color: #0f172a;
  letter-spacing: 0.02em;
}

.user-preview-radar-sec__sub {
  margin: 2px 0 0;
  font-size: 11px;
  line-height: 1.45;
  color: #64748b;
}

.user-preview-radar-table-scroll {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
}

.user-preview-radar-table {
  width: 100%;
  min-width: 640px;
  border-collapse: collapse;
  font-size: 11px;
  background: #fff;
}

.user-preview-radar-table--multi {
  table-layout: fixed;
  min-width: 720px;
}

.user-preview-radar-table--multi .user-preview-radar-table__label {
  width: 15%;
  max-width: none;
}

.user-preview-radar-table__pad {
  border-bottom: 1px solid #f1f5f9;
  background: #fafbfc;
}

.user-preview-radar-table thead th {
  text-align: left;
  padding: 6px 10px;
  font-weight: 600;
  color: #475569;
  background: linear-gradient(180deg, #f1f5f9 0%, #e8eef5 100%);
  border-bottom: 1px solid #cbd5e1;
  white-space: nowrap;
}

.user-preview-radar-table tbody td {
  padding: 6px 10px;
  border-bottom: 1px solid #f1f5f9;
  vertical-align: top;
}

.user-preview-radar-table tbody tr:last-child td {
  border-bottom: none;
}

.user-preview-radar-table tbody tr:nth-child(even) td {
  background: #fafbfc;
}

.user-preview-radar-table__label {
  width: 46%;
  max-width: 260px;
  color: #334155;
  font-weight: 500;
  word-break: break-word;
}

.user-preview-radar-table__value {
  color: #0f172a;
  word-break: break-word;
}

.user-preview-radar-table__value--emphasis {
  font-weight: 700;
  color: #1d4ed8;
}

.user-preview-radar-table__empty {
  text-align: center;
  color: #94a3b8;
  font-size: 11px;
  padding: 12px 10px;
}

.user-preview-risk-step__detail--radar {
  -webkit-line-clamp: 6;
}

.user-preview-risk-step__detail {
  margin: 8px 0 0;
  font-size: 11px;
  line-height: 1.45;
  color: #64748b;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.user-preview-contacts-block {
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 14px;
  background: #fbfdff;
}

.user-preview-contacts-head {
  justify-content: space-between;
  gap: 12px;
}

.user-preview-contacts-head__text {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.user-preview-contacts {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.user-preview-contacts__summary {
  padding: 10px 12px;
  border: 1px solid #dbeafe;
  border-radius: 10px;
  background: #eff6ff;
  color: #1d4ed8;
  font-size: 12px;
  line-height: 1.6;
}

.user-preview-contacts__collapse {
  --el-collapse-border-color: transparent;
}

.user-preview-contacts__collapse :deep(.el-collapse-item) {
  margin-bottom: 10px;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  overflow: hidden;
  background: #fff;
}

.user-preview-contacts__collapse :deep(.el-collapse-item__header) {
  min-height: 46px;
  padding: 0 12px;
  border-bottom: 1px solid #e2e8f0;
  background: #f8fafc;
}

.user-preview-contacts__collapse :deep(.el-collapse-item__wrap) {
  border-bottom: 0;
}

.user-preview-contacts__collapse :deep(.el-collapse-item__content) {
  padding: 12px;
}

.user-preview-contacts-record-title {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 12px;
  min-width: 0;
  color: #334155;
  font-size: 12px;
}

.user-preview-contacts-record-title strong {
  color: #0f172a;
  font-size: 13px;
}

.user-preview-contacts__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  padding: 10px 12px;
  border-radius: 10px;
  background: #f1f5f9;
  color: #475569;
  font-size: 12px;
}

.user-preview-contacts__table {
  width: 100%;
}

.user-preview-contacts__preview-note {
  margin: 8px 0 0;
  color: #64748b;
  font-size: 12px;
}

.user-preview-contacts__pager {
  display: flex;
  justify-content: flex-end;
}
</style>
