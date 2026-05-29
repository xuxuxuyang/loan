<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import TrafficPartnerLogo from '../components/TrafficPartnerLogo.vue'
import { clearTrafficPartnerSession, getTrafficPartnerSession } from '../composables/useTrafficPartnerAuth'
import { trafficPartnerFetch } from '../composables/useTrafficPartnerApi'

const MALL_H5_ORIGIN = (import.meta.env.VITE_MALL_H5_ORIGIN || '').replace(/\/$/, '')
const isViteDev = import.meta.env.DEV

interface TrafficPartnerStatsRow {
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

const router = useRouter()
const session = getTrafficPartnerSession()
const loading = ref(false)
const rows = ref<TrafficPartnerStatsRow[]>([])
const errorMessage = ref('')

const tableHeaderCellStyle = {
  background: '#f1f5f9',
  color: '#1e3a8a',
  fontWeight: 600 as const,
}

/** 与 admin TrafficManagementPage / api buildTrafficPartnerPortalStatsRow 同口径 */
const STAT_HEADER_TIPS = {
  clickCount: '推广链接的点击数',
  registerCount: '推广链接的点击数中，注册的用户数',
  applicationCount: '推广链接的点击数中，申请的用户数',
  approvedCount: '推广链接的点击数中，通过的用户数',
  overdueCount: '推广链接的点击数中，逾期的用户数',
  registerRate: '注册率 = 注册用户数 / 点击数',
  applicationRate: '申请率 = 申请用户数 / 注册用户数',
  approvalRate: '通过率 = 通过用户数 / 申请用户数',
  overdueRate: '逾期率 = 逾期用户数 / 通过用户数',
  registrationConversionRate: '注册转化率 = 通过用户数 / 注册用户数',
  applicationConversionRate: '申请转化率 = 申请用户数 / 通过用户数',
} as const

const displayName = computed(() => session?.name || session?.username || '流量商')

const summary = computed(() => {
  if (!rows.value.length) {
    return null
  }
  const init = {
    clickCount: 0,
    registerCount: 0,
    applicationCount: 0,
    approvedCount: 0,
    overdueCount: 0,
  }
  return rows.value.reduce((acc, r) => ({
    clickCount: acc.clickCount + (r.clickCount || 0),
    registerCount: acc.registerCount + (r.registerCount || 0),
    applicationCount: acc.applicationCount + (r.applicationCount || 0),
    approvedCount: acc.approvedCount + (r.approvedCount || 0),
    overdueCount: acc.overdueCount + (r.overdueCount || 0),
  }), init)
})

const h5BaseForLink = computed(() => {
  if (MALL_H5_ORIGIN) {
    return MALL_H5_ORIGIN
  }
  if (typeof window !== 'undefined' && window.location?.origin) {
    const origin = window.location.origin.replace(/\/$/, '')
    if (isViteDev) {
      try {
        const u = new URL(origin)
        const port = u.port || (u.protocol === 'https:' ? '443' : '80')
        const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1'
        if (local && port === '5175') {
          return `${u.protocol}//${u.hostname}:5173`
        }
      }
      catch {
        /* ignore */
      }
    }
    else {
      try {
        const u = new URL(origin)
        if (u.protocol === 'http:' && u.port === '8080') {
          return `${u.protocol}//${u.hostname}`
        }
      }
      catch {
        /* ignore */
      }
    }
    return origin
  }
  return ''
})

const primaryPromoCode = computed(() => rows.value[0]?.code || '')

function fullPromotionUrl(code: string) {
  const base = h5BaseForLink.value
  const path = `/?channel=${encodeURIComponent(code)}`
  return base ? `${base}${path}` : path
}

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
    ElMessage.success('推广链接已复制')
  }
  else {
    ElMessage.error('复制失败，请手动复制')
  }
}

function formatRate(value: number | null | undefined) {
  if (value == null || Number.isNaN(Number(value))) {
    return '—'
  }
  return Number(value).toFixed(2)
}

function logout() {
  clearTrafficPartnerSession()
  router.replace({ name: 'login' })
}

async function loadStats() {
  loading.value = true
  errorMessage.value = ''
  try {
    const result = await trafficPartnerFetch('/traffic-partner/stats')
    rows.value = Array.isArray(result.data) ? result.data as TrafficPartnerStatsRow[] : []
  }
  catch (e) {
    errorMessage.value = e instanceof Error ? e.message : '加载失败'
    rows.value = []
  }
  finally {
    loading.value = false
  }
}

onMounted(() => {
  loadStats()
})
</script>

<template>
  <div class="workspace">
      <header class="workspace__topbar">
        <div class="workspace__brand">
          <TrafficPartnerLogo :size="40" />
          <div>
            <p class="workspace__brand-label">
              流量商数据平台
            </p>
            <h1 class="workspace__brand-title">
              引流数据
            </h1>
          </div>
          <el-tag
            type="primary"
            effect="dark"
            round
            class="workspace__partner-tag"
          >
            {{ displayName }}
          </el-tag>
        </div>
        <div class="workspace__actions">
          <el-button
            :loading="loading"
            @click="loadStats"
          >
            刷新数据
          </el-button>
          <el-button @click="logout">
            退出登录
          </el-button>
        </div>
      </header>

      <main class="workspace__main">
        <el-alert
          v-if="errorMessage && !loading"
          type="error"
          :title="errorMessage"
          show-icon
          :closable="false"
          class="workspace__alert"
        />

        <section
          v-if="summary"
          class="kpi-row"
        >
          <div class="kpi-card kpi-card--click">
            <span class="kpi-card__label">点击数</span>
            <strong class="kpi-card__value">{{ summary.clickCount }}</strong>
          </div>
          <div class="kpi-card kpi-card--register">
            <span class="kpi-card__label">注册数</span>
            <strong class="kpi-card__value">{{ summary.registerCount }}</strong>
          </div>
          <div class="kpi-card kpi-card--apply">
            <span class="kpi-card__label">申请数</span>
            <strong class="kpi-card__value">{{ summary.applicationCount }}</strong>
          </div>
          <div class="kpi-card kpi-card--pass">
            <span class="kpi-card__label">通过数</span>
            <strong class="kpi-card__value">{{ summary.approvedCount }}</strong>
          </div>
          <div class="kpi-card kpi-card--overdue">
            <span class="kpi-card__label">逾期数</span>
            <strong class="kpi-card__value">{{ summary.overdueCount }}</strong>
          </div>
        </section>

        <section class="panel">
          <div class="panel__head">
            <div>
              <h2 class="panel__title">
                引流概览
              </h2>
              <p class="panel__desc">
                推广链接访问、注册与转化全链路数据
              </p>
            </div>
            <div
              v-if="primaryPromoCode"
              class="panel__promo-quick"
            >
              <span class="panel__promo-label">推广链接</span>
              <el-button
                type="primary"
                size="small"
                @click="copyPromotionLink(primaryPromoCode)"
              >
                一键复制
              </el-button>
            </div>
          </div>

          <div class="panel__body">
            <el-table
              v-loading="loading"
              :data="rows"
              stripe
              border
              size="default"
              class="data-table"
              :header-cell-style="tableHeaderCellStyle"
              empty-text="暂无数据，请联系管理员配置渠道"
            >
              <el-table-column
                label="渠道名称"
                min-width="120"
                show-overflow-tooltip
              >
                <template #default="{ row }">
                  <el-tag
                    type="primary"
                    effect="plain"
                    round
                  >
                    {{ row.name || row.code }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column
                label="推广链接"
                min-width="240"
              >
                <template #default="{ row }">
                  <div class="promo-link">
                    <el-tooltip
                      :content="fullPromotionUrl(row.code)"
                      placement="top"
                      :show-after="300"
                    >
                      <code class="promo-link__url">{{ fullPromotionUrl(row.code) }}</code>
                    </el-tooltip>
                    <el-button
                      type="primary"
                      link
                      size="small"
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
                  <span class="stat-col-header">
                    点击数
                    <el-tooltip
                      :content="STAT_HEADER_TIPS.clickCount"
                      placement="top"
                      :show-after="300"
                    >
                      <span
                        class="stat-col-header__tip"
                        aria-label="点击数计算规则"
                      >?</span>
                    </el-tooltip>
                  </span>
                </template>
                <template #default="{ row }">
                  {{ row.clickCount }}
                </template>
              </el-table-column>
              <el-table-column
                width="88"
                align="center"
              >
                <template #header>
                  <span class="stat-col-header">
                    注册数
                    <el-tooltip
                      :content="STAT_HEADER_TIPS.registerCount"
                      placement="top"
                      :show-after="300"
                    >
                      <span
                        class="stat-col-header__tip"
                        aria-hidden="true"
                      >?</span>
                    </el-tooltip>
                  </span>
                </template>
                <template #default="{ row }">
                  {{ row.registerCount }}
                </template>
              </el-table-column>
              <el-table-column
                width="88"
                align="center"
              >
                <template #header>
                  <span class="stat-col-header">
                    申请数
                    <el-tooltip
                      :content="STAT_HEADER_TIPS.applicationCount"
                      placement="top"
                      :show-after="300"
                    >
                      <span class="stat-col-header__tip" aria-hidden="true">?</span>
                    </el-tooltip>
                  </span>
                </template>
                <template #default="{ row }">
                  <span class="num-highlight">{{ row.applicationCount }}</span>
                </template>
              </el-table-column>
              <el-table-column
                width="88"
                align="center"
              >
                <template #header>
                  <span class="stat-col-header">
                    通过数
                    <el-tooltip
                      :content="STAT_HEADER_TIPS.approvedCount"
                      placement="top"
                      :show-after="300"
                    >
                      <span class="stat-col-header__tip" aria-hidden="true">?</span>
                    </el-tooltip>
                  </span>
                </template>
                <template #default="{ row }">
                  <span class="num-highlight">{{ row.approvedCount }}</span>
                </template>
              </el-table-column>
              <el-table-column
                width="88"
                align="center"
              >
                <template #header>
                  <span class="stat-col-header">
                    逾期数
                    <el-tooltip
                      :content="STAT_HEADER_TIPS.overdueCount"
                      placement="top"
                      :show-after="300"
                    >
                      <span class="stat-col-header__tip" aria-hidden="true">?</span>
                    </el-tooltip>
                  </span>
                </template>
                <template #default="{ row }">
                  {{ row.overdueCount }}
                </template>
              </el-table-column>
              <el-table-column
                width="96"
                align="center"
              >
                <template #header>
                  <span class="stat-col-header">
                    注册率
                    <el-tooltip
                      :content="STAT_HEADER_TIPS.registerRate"
                      placement="top"
                      :show-after="300"
                    >
                      <span class="stat-col-header__tip" aria-hidden="true">?</span>
                    </el-tooltip>
                  </span>
                </template>
                <template #default="{ row }">
                  {{ formatRate(row.registerRate) }}
                </template>
              </el-table-column>
              <el-table-column
                width="96"
                align="center"
              >
                <template #header>
                  <span class="stat-col-header">
                    申请率
                    <el-tooltip
                      :content="STAT_HEADER_TIPS.applicationRate"
                      placement="top"
                      :show-after="300"
                    >
                      <span class="stat-col-header__tip" aria-hidden="true">?</span>
                    </el-tooltip>
                  </span>
                </template>
                <template #default="{ row }">
                  {{ formatRate(row.applicationRate) }}
                </template>
              </el-table-column>
              <el-table-column
                width="96"
                align="center"
              >
                <template #header>
                  <span class="stat-col-header">
                    通过率
                    <el-tooltip
                      :content="STAT_HEADER_TIPS.approvalRate"
                      placement="top"
                      :show-after="300"
                    >
                      <span class="stat-col-header__tip" aria-hidden="true">?</span>
                    </el-tooltip>
                  </span>
                </template>
                <template #default="{ row }">
                  {{ formatRate(row.approvalRate) }}
                </template>
              </el-table-column>
              <el-table-column
                width="96"
                align="center"
              >
                <template #header>
                  <span class="stat-col-header">
                    逾期率
                    <el-tooltip
                      :content="STAT_HEADER_TIPS.overdueRate"
                      placement="top"
                      :show-after="300"
                    >
                      <span class="stat-col-header__tip" aria-hidden="true">?</span>
                    </el-tooltip>
                  </span>
                </template>
                <template #default="{ row }">
                  {{ formatRate(row.overdueRate) }}
                </template>
              </el-table-column>
              <el-table-column
                width="108"
                align="center"
              >
                <template #header>
                  <span class="stat-col-header">
                    注册转化率
                    <el-tooltip
                      :content="STAT_HEADER_TIPS.registrationConversionRate"
                      placement="top"
                      :show-after="300"
                    >
                      <span class="stat-col-header__tip" aria-hidden="true">?</span>
                    </el-tooltip>
                  </span>
                </template>
                <template #default="{ row }">
                  {{ formatRate(row.registrationConversionRate) }}
                </template>
              </el-table-column>
              <el-table-column
                width="108"
                align="center"
              >
                <template #header>
                  <span class="stat-col-header">
                    申请转化率
                    <el-tooltip
                      :content="STAT_HEADER_TIPS.applicationConversionRate"
                      placement="top"
                      :show-after="300"
                    >
                      <span class="stat-col-header__tip" aria-hidden="true">?</span>
                    </el-tooltip>
                  </span>
                </template>
                <template #default="{ row }">
                  {{ formatRate(row.applicationConversionRate) }}
                </template>
              </el-table-column>
            </el-table>
          </div>
        </section>
      </main>
    </div>
</template>

<style scoped>
.workspace {
  min-height: 100vh;
  background:
    linear-gradient(180deg, #dbeafe 0%, #eff6ff 120px, #f1f5f9 280px);
}

.workspace__topbar {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 24px;
  background: rgba(255, 255, 255, 0.92);
  border-bottom: 1px solid rgba(30, 58, 138, 0.08);
  box-shadow: 0 4px 24px rgba(15, 23, 42, 0.06);
  backdrop-filter: blur(10px);
}

.workspace__brand {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.workspace__brand-label {
  margin: 0;
  font-size: 12px;
  color: #64748b;
  letter-spacing: 0.04em;
}

.workspace__brand-title {
  margin: 2px 0 0;
  font-size: 18px;
  font-weight: 700;
  color: #1e3a8a;
}

.workspace__partner-tag {
  margin-left: 8px;
  flex-shrink: 0;
}

.workspace__actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.workspace__main {
  max-width: 1400px;
  margin: 0 auto;
  padding: 20px 20px 40px;
}

.workspace__alert {
  margin-bottom: 16px;
}

.kpi-row {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 14px;
  margin-bottom: 20px;
}

.kpi-card {
  padding: 16px 18px;
  border-radius: 12px;
  background: #fff;
  border: 1px solid rgba(30, 58, 138, 0.08);
  box-shadow: 0 4px 16px rgba(15, 23, 42, 0.04);
}

.kpi-card__label {
  display: block;
  font-size: 13px;
  color: #64748b;
  margin-bottom: 8px;
}

.kpi-card__value {
  font-size: 26px;
  font-weight: 700;
  line-height: 1.1;
  color: #0f172a;
}

.kpi-card--click .kpi-card__value { color: #2563eb; }
.kpi-card--register .kpi-card__value { color: #0891b2; }
.kpi-card--apply .kpi-card__value { color: #7c3aed; }
.kpi-card--pass .kpi-card__value { color: #059669; }
.kpi-card--overdue .kpi-card__value { color: #dc2626; }

.panel {
  background: #fff;
  border-radius: 14px;
  border: 1px solid rgba(30, 58, 138, 0.08);
  box-shadow: 0 8px 28px rgba(15, 23, 42, 0.06);
  margin-bottom: 20px;
  overflow: hidden;
}

.panel__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 20px 0;
}

.panel__title {
  margin: 0 0 4px;
  font-size: 16px;
  font-weight: 700;
  color: #1e3a8a;
}

.panel__desc {
  margin: 0;
  font-size: 13px;
  color: #94a3b8;
}

.panel__promo-quick {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.panel__promo-label {
  font-size: 13px;
  color: #64748b;
}

.panel__body {
  padding: 16px 20px 20px;
  overflow-x: auto;
}

.promo-link {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.promo-link__url {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: #475569;
  background: #f8fafc;
  padding: 4px 8px;
  border-radius: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.num-highlight {
  color: #2563eb;
  font-weight: 600;
}

.stat-col-header {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
}

.stat-col-header__tip {
  font-size: 14px;
  color: #94a3b8;
  cursor: help;
  vertical-align: middle;
}

@media (max-width: 1100px) {
  .kpi-row {
    grid-template-columns: repeat(3, 1fr);
  }
}

@media (max-width: 720px) {
  .workspace__topbar {
    flex-wrap: wrap;
    padding: 12px 16px;
  }

  .workspace__partner-tag {
    display: none;
  }

  .kpi-row {
    grid-template-columns: repeat(2, 1fr);
  }

  .panel__head {
    flex-direction: column;
  }
}
</style>
