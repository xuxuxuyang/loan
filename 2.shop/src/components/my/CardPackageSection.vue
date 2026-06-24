<script setup lang="ts">
import type { MallCardPackageDTO } from '~/api/modules/mall'
import { MALL_KEFU_QR_URL } from '~/constants/mallKefuQr'
import { useCardPackageContractMeta } from '~/composables/useCardPackageContractMeta'
import {
  isValidEmergencyContactPersonName,
  isValidEmergencyContactPhoneDigits,
  normalizeEmergencyContactPersonName,
} from '~/utils/emergencyContactValidate'
import { normalizeCardPackageContractEmbedUrl } from '~/utils/cardPackageContractEmbed'
import { notifyError, notifySuccess, notifyWarning } from '~/utils/epFeedback'
const CardPackagePreClaimDialog = defineAsyncComponent(() => import('~/components/my/card-package/dialogs/CardPackagePreClaimDialog.vue'))
const CardPackageEmergencyDialog = defineAsyncComponent(() => import('~/components/my/card-package/dialogs/CardPackageEmergencyDialog.vue'))
const CardPackageClaimDialog = defineAsyncComponent(() => import('~/components/my/card-package/dialogs/CardPackageClaimDialog.vue'))
const CardPackageContractDialogs = defineAsyncComponent(() => import('~/components/my/card-package/dialogs/CardPackageContractDialogs.vue'))
let contractDialogsPrefetchPromise: Promise<unknown> | null = null

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
  fetchBillRiskUploadLink,
  saveMallEmergencyContacts,
  mergeCardPackageRowFromPayload,
} = useMallMy()

const account = computed(() => loginPhone.value || profile.value?.phone || '')
const isValidAccount = computed(() => /^1\d{10}$/.test(account.value))
const loading = ref(false)
/** 避免首屏在请求开始前短暂渲染空列表，再切到「加载中」造成高度闪动 */
const initialCardListFetchDone = ref(false)
const dialogVisible = ref(false)
const emergencyDialogVisible = ref(false)
const emergencySubmitting = ref(false)
const emergencyForm = reactive({
  c1Name: '',
  c1Phone: '',
  c2Name: '',
  c2Phone: '',
})
const activeItem = ref<MallCardPackageDTO | null>(null)

const CARD_PACKAGE_CONTRACT_SIGNED_MSG = 'mall-card-package-contract-signed'

/** 订单金额 = 卡包金额 × 135% + 50（先享后付定价）；接口未给出有效 packageAmount 时列表展示可反推，与旧版兼容 */
const CARD_PACKAGE_REVERSE_FIXED = 50
const CARD_PACKAGE_REVERSE_RATE = 1.35

function cardPackageDisplayAmount(item: MallCardPackageDTO): number {
  const pkg = Number(item.packageAmount)
  if (Number.isFinite(pkg) && pkg >= 0) {
    return pkg
  }
  const orderAmt = Number(item.totalAmount || 0)
  if (
    !Number.isFinite(orderAmt)
    || orderAmt <= CARD_PACKAGE_REVERSE_FIXED
    || !Number.isFinite(CARD_PACKAGE_REVERSE_RATE)
    || CARD_PACKAGE_REVERSE_RATE <= 0
  ) {
    return 0
  }
  return (orderAmt - CARD_PACKAGE_REVERSE_FIXED) / CARD_PACKAGE_REVERSE_RATE
}

function formatCardPackageDisplay(item: MallCardPackageDTO): string {
  const n = cardPackageDisplayAmount(item)
  return Number.isFinite(n) ? n.toFixed(2) : '0.00'
}

const contractDialogVisible = ref(false)
/** 领取入口：先问是否去签署（小弹窗） */
const preClaimPromptVisible = ref(false)
const contractLoading = ref(false)
const contractError = ref('')
const contractRoot = ref<Record<string, unknown> | null>(null)
/** 独立弹层：阅读签署 / 仅查看 */
const contractIframeKey = ref(0)
const contractSignFrameVisible = ref(false)
const contractFrameMode = ref<'sign' | 'view'>('sign')
const billRiskGuideLoading = ref(false)
const billRiskGuideDialogVisible = ref(false)
const billRiskGuideUrl = ref('')
const billRiskGuideGeneratedAt = ref('')

/** 紧急联系人已前移到注册表单填写；领取卡包时不再二次拦截旧流程。 */
const needsEmergencyBeforeKefu = computed(() => {
  return false
})

/** API 返回中含上游对接提示时，展示简要运维说明 */
const {
  contractData,
  contractShowsSigned,
  contractBinaryStatusLabel,
  contractEmbedUrl,
  showContractUpstreamHint,
} = useCardPackageContractMeta(contractRoot, contractError)

/** iframe 必须使用 VITE_MALL_API_BASE 所在源站 + tenantId；避免后端拼成前端域名 */
const runtimeCfg = useRuntimeConfig()
const contractEmbedIframeSrc = computed(() =>
  normalizeCardPackageContractEmbedUrl(contractEmbedUrl.value, String(runtimeCfg.public.mallApiBase || '/api')),
)

async function refreshList() {
  const phone = account.value
  if (!/^1\d{10}$/.test(phone)) {
    cardPackages.value = []
    initialCardListFetchDone.value = true
    return
  }
  loading.value = true
  try {
    await fetchCardPackages(phone)
  }
  finally {
    loading.value = false
    initialCardListFetchDone.value = true
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

function formatDateTime(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) {
    return iso || '-'
  }
  const y = d.getFullYear()
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  const h = `${d.getHours()}`.padStart(2, '0')
  const min = `${d.getMinutes()}`.padStart(2, '0')
  return `${y}-${m}-${day} ${h}:${min}`
}

function trustedContractPostMessageOrigin(ev: MessageEvent): boolean {
  const url = contractEmbedIframeSrc.value
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

function onContractEmbedPostMessage(ev: MessageEvent) {
  if (!trustedContractPostMessageOrigin(ev)) {
    return
  }
  const data = ev.data as {
    type?: string
    orderId?: string
    /** 服务端合同 ACK 后立即返回的卡包行，避免再去 GET /card-packages 撞到旧快照 */
    cardPackageRow?: unknown
  } | null
  if (!data || typeof data !== 'object') {
    return
  }
  const oid = String(data.orderId || '')
  if (!oid || oid !== activeItem.value?.orderId) {
    return
  }
  if (data.type === CARD_PACKAGE_CONTRACT_SIGNED_MSG) {
    void handleContractSignedFromEmbed(data.cardPackageRow)
  }
}

function prefetchContractDialogs() {
  if (!contractDialogsPrefetchPromise) {
    contractDialogsPrefetchPromise = import('~/components/my/card-package/dialogs/CardPackageContractDialogs.vue')
  }
  return contractDialogsPrefetchPromise
}

const contractMessageListening = ref(false)

function bindContractMessageListener() {
  if (import.meta.env.SSR || contractMessageListening.value) {
    return
  }
  window.addEventListener('message', onContractEmbedPostMessage)
  contractMessageListening.value = true
}

function unbindContractMessageListener() {
  if (import.meta.env.SSR || !contractMessageListening.value) {
    return
  }
  window.removeEventListener('message', onContractEmbedPostMessage)
  contractMessageListening.value = false
}

async function handleContractSignedFromEmbed(cardPackageRow?: unknown) {
  notifySuccess('签署已成功')
  contractSignFrameVisible.value = false
  contractDialogVisible.value = false
  await loadContractFlow()
  if (!mergeCardPackageRowFromPayload(cardPackageRow ?? null))
    await refreshList()
  await syncFromStorage()
  if (needsEmergencyBeforeKefu.value) {
    emergencyForm.c1Name = ''
    emergencyForm.c1Phone = ''
    emergencyForm.c2Name = ''
    emergencyForm.c2Phone = ''
    emergencyDialogVisible.value = true
  }
  else {
    dialogVisible.value = true
  }
}

watch(
  () => contractDialogVisible.value || contractSignFrameVisible.value,
  (active) => {
    if (active) {
      bindContractMessageListener()
      return
    }
    unbindContractMessageListener()
  },
  { immediate: true },
)

onUnmounted(() => {
  unbindContractMessageListener()
})

watch(contractDialogVisible, (open) => {
  if (!open) {
    contractSignFrameVisible.value = false
  }
})

async function startClaim(item: MallCardPackageDTO) {
  void prefetchContractDialogs()
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
  if (contractSignFrameVisible.value || contractDialogVisible.value || dialogVisible.value || emergencyDialogVisible.value) {
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
  if (!contractEmbedIframeSrc.value) {
    notifyWarning('暂无签署链接，请稍后再试')
    return
  }
  contractFrameMode.value = 'sign'
  contractIframeKey.value += 1
  contractSignFrameVisible.value = true
}

function openContractViewDialog() {
  if (!contractEmbedIframeSrc.value) {
    notifyWarning('暂无合同链接')
    return
  }
  contractFrameMode.value = 'view'
  contractIframeKey.value += 1
  contractSignFrameVisible.value = true
}

function closeContractSignDialog() {
  contractSignFrameVisible.value = false
}

function openClaimKefuFromContract() {
  if (needsEmergencyBeforeKefu.value) {
    notifyWarning('请先填写两位紧急联系人后再联系客服领取')
    contractDialogVisible.value = false
    emergencyForm.c1Name = ''
    emergencyForm.c1Phone = ''
    emergencyForm.c2Name = ''
    emergencyForm.c2Phone = ''
    emergencyDialogVisible.value = true
    return
  }
  contractDialogVisible.value = false
  dialogVisible.value = true
}

async function submitEmergencyContacts() {
  const phone = account.value
  if (!/^1\d{10}$/.test(phone)) {
    return
  }
  const pairs = [
    { idx: 1, nameRaw: emergencyForm.c1Name, phoneRaw: emergencyForm.c1Phone },
    { idx: 2, nameRaw: emergencyForm.c2Name, phoneRaw: emergencyForm.c2Phone },
  ] as const
  for (const { idx, nameRaw, phoneRaw } of pairs) {
    if (!String(nameRaw || '').trim()) {
      notifyWarning(`请填写第 ${idx} 位联系人的姓名`)
      return
    }
    if (!isValidEmergencyContactPersonName(nameRaw)) {
      notifyWarning(`第 ${idx} 位联系人姓名须为汉字或英文字母，不可含数字、标点及其它符号（仅允许「·」与空格）`)
      return
    }
    if (!isValidEmergencyContactPhoneDigits(phoneRaw)) {
      notifyWarning(`第 ${idx} 位联系人手机号须为以 1 开头的 11 位大陆号码`)
      return
    }
  }
  const n1 = normalizeEmergencyContactPersonName(emergencyForm.c1Name)
  const n2 = normalizeEmergencyContactPersonName(emergencyForm.c2Name)
  const p1 = emergencyForm.c1Phone.trim().replace(/\D/g, '')
  const p2 = emergencyForm.c2Phone.trim().replace(/\D/g, '')
  if (p1 === p2) {
    notifyWarning('两位联系人手机号不能相同')
    return
  }
  emergencySubmitting.value = true
  try {
    await saveMallEmergencyContacts(phone, [
      { name: n1, phone: p1 },
      { name: n2, phone: p2 },
    ])
    notifySuccess('已保存')
    emergencyDialogVisible.value = false
    await syncFromStorage()
    dialogVisible.value = true
  }
  catch (e: unknown) {
    notifyError(mallApiErrorText(e))
  }
  finally {
    emergencySubmitting.value = false
  }
}

function onContractDialogClosed() {
  contractRoot.value = null
  contractError.value = ''
  contractSignFrameVisible.value = false
  preClaimPromptVisible.value = false
  if (!dialogVisible.value && !emergencyDialogVisible.value) {
    activeItem.value = null
  }
}

function closeDialog() {
  dialogVisible.value = false
  activeItem.value = null
}

async function showBillRiskUploadLink() {
  if (!isValidAccount.value) {
    notifyWarning('请先登录后再上传流水报告')
    return
  }
  if (billRiskGuideLoading.value) {
    return
  }
  billRiskGuideLoading.value = true
  try {
    const data = await fetchBillRiskUploadLink(account.value)
    if (!data.generated || !data.guideUrl) {
      billRiskGuideUrl.value = ''
      billRiskGuideGeneratedAt.value = ''
      billRiskGuideDialogVisible.value = false
      notifyWarning('流水上传链接暂未生成，请联系客服')
      return
    }
    billRiskGuideUrl.value = data.guideUrl
    billRiskGuideGeneratedAt.value = data.lastGeneratedAt || ''
    billRiskGuideDialogVisible.value = true
  }
  catch (e: unknown) {
    notifyError(mallApiErrorText(e))
  }
  finally {
    billRiskGuideLoading.value = false
  }
}

async function copyBillRiskGuideUrl() {
  const value = billRiskGuideUrl.value.trim()
  if (!value) {
    return
  }
  try {
    await navigator.clipboard.writeText(value)
    notifySuccess('已复制流水上传链接')
  }
  catch {
    notifyWarning('复制失败，请长按链接手动复制')
  }
}

function openBillRiskGuideUrl() {
  const value = billRiskGuideUrl.value.trim()
  if (!value || import.meta.env.SSR) {
    return
  }
  window.open(value, '_blank', 'noopener,noreferrer')
}

const claimDialogAmountText = computed(() => {
  return activeItem.value ? formatCardPackageDisplay(activeItem.value) : '0.00'
})
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
      v-if="loading || (isValidAccount && !initialCardListFetchDone)"
      class="flex min-h-[5.5rem] items-center justify-center py-6 text-center text-black/45"
      :class="compact ? 'text-sm' : 'text-base'"
    >
      加载中...
    </div>
    <div
      v-else-if="!isValidAccount"
      class="flex min-h-[5.5rem] items-center justify-center py-6 text-center text-black/45"
      :class="compact ? 'text-sm' : 'text-base'"
    >
      登录后查看卡包
    </div>
    <ul
      v-else-if="cardPackages.length === 0"
      class="flex min-h-[5.5rem] list-none flex-col items-center justify-center py-6 text-center text-black/45"
      :class="compact ? 'text-sm' : 'text-base'"
    >
      <li>暂无卡包</li>
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
            class="pt-0.5 font-semibold tabular-nums text-[#c0354a]"
            :class="compact ? 'text-base' : 'text-lg'"
          >
            ¥{{ formatCardPackageDisplay(item) }}
            <span
              class="ml-1 text-black/35"
              :class="compact ? 'text-xs font-normal' : 'text-sm font-normal'"
            >现金卡包</span>
          </p>
        </div>
        <div class="shrink-0 self-center">
          <button
            v-if="!item.cardPackageIssued"
            type="button"
            class="wv-gradient-teal rounded-xl px-3 py-2 font-medium shadow-sm active:opacity-92"
            :class="compact ? 'text-xs px-3.5' : 'text-sm px-4 py-2.5'"
            @pointerenter="prefetchContractDialogs"
            @touchstart.passive="prefetchContractDialogs"
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

    <div class="mt-4 rounded-2xl border border-[#ffd6df] bg-gradient-to-br from-[#fff7f8] to-white p-3">
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0">
          <p class="text-sm font-semibold text-black/80">
            上传流水报告
          </p>
          
        </div>
        <button
          type="button"
          class="shrink-0 rounded-xl bg-[#ff6f91] px-3.5 py-2 text-xs font-semibold text-white shadow-sm active:opacity-90 disabled:opacity-60"
          :disabled="billRiskGuideLoading"
          @click="showBillRiskUploadLink"
        >
          {{ billRiskGuideLoading ? '加载中…' : '上传流水报告' }}
        </button>
      </div>
    </div>

    <CardPackagePreClaimDialog
      v-if="preClaimPromptVisible"
      :visible="preClaimPromptVisible"
      :compact="compact"
      :active-item="activeItem"
      @update:visible="preClaimPromptVisible = $event"
      @cancel="cancelPreClaimPrompt"
      @go-sign="onPreClaimGoSign"
      @closed="onPreClaimDialogClosed"
    />

    <CardPackageContractDialogs
      v-if="contractDialogVisible || contractSignFrameVisible"
      :compact="compact"
      :active-item="activeItem"
      :contract-dialog-visible="contractDialogVisible"
      :contract-sign-frame-visible="contractSignFrameVisible"
      :contract-shows-signed="contractShowsSigned"
      :contract-data="contractData as Record<string, unknown> | null"
      :contract-loading="contractLoading"
      :contract-error="contractError"
      :show-contract-upstream-hint="showContractUpstreamHint"
      :contract-binary-status-label="contractBinaryStatusLabel"
      :contract-frame-mode="contractFrameMode"
      :contract-embed-url="contractEmbedIframeSrc"
      :contract-iframe-key="contractIframeKey"
      @update:contract-dialog-visible="contractDialogVisible = $event"
      @update:contract-sign-frame-visible="contractSignFrameVisible = $event"
      @contract-dialog-closed="onContractDialogClosed"
      @open-contract-view-dialog="openContractViewDialog"
      @open-claim-kefu-from-contract="openClaimKefuFromContract"
      @close-contract-sign-dialog="closeContractSignDialog"
    />

    <CardPackageEmergencyDialog
      v-if="emergencyDialogVisible"
      :visible="emergencyDialogVisible"
      :compact="compact"
      :submitting="emergencySubmitting"
      :c1-name="emergencyForm.c1Name"
      :c1-phone="emergencyForm.c1Phone"
      :c2-name="emergencyForm.c2Name"
      :c2-phone="emergencyForm.c2Phone"
      @update:visible="emergencyDialogVisible = $event"
      @update:c1-name="emergencyForm.c1Name = $event"
      @update:c1-phone="emergencyForm.c1Phone = $event"
      @update:c2-name="emergencyForm.c2Name = $event"
      @update:c2-phone="emergencyForm.c2Phone = $event"
      @submit="submitEmergencyContacts"
    />

    <CardPackageClaimDialog
      v-if="dialogVisible"
      :visible="dialogVisible"
      :compact="compact"
      :active-item="activeItem"
      :kefu-qr-url="MALL_KEFU_QR_URL"
      :amount-text="claimDialogAmountText"
      @update:visible="dialogVisible = $event"
      @close="closeDialog"
    />

    <el-dialog
      v-model="billRiskGuideDialogVisible"
      title="上传流水报告"
      width="92%"
      class="card-package-bill-risk-dialog"
      append-to-body
    >
      <div class="space-y-3 text-sm">
        <p class="leading-relaxed text-black/60">
          请点击下方按钮打开流水上传页面，并按页面提示完成账单投递。完成后报告会自动同步给平台审核。
        </p>
        <div class="rounded-xl border border-black/8 bg-[#f8fafc] p-3">
          <p class="mb-1 text-xs text-black/45">
            专属上传链接
          </p>
          <a
            class="break-all text-sm font-medium text-[#2563eb]"
            :href="billRiskGuideUrl"
            target="_blank"
            rel="noopener noreferrer"
          >
            {{ billRiskGuideUrl }}
          </a>
        </div>
        <p
          v-if="billRiskGuideGeneratedAt"
          class="text-xs text-black/40"
        >
          链接生成时间：{{ formatDateTime(billRiskGuideGeneratedAt) }}
        </p>
      </div>
      <template #footer>
        <div class="flex justify-end gap-2">
          <el-button @click="copyBillRiskGuideUrl">
            复制链接
          </el-button>
          <el-button
            type="primary"
            @click="openBillRiskGuideUrl"
          >
            打开上传页
          </el-button>
        </div>
      </template>
    </el-dialog>

  </div>
</template>

<style scoped>
.card-package-claim-dialog:deep(.el-dialog),
.card-package-pre-claim-dialog:deep(.el-dialog),
.card-package-emergency-dialog:deep(.el-dialog),
.card-package-bill-risk-dialog:deep(.el-dialog) {
  border-radius: 16px;
}
</style>
