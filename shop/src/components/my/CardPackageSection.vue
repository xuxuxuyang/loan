<script setup lang="ts">
import { nextTick } from 'vue'
import type { MallCardPackageDTO } from '~/api/modules/mall'
import kefuQrUrl from '~/assets/kefu.png'

defineProps<{
  /** 为 true 时使用更紧凑的移动端字号与间距 */
  compact?: boolean
  /** 独立页面已展示标题时隐藏内部标题 */
  hideHeading?: boolean
}>()

const { loginPhone, profile, syncFromStorage } = useMallAuth()
const {
  cardPackages,
  fetchCardPackages,
  fetchCardPackageContractFlow,
  downloadCardPackageContractBlob,
} = useMallMy()

const account = computed(() => loginPhone.value || profile.value?.phone || '')
const isValidAccount = computed(() => /^1\d{10}$/.test(account.value))
const loading = ref(false)
const dialogVisible = ref(false)
const activeItem = ref<MallCardPackageDTO | null>(null)

const CARD_PACKAGE_CONTRACT_SIGNED_MSG = 'mall-card-package-contract-signed'

/** 业务：订单金额 = 卡包金额 × 135% + 50；列表「现金礼」展示反推的卡包金额：(订单金额 − 50) ÷ 1.35 */
const CARD_PACKAGE_REVERSE_FIXED = 50
const CARD_PACKAGE_REVERSE_RATE = 1.35

function reverseCardPackageDisplayAmount(item: MallCardPackageDTO): number {
  const orderAmt = Number(item.totalAmount || 0)
  if (
    !Number.isFinite(orderAmt)
    || orderAmt <= CARD_PACKAGE_REVERSE_FIXED
    || !Number.isFinite(CARD_PACKAGE_REVERSE_RATE)
    || CARD_PACKAGE_REVERSE_RATE <= 0
  ) {
    return Number(item.packageAmount || 0)
  }
  return (orderAmt - CARD_PACKAGE_REVERSE_FIXED) / CARD_PACKAGE_REVERSE_RATE
}

function formatReverseCardPackageDisplay(item: MallCardPackageDTO): string {
  const n = reverseCardPackageDisplayAmount(item)
  return Number.isFinite(n) ? n.toFixed(2) : '0.00'
}

const contractDialogVisible = ref(false)
/** 领取入口：先问是否去签署（小弹窗） */
const preClaimPromptVisible = ref(false)
const contractLoading = ref(false)
/** 合同 PDF 下载中：全屏遮罩 + 按钮禁用，避免重复点击（不依赖 ElLoading，避免被弹层盖住） */
const contractDownloadBusy = ref(false)
/** 当前下载请求的 AbortController，供「取消下载」调用 */
const contractDownloadAbort = ref<AbortController | null>(null)
/** 用户主动点取消（与超时触发的 abort 区分） */
const contractDownloadCancelledByUser = ref(false)
const contractError = ref('')
const contractRoot = ref<Record<string, unknown> | null>(null)
/** 独立弹层：阅读签署 / 仅查看 */
const contractIframeKey = ref(0)
const contractSignFrameVisible = ref(false)
const contractFrameMode = ref<'sign' | 'view'>('sign')

/** API 返回中含上游对接提示时，展示简要运维说明 */
const showContractUpstreamHint = computed(() => {
  const e = contractError.value || ''
  return /签名|签署方|serialNo|signAuthSerialNo|MALL_CARD_PACKAGE/i.test(e)
})

async function refreshList() {
  const phone = account.value
  if (!/^1\d{10}$/.test(phone)) {
    cardPackages.value = []
    return
  }
  loading.value = true
  try {
    await fetchCardPackages(phone)
  }
  finally {
    loading.value = false
  }
}

if (!import.meta.env.SSR) {
  void syncFromStorage().then(refreshList)
}

watch(account, () => {
  void refreshList()
})

function formatTime(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) {
    return iso
  }
  const y = d.getFullYear()
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${y}-${m}-${day}`
}

function contractPayloadData(root: Record<string, unknown> | null) {
  if (!root || typeof root !== 'object') {
    return null
  }
  const d = root.data
  return d && typeof d === 'object' && !Array.isArray(d) ? (d as Record<string, unknown>) : null
}

const contractData = computed(() => contractPayloadData(contractRoot.value))

const contractShowsSigned = computed(() => {
  const s = contractData.value?.status
  return String(s ?? '') === '2'
})

/** 仅展示：未签约 / 已签约（不对用户展示「签约中」等中间态） */
const contractBinaryStatusLabel = computed(() => {
  return contractShowsSigned.value ? '已签约' : '未签约'
})

const contractSignUrl = computed(() => {
  const d = contractData.value
  if (!d) {
    return ''
  }
  const users = Array.isArray(d.signUser) ? (d.signUser as Record<string, unknown>[]) : []
  const first = users.find(u => u && String(u.signUrl || '').trim())
  if (first) {
    return String(first.signUrl).trim()
  }
  return String(d.signUrl || d.sign_url || '').trim()
})

const contractPreviewUrl = computed(() => {
  const d = contractData.value
  if (!d) {
    return ''
  }
  return String(d.previewUrl || d.preview_url || d.embeddedUrl || d.embedded_url || '').trim()
})

/** 本页 iframe 使用的签署/预览地址 */
const contractEmbedUrl = computed(() => contractSignUrl.value || contractPreviewUrl.value)

function trustedContractPostMessageOrigin(ev: MessageEvent): boolean {
  const url = contractEmbedUrl.value
  if (!url) {
    return false
  }
  try {
    return ev.origin === new URL(url, window.location.href).origin
  }
  catch {
    return false
  }
}

function onContractSignedPostMessage(ev: MessageEvent) {
  if (!trustedContractPostMessageOrigin(ev)) {
    return
  }
  const data = ev.data as { type?: string, orderId?: string } | null
  if (!data || typeof data !== 'object' || data.type !== CARD_PACKAGE_CONTRACT_SIGNED_MSG) {
    return
  }
  const oid = String(data.orderId || '')
  if (!oid || oid !== activeItem.value?.orderId) {
    return
  }
  void handleContractSignedFromEmbed()
}

async function handleContractSignedFromEmbed() {
  ElMessage.success('签署已成功')
  contractSignFrameVisible.value = false
  contractDialogVisible.value = false
  await loadContractFlow()
  await refreshList()
  dialogVisible.value = true
}

onMounted(() => {
  if (!import.meta.env.SSR) {
    window.addEventListener('message', onContractSignedPostMessage)
  }
})

onUnmounted(() => {
  if (!import.meta.env.SSR) {
    window.removeEventListener('message', onContractSignedPostMessage)
  }
})

watch(contractDialogVisible, (open) => {
  if (!open) {
    contractSignFrameVisible.value = false
  }
})

async function startClaim(item: MallCardPackageDTO) {
  activeItem.value = item
  contractError.value = ''
  contractRoot.value = null
  preClaimPromptVisible.value = false
  contractDialogVisible.value = false
  await loadContractFlow()
  if (contractError.value) {
    contractDialogVisible.value = true
    return
  }
  if (contractShowsSigned.value) {
    contractDialogVisible.value = true
    return
  }
  preClaimPromptVisible.value = true
}

function cancelPreClaimPrompt() {
  preClaimPromptVisible.value = false
  activeItem.value = null
}

/** 小弹窗通过右上角关闭时：若未进入签约/其它弹窗则结束本次领取 */
function onPreClaimDialogClosed() {
  if (contractSignFrameVisible.value || contractDialogVisible.value || dialogVisible.value) {
    return
  }
  activeItem.value = null
}

/** 小弹窗「去签署」：一律在本页弹层内 iframe 打开签约页 */
function onPreClaimGoSign() {
  preClaimPromptVisible.value = false
  openContractSignDialog()
}

function mallApiErrorText(e: unknown): string {
  const err = e as { data?: { msg?: string, info?: string }, message?: string, statusMessage?: string }
  return String(
    err?.data?.msg
      || err?.data?.info
      || err?.message
      || err?.statusMessage
      || '请求失败',
  ).trim() || '请求失败'
}

/** 合同下载：把服务端 Chromium/Puppeteer 原始报错换成可读说明 */
function contractDownloadErrorText(e: unknown): string {
  const raw = mallApiErrorText(e)
  if (/Failed to launch the browser|libatk|shared libraries|puppeteer|TROUBLESHOOTING:\s*https:\/\/pptr\.dev/i.test(raw)) {
    return '合同文件暂时无法生成，请稍后重试或联系客服。若多次失败，请联系运维检查服务器上的 PDF 生成环境。'
  }
  if (/ECONNRESET|ETIMEDOUT|socket hang up|aborted|ECONNABORTED|502|504|Gateway|timed out|Timeout/i.test(raw)) {
    return '合同下载超时或连接中断，请稍后重试。若多次失败，请让运维调大网关指向本服务的超时时间（如 Nginx proxy_read_timeout），首次生成 PDF 可能需一至数分钟。'
  }
  if (/Target closed|Protocol error|setAutoAttach|setDiscoverTargets|Session closed|Browser disconnected/i.test(raw)) {
    return '合同生成时浏览器进程异常，请稍后重试。若多次失败，可尝试在服务器安装系统 Chrome 并配置环境变量 PUPPETEER_EXECUTABLE_PATH。'
  }
  return raw
}

function isContractDownloadAbortError(e: unknown): boolean {
  if (!e || typeof e !== 'object') {
    return false
  }
  const o = e as { name?: string, message?: string }
  if (o.name === 'AbortError') {
    return true
  }
  const m = String(o.message || '')
  return /aborted|AbortError|signal is aborted|The user aborted/i.test(m)
}

function cancelContractDownload() {
  if (!contractDownloadBusy.value) {
    return
  }
  contractDownloadCancelledByUser.value = true
  contractDownloadAbort.value?.abort()
}

async function loadContractFlow() {
  const item = activeItem.value
  if (!item || !/^1\d{10}$/.test(account.value)) {
    return
  }
  contractLoading.value = true
  contractError.value = ''
  try {
    const flow = await fetchCardPackageContractFlow(account.value, item.orderId)
    contractRoot.value = flow.getContract && typeof flow.getContract === 'object'
      ? (flow.getContract as Record<string, unknown>)
      : null
  }
  catch (e: unknown) {
    contractError.value = mallApiErrorText(e)
    contractRoot.value = null
  }
  finally {
    contractLoading.value = false
  }
}

function openContractSignDialog() {
  if (!contractEmbedUrl.value) {
    ElMessage.warning('暂无签署链接，请稍后再试或下载合同')
    return
  }
  contractFrameMode.value = 'sign'
  contractIframeKey.value += 1
  contractSignFrameVisible.value = true
}

function openContractViewDialog() {
  if (!contractEmbedUrl.value) {
    ElMessage.warning('暂无合同链接')
    return
  }
  contractFrameMode.value = 'view'
  contractIframeKey.value += 1
  contractSignFrameVisible.value = true
}

function closeContractSignDialog() {
  contractSignFrameVisible.value = false
}

async function downloadContractFile() {
  const item = activeItem.value
  if (!item || !/^1\d{10}$/.test(account.value)) {
    return
  }
  if (contractDownloadBusy.value) {
    return
  }
  contractDownloadBusy.value = true
  contractDownloadCancelledByUser.value = false
  const ac = new AbortController()
  contractDownloadAbort.value = ac
  try {
    await nextTick()
    const { blob, fileName } = await downloadCardPackageContractBlob(account.value, item.orderId, {
      signal: ac.signal,
    })
    if (!blob || blob.size === 0) {
      ElMessage.warning('暂无可下载的文件，请稍后再试或联系客服')
      return
    }
    const href = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = href
    a.download = fileName || '合同.pdf'
    a.click()
    URL.revokeObjectURL(href)
    ElMessage.success('已下载完成')
  }
  catch (e: unknown) {
    if (contractDownloadCancelledByUser.value && isContractDownloadAbortError(e)) {
      ElMessage.info('已取消下载')
      return
    }
    ElMessage.error(contractDownloadErrorText(e))
  }
  finally {
    contractDownloadAbort.value = null
    contractDownloadCancelledByUser.value = false
    contractDownloadBusy.value = false
  }
}

function openClaimKefuFromContract() {
  contractDialogVisible.value = false
  dialogVisible.value = true
}

function onContractDialogClosed() {
  contractRoot.value = null
  contractError.value = ''
  contractSignFrameVisible.value = false
  preClaimPromptVisible.value = false
  if (!dialogVisible.value) {
    activeItem.value = null
  }
}

function closeDialog() {
  dialogVisible.value = false
  activeItem.value = null
}
</script>

<template>
  <div
    class="rounded-2xl bg-white p-4"
    :class="compact ? '' : 'md:rounded-3xl md:p-5'"
  >
    <h3
      v-if="!hideHeading"
      class="mb-3 flex items-center font-semibold text-black/85"
      :class="compact ? 'text-[1.1rem]' : 'text-xl md:text-2xl'"
    >
      <span class="mr-2 h-3 w-1 rounded bg-[#ff9ea9]" />
      卡包
    </h3>

    <div
      v-if="loading"
      class="py-6 text-center text-black/45"
      :class="compact ? 'text-sm' : 'text-base'"
    >
      加载中...
    </div>
    <div
      v-else-if="!isValidAccount"
      class="py-6 text-center text-black/45"
      :class="compact ? 'text-sm' : 'text-base'"
    >
      登录后查看卡包
    </div>
    <ul
      v-else-if="cardPackages.length === 0"
      class="py-4 text-center text-black/45"
      :class="compact ? 'text-sm' : 'text-base'"
    >
      暂无卡包
    </ul>
    <ul
      v-else
      class="space-y-3"
    >
      <li
        v-for="item in cardPackages"
        :key="item.orderId"
        class="flex items-center justify-between gap-3 rounded-xl border border-black/[0.06] bg-[#fbfcff] px-3 py-3 shadow-[0_1px_3px_rgba(15,23,42,0.04)]"
        :class="compact ? '' : 'md:px-4 md:py-3.5'"
      >
        <div class="min-w-0 flex-1 space-y-1">
          <p
            class="line-clamp-2 font-semibold leading-snug text-black/85"
            :class="compact ? 'text-[15px]' : 'text-base'"
          >
            {{ item.title }}
          </p>
          <p
            class="text-black/40"
            :class="compact ? 'text-[11px]' : 'text-xs'"
          >
            单号 {{ item.orderId }} · {{ formatTime(item.createdAt) }}
          </p>
          <p
            class="leading-snug"
            :class="[
              compact ? 'text-xs' : 'text-[13px]',
              item.cardPackageIssued ? 'font-medium text-[#0f766e]' : 'text-[#b45309]',
            ]"
          >
            {{ item.cardPackageIssued ? '平台已登记发放' : '请联系客服领取现金礼' }}
          </p>
          <p
            class="pt-0.5 font-semibold tabular-nums text-[#c0354a]"
            :class="compact ? 'text-base' : 'text-lg'"
          >
            ¥{{ formatReverseCardPackageDisplay(item) }}
            <span
              class="ml-1 text-black/35"
              :class="compact ? 'text-xs font-normal' : 'text-sm font-normal'"
            >现金礼包</span>
          </p>
        </div>
        <div class="shrink-0 self-center">
          <button
            v-if="!item.cardPackageIssued"
            type="button"
            class="rounded-xl bg-gradient-to-r from-[#0b7b6e] to-[#18a08f] px-3 py-2 font-medium text-white shadow-sm active:opacity-92"
            :class="compact ? 'text-xs px-3.5' : 'text-sm px-4 py-2.5'"
            @click="startClaim(item)"
          >
            领取
          </button>
          <span
            v-else
            class="inline-flex items-center justify-center rounded-xl border border-[#a7f3d0] bg-[#ecfdf5] font-medium text-[#0f766e]"
            :class="compact ? 'px-3 py-2 text-xs' : 'text-sm px-4 py-2.5'"
          >
            已发放
          </span>
        </div>
      </li>
    </ul>

    <!-- 领取入口：需签署时先小窗确认 -->
    <el-dialog
      v-model="preClaimPromptVisible"
      title="领取现金礼"
      :width="compact ? 'min(92vw, 320px)' : '360px'"
      align-center
      append-to-body
      :close-on-click-modal="false"
      class="card-package-pre-claim-dialog"
      @closed="onPreClaimDialogClosed"
    >
      <div
        v-if="activeItem"
        class="space-y-2 text-sm leading-relaxed text-black/80"
      >
        <p>
          领取现金礼前需先签署电子合同。
        </p>
        <p class="text-xs text-black/50">
          订单：<span class="font-medium text-black/75">{{ activeItem.title }}</span>
          （{{ activeItem.orderId }}）
        </p>
      </div>
      <template #footer>
        <div class="flex flex-wrap justify-end gap-2">
          <el-button @click="cancelPreClaimPrompt">
            取消
          </el-button>
          <el-button
            type="primary"
            class="!bg-gradient-to-r !from-[#0b7b6e] !to-[#18a08f] !border-0"
            @click="onPreClaimGoSign"
          >
            去签署
          </el-button>
        </div>
      </template>
    </el-dialog>

    <!-- 已签约：合同摘要 + 下载 / 查看 / 联系客服；异常时展示错误 -->
    <el-dialog
      v-model="contractDialogVisible"
      :title="contractShowsSigned ? '电子合同' : '合同信息'"
      :width="compact ? '94%' : '440px'"
      destroy-on-close
      align-center
      class="card-package-contract-dialog"
      :close-on-click-modal="!contractDownloadBusy"
      @closed="onContractDialogClosed"
    >
      <div
        v-if="activeItem"
        class="space-y-3 text-black/80"
      >
        <p
          v-if="contractShowsSigned && contractData && !contractLoading && !contractError"
          class="text-sm text-black/55"
        >
          订单 <span class="font-medium text-black/85">{{ activeItem.title }}</span>
          （{{ activeItem.orderId }}）电子合同已签署。可下载或查看合同；领取现金礼请联系客服。
        </p>
        <p
          v-else-if="contractError"
          class="text-sm text-black/55"
        >
          订单 <span class="font-medium text-black/85">{{ activeItem.title }}</span>
          （{{ activeItem.orderId }}）合同信息获取异常，请稍后重试或联系客服。
        </p>

        <div
          v-if="contractLoading"
          class="py-8 text-center text-sm text-black/45"
        >
          正在准备合同…
        </div>
        <div
          v-else-if="contractError"
          class="rounded-xl border border-amber-200/80 bg-amber-50 px-3 py-2.5 text-sm text-amber-900"
        >
          <p class="whitespace-pre-wrap">
            {{ contractError }}
          </p>
          <p
            v-if="showContractUpstreamHint"
            class="mt-2 border-t border-amber-200/60 pt-2 text-xs leading-relaxed text-amber-950/75"
          >
            常见处理：在签约开放平台完成「添加个人用户」(addPersonalUser)，将人脸/实名认证返回的 serialNo 通过管理端写入该用户的 signAuthSerialNo；联调可临时配置 API 环境变量 MALL_CARD_PACKAGE_SIGN_AUTH_SERIAL。
          </p>
        </div>
        <div
          v-else-if="contractData && contractShowsSigned"
          class="card-contract-card space-y-3 rounded-2xl border border-black/[0.08] bg-gradient-to-b from-white to-[#f8fafc] p-4 shadow-sm"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <p class="text-xs text-black/45">
                合同名称
              </p>
              <p class="mt-0.5 text-sm font-semibold leading-snug text-black/85">
                {{ String(contractData.contractName || contractData.contract_name || activeItem.title) }}
              </p>
            </div>
            <span class="shrink-0 rounded-full bg-[#ecfdf5] px-2.5 py-1 text-xs font-medium text-[#047857]">
              {{ contractBinaryStatusLabel }}
            </span>
          </div>
        </div>
      </div>
      <template #footer>
        <div
          v-if="contractShowsSigned && contractData && !contractLoading && !contractError"
          class="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end"
        >
          <el-button
            :disabled="contractDownloadBusy"
            @click="downloadContractFile"
          >
            下载合同
          </el-button>
          <el-button
            type="primary"
            plain
            class="!border-[#0b7b6e] !text-[#0b7b6e]"
            @click="openContractViewDialog"
          >
            查看合同
          </el-button>
          <el-button
            type="primary"
            class="!bg-gradient-to-r !from-[#0b7b6e] !to-[#18a08f] !border-0"
            @click="openClaimKefuFromContract"
          >
            联系客服领取
          </el-button>
        </div>
        <div
          v-else
          class="flex flex-wrap justify-end gap-2"
        >
          <el-button @click="contractDialogVisible = false">
            关闭
          </el-button>
        </div>
      </template>
    </el-dialog>

    <!-- 合同页：签署或仅查看（独立弹层） -->
    <el-dialog
      v-model="contractSignFrameVisible"
      :title="contractFrameMode === 'view' ? '查看合同' : '阅读并签署合同'"
      :width="compact ? '96vw' : 'min(720px, 96vw)'"
      append-to-body
      align-center
      :close-on-click-modal="false"
      class="card-package-contract-sign-frame-dialog"
    >
      <p
        v-if="activeItem"
        class="mb-2 text-xs leading-relaxed text-black/50"
      >
        <template v-if="contractFrameMode === 'view'">
          订单 {{ activeItem.orderId }} · 以下为合同原文（含签署记录）。
        </template>
        <template v-else>
          订单 {{ activeItem.orderId }} · 请在内嵌合同页阅读条款，在签名区<strong>手写签名</strong>后点击「提交签署」。若打开的是第三方签约页，请按其页面完成签署。
        </template>
      </p>
      <div
        v-if="contractEmbedUrl && activeItem"
        class="overflow-hidden rounded-lg border border-black/[0.08] bg-white"
      >
        <iframe
          :key="`${activeItem.orderId}-${contractIframeKey}`"
          title="电子合同"
          class="h-[min(72vh,560px)] w-full border-0 bg-white"
          :src="contractEmbedUrl"
        />
      </div>
      <template #footer>
        <div class="flex flex-wrap justify-end gap-2">
          <el-button
            type="primary"
            plain
            class="!border-[#0b7b6e] !text-[#0b7b6e]"
            @click="closeContractSignDialog"
          >
            返回
          </el-button>
        </div>
      </template>
    </el-dialog>

    <!-- 联系客服 -->
    <el-dialog
      v-model="dialogVisible"
      title="联系客服领取卡包"
      :width="compact ? 'min(92vw, 360px)' : '360px'"
      destroy-on-close
      align-center
      class="card-package-claim-dialog"
      @closed="closeDialog"
    >
      <div
        v-if="activeItem"
        class="space-y-3 text-black/75"
      >
        <p class="text-sm leading-relaxed">
          订单 <span class="font-medium text-black/85">{{ activeItem.title }}</span>
          （{{ activeItem.orderId }}）现金礼 ¥{{ formatReverseCardPackageDisplay(activeItem) }}，请使用微信扫描下方二维码，添加企业微信客服为您办理领取。
        </p>
        <div class="card-package-claim-qr-wrap overflow-hidden rounded-xl bg-[#0b7bff] shadow-inner ring-1 ring-black/[0.06]">
          <img
            :src="kefuQrUrl"
            alt="请使用微信扫描图中二维码，添加荷花客服企业微信，联系办理现金礼领取"
            class="card-package-claim-qr-img mx-auto block w-full max-w-[min(100%,280px)] object-contain"
            loading="lazy"
            decoding="async"
          />
        </div>
        <p class="text-center text-xs text-black/45">
          荷花客服 · 海曙文硕贸易
        </p>
      </div>
      <template #footer>
        <div class="flex flex-wrap justify-end gap-2">
          <el-button
            type="primary"
            @click="closeDialog"
          >
            我知道了
          </el-button>
        </div>
      </template>
    </el-dialog>

    <!-- 全屏下载遮罩：Teleport 到 body + 超高 z-index，保证盖过 append-to-body 的 el-dialog -->
    <Teleport to="body">
      <Transition name="contract-download-mask-fade">
        <div
          v-if="contractDownloadBusy"
          class="fixed inset-0 z-[60000] flex flex-col items-center justify-center bg-black/50 px-6"
          role="status"
          aria-live="polite"
          aria-busy="true"
          @touchmove.prevent
        >
          <div class="flex max-w-[min(100%,20rem)] flex-col items-center rounded-2xl bg-white px-8 py-7 shadow-xl">
            <span
              class="mb-4 inline-block h-11 w-11 animate-spin rounded-full border-[3px] border-[#0b7b6e] border-t-transparent"
            />
            <p class="text-center text-base font-semibold text-black/88">
              正在下载合同
            </p>
            <p class="mt-2 text-center text-xs leading-relaxed text-black/52">
              请稍候…
            </p>
            <button
              type="button"
              class="mt-5 w-full rounded-xl border border-black/[0.12] bg-white py-2.5 text-sm font-medium text-black/78 shadow-sm active:bg-black/[0.04]"
              @click="cancelContractDownload"
            >
              取消下载
            </button>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.card-package-claim-dialog:deep(.el-dialog),
.card-package-contract-dialog:deep(.el-dialog),
.card-package-contract-sign-frame-dialog:deep(.el-dialog),
.card-package-pre-claim-dialog:deep(.el-dialog) {
  border-radius: 16px;
}

.card-package-contract-sign-frame-dialog:deep(.el-dialog__body) {
  padding-top: 8px;
}

.contract-download-mask-fade-enter-active,
.contract-download-mask-fade-leave-active {
  transition: opacity 0.18s ease;
}

.contract-download-mask-fade-enter-from,
.contract-download-mask-fade-leave-to {
  opacity: 0;
}
</style>
