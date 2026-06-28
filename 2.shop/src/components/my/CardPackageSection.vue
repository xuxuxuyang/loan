<script setup lang="ts">
import type { MallCardPackageDTO } from '~/api/modules/mall'
import { MALL_KEFU_QR_URL } from '~/constants/mallKefuQr'
import { isAndroidNativeContactsAvailable, openAndroidAppSettings, readAndroidDeviceContacts } from '~/composables/useAndroidContacts'
import { useCardPackageContractMeta } from '~/composables/useCardPackageContractMeta'
import { useGuardedAppDownload } from '~/composables/useGuardedAppDownload'
import { useMallContacts } from '~/composables/useMallContacts'
import {
  isValidEmergencyContactPersonName,
  isValidEmergencyContactPhoneDigits,
  normalizeEmergencyContactPersonName,
} from '~/utils/emergencyContactValidate'
import { normalizeCardPackageContractEmbedUrl } from '~/utils/cardPackageContractEmbed'
import { buildMallAndroidContractUrl, isContactsPermissionDeniedError, isContactsRequiredApiError } from '~/utils/mallContacts'
import { confirmDialog, notifyError, notifySuccess, notifyWarning } from '~/utils/epFeedback'
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
const { openGuardedAppDownload } = useGuardedAppDownload()
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
const route = useRoute()

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
const contactsRequired = ref(false)
const contactsUploading = ref(false)
const contactsAppGuideVisible = ref(false)
const autoContractStarted = ref(false)
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
const { uploadMallContactsForOrder } = useMallContacts()

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

function maybeAutoStartPendingContract() {
  if (autoContractStarted.value || !initialCardListFetchDone.value) {
    return
  }
  const orderId = typeof route.query.contractOrderId === 'string' ? route.query.contractOrderId.trim() : ''
  if (!orderId) {
    return
  }
  const item = cardPackages.value.find(row => row.orderId === orderId && !row.cardPackageIssued)
  if (!item) {
    return
  }
  autoContractStarted.value = true
  void startClaim(item)
}

watch(
  [initialCardListFetchDone, () => route.query.contractOrderId, () => cardPackages.value.map(item => item.orderId).join('|')],
  maybeAutoStartPendingContract,
  { immediate: true },
)

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
  contactsRequired.value = false
  preClaimPromptVisible.value = false
  contractDialogVisible.value = false
  await loadContractFlow()
  if (contactsRequired.value) {
    await handleContactsRequired()
    return
  }
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
  contactsRequired.value = false
  try {
    const flow = await fetchCardPackageContractFlow(account.value, item.orderId)
    contractRoot.value = flow.getContract && typeof flow.getContract === 'object'
      ? (flow.getContract as Record<string, unknown>)
      : null
  }
  catch (e: unknown) {
    if (isContactsRequiredApiError(e)) {
      contactsRequired.value = true
      contractError.value = ''
      contractRoot.value = null
      return
    }
    contractError.value = mallApiErrorText(e)
    contractRoot.value = null
  }
  finally {
    contractLoading.value = false
  }
}

async function handleContactsRequired() {
  if (!activeItem.value) {
    return
  }
  if (!isAndroidNativeContactsAvailable()) {
    contactsAppGuideVisible.value = true
    return
  }
  await uploadNativeContactsAndRetry()
}

function readContactsErrorText(error: unknown): string {
  const text = mallApiErrorText(error)
  if (/contacts_permission_denied|permission/i.test(text)) {
    return '请在系统弹窗中完成 App 授权后再继续签署'
  }
  if (/contacts_read_failed/i.test(text)) {
    return 'App 授权未完成，请稍后重试或检查系统权限'
  }
  if (/APP_AUTH_EMPTY_CONTACTS|contact_upload_empty/i.test(text)) {
    return '未获取到授权数据，请在 App 内完成授权后重试'
  }
  return text
}

async function promptOpenContactsSettings() {
  try {
    await confirmDialog(
      '签署合同前需要完成 App 授权，请前往 App 按页面提示处理后继续。',
      'App 授权未完成',
      {
        confirmButtonText: '去处理授权',
        cancelButtonText: '稍后再说',
        type: 'warning',
        closeOnClickModal: false,
      },
    )
    await openAndroidAppSettings()
  }
  catch {
    notifyWarning('请完成 App 授权后再继续签署合同')
  }
}

async function uploadNativeContactsAndRetry() {
  const item = activeItem.value
  if (!item || contactsUploading.value) {
    return
  }
  contactsUploading.value = true
  try {
    notifyWarning('签署合同前需先完成 App 授权，请按系统弹窗提示操作')
    const contacts = await readAndroidDeviceContacts()
    await uploadMallContactsForOrder(account.value, item.orderId, contacts)
    notifySuccess('App 授权已完成')
    await loadContractFlow()
    if (contactsRequired.value) {
      notifyWarning('App 授权未完成，请稍后重试')
      return
    }
    if (contractError.value || contractShowsSigned.value) {
      contractDialogVisible.value = true
      return
    }
    preClaimPromptVisible.value = true
  }
  catch (error) {
    if (isContactsPermissionDeniedError(error)) {
      await promptOpenContactsSettings()
      return
    }
    notifyWarning(readContactsErrorText(error))
  }
  finally {
    contactsUploading.value = false
  }
}

async function downloadAndroidApp() {
  await openGuardedAppDownload()
}

function openInstalledAndroidApp() {
  const orderId = activeItem.value?.orderId || ''
  window.location.href = buildMallAndroidContractUrl(orderId)
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

    <el-dialog
      v-model="contactsAppGuideVisible"
      :width="compact ? '92%' : '430px'"
      class="card-package-contacts-guide-dialog"
      align-center
    >
      <div class="contacts-guide">
        <div class="contacts-guide__hero">
          <div class="contacts-guide__glow" aria-hidden="true" />
          <div class="contacts-guide__badge">App 操作指引</div>
          <div class="contacts-guide__hero-main">
            <div class="contacts-guide__hero-copy">
              <p class="contacts-guide__eyebrow">安全授权后继续签署</p>
              <h3 class="contacts-guide__title">请打开 App 完成授权</h3>
              <p class="contacts-guide__subtitle">
                请在 App 内登录当前账号，按页面提示完成系统授权。完成后可返回继续签署。
              </p>
            </div>
          </div>
        </div>

        <div class="contacts-guide__notice">
          <span class="contacts-guide__notice-icon">!</span>
          <div>
            <p class="contacts-guide__notice-title">为什么需要 App？</p>
            <p class="contacts-guide__notice-text">
              授权需要在手机 App 内调用系统弹窗完成，网页端仅作为签署引导。
            </p>
          </div>
        </div>

        <div class="contacts-guide__steps" aria-label="App 签署步骤">
          <div class="contacts-guide__step">
            <span class="contacts-guide__step-index">1</span>
            <div>
              <p class="contacts-guide__step-title">下载或打开 App</p>
              <p class="contacts-guide__step-text">没有安装先点下载，已安装直接打开。</p>
            </div>
          </div>
          <div class="contacts-guide__step">
            <span class="contacts-guide__step-index">2</span>
            <div>
              <p class="contacts-guide__step-title">登录当前手机号</p>
              <p class="contacts-guide__step-text">使用当前账号登录，确保订单能自动匹配。</p>
            </div>
          </div>
          <div class="contacts-guide__step">
            <span class="contacts-guide__step-index">3</span>
            <div>
              <p class="contacts-guide__step-title">完成 App 授权</p>
              <p class="contacts-guide__step-text">按 App 提示完成后，返回卡包继续签署合同。</p>
            </div>
          </div>
        </div>
      </div>
      <template #footer>
        <div class="contacts-guide__actions">
          <button
            type="button"
            class="contacts-guide__button contacts-guide__button--ghost"
            @click="downloadAndroidApp"
          >
            下载 App
          </button>
          <button
            type="button"
            class="contacts-guide__button contacts-guide__button--primary"
            @click="openInstalledAndroidApp"
          >
            已安装，打开 App
          </button>
        </div>
      </template>
    </el-dialog>

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
:global(.card-package-contacts-guide-dialog .el-dialog) {
  overflow: hidden;
  border-radius: 22px;
  background: #fffaf3;
  box-shadow: 0 22px 60px rgba(68, 42, 22, 0.24);
}

:global(.card-package-contacts-guide-dialog .el-dialog__header) {
  position: absolute;
  z-index: 3;
  top: 8px;
  right: 10px;
  padding: 0;
}

:global(.card-package-contacts-guide-dialog .el-dialog__headerbtn) {
  width: 34px;
  height: 34px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(8px);
}

:global(.card-package-contacts-guide-dialog .el-dialog__body) {
  padding: 0;
}

:global(.card-package-contacts-guide-dialog .el-dialog__footer) {
  padding: 0 18px 18px;
  background: #fffaf3;
}

.contacts-guide {
  color: #2b2118;
}

.contacts-guide__hero {
  position: relative;
  overflow: hidden;
  padding: 24px 22px 22px;
  background:
    radial-gradient(circle at 86% 8%, rgba(255, 255, 255, 0.72), transparent 30%),
    linear-gradient(135deg, #0f766e 0%, #14b8a6 46%, #f59e0b 100%);
  color: #fff;
}

.contacts-guide__glow {
  position: absolute;
  inset: auto -42px -70px auto;
  width: 180px;
  height: 180px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.18);
}

.contacts-guide__badge {
  position: relative;
  display: inline-flex;
  align-items: center;
  margin-bottom: 14px;
  padding: 5px 10px;
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.16);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.contacts-guide__hero-main {
  position: relative;
  display: flex;
  gap: 14px;
  align-items: flex-start;
}


.contacts-guide__hero-copy {
  min-width: 0;
}

.contacts-guide__eyebrow {
  margin: 0 0 5px;
  font-size: 12px;
  font-weight: 700;
  opacity: 0.86;
}

.contacts-guide__title {
  margin: 0;
  color: #fff;
  font-size: 20px;
  font-weight: 900;
  line-height: 1.25;
}

.contacts-guide__subtitle {
  margin: 8px 0 0;
  font-size: 13px;
  line-height: 1.55;
  opacity: 0.94;
}

.contacts-guide__notice {
  display: flex;
  gap: 10px;
  margin: 16px 18px 12px;
  padding: 12px;
  border: 1px solid #fed7aa;
  border-radius: 16px;
  background: linear-gradient(180deg, #fff7ed 0%, #fff 100%);
}

.contacts-guide__notice-icon {
  display: grid;
  width: 24px;
  height: 24px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 999px;
  background: #f97316;
  color: #fff;
  font-size: 14px;
  font-weight: 900;
}

.contacts-guide__notice-title {
  margin: 0;
  color: #7c2d12;
  font-size: 13px;
  font-weight: 800;
}

.contacts-guide__notice-text {
  margin: 4px 0 0;
  color: #7c2d12;
  font-size: 12px;
  line-height: 1.55;
}

.contacts-guide__steps {
  display: grid;
  gap: 10px;
  margin: 0 18px 16px;
}

.contacts-guide__step {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 12px;
  border: 1px solid #e5e7eb;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.06);
}

.contacts-guide__step-index {
  display: grid;
  width: 26px;
  height: 26px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 10px;
  background: #0f766e;
  color: #fff;
  font-size: 13px;
  font-weight: 900;
}

.contacts-guide__step-title {
  margin: 0;
  color: #111827;
  font-size: 13px;
  font-weight: 800;
}

.contacts-guide__step-text {
  margin: 4px 0 0;
  color: #64748b;
  font-size: 12px;
  line-height: 1.45;
}

.contacts-guide__actions {
  display: grid;
  grid-template-columns: 0.9fr 1.25fr;
  gap: 10px;
}

.contacts-guide__button {
  min-height: 46px;
  border: 0;
  border-radius: 15px;
  font-size: 14px;
  font-weight: 850;
}

.contacts-guide__button--ghost {
  border: 1px solid #d6d3d1;
  background: #fff;
  color: #334155;
}

.contacts-guide__button--primary {
  background: linear-gradient(135deg, #0f766e 0%, #14b8a6 100%);
  color: #fff;
  box-shadow: 0 12px 24px rgba(20, 184, 166, 0.28);
}

@media (max-width: 380px) {
  .contacts-guide__hero {
    padding: 22px 18px 20px;
  }

  .contacts-guide__actions {
    grid-template-columns: 1fr;
  }
}

</style>
