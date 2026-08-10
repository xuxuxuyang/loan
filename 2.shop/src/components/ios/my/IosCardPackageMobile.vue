<script setup lang="ts">
import { uploadIosAuthorizedContacts } from '~/api/modules/iosMall'
import IosContactsConsent from './IosContactsConsent.vue'
import { readNativeDeviceContacts } from '~/composables/useAndroidContacts'
import { useCardPackageContractMeta } from '~/composables/useCardPackageContractMeta'
import { normalizeCardPackageContractEmbedUrl } from '~/utils/cardPackageContractEmbed'
import { notifyError, notifySuccess, notifyWarning } from '~/utils/epFeedback'
import { isContactsRequiredApiError } from '~/utils/mallContacts'

const route = useRoute()
const runtimeConfig = useRuntimeConfig()
const { loginPhone, profile, syncFromStorage } = useMallAuth()
const {
  cardPackages,
  fetchCardPackages,
  fetchCardPackageContractFlow,
  ackCardPackageContract,
} = useMallMy()

const loading = ref(true)
const contactsUploading = ref(false)
const consentVisible = ref(false)
const activeOrderId = ref('')
const contractRoot = ref<Record<string, unknown> | null>(null)
const contractError = ref('')
const { contractEmbedUrl, contractShowsSigned } = useCardPackageContractMeta(contractRoot, contractError)
const contractFrameUrl = computed(() => normalizeCardPackageContractEmbedUrl(contractEmbedUrl.value, String(runtimeConfig.public.mallApiBase || '/api')))
const account = computed(() => String(loginPhone.value || profile.value?.phone || '').replace(/\D/g, ''))

const approvedPackages = computed(() => cardPackages.value.filter(item =>
  item.orderStatus === 'shipping' || item.orderStatus === 'receiving' || item.orderStatus === 'enjoying',
))

async function load() {
  loading.value = true
  try {
    await syncFromStorage()
    if (/^1\d{10}$/.test(account.value)) await fetchCardPackages(account.value)
    const requested = typeof route.query.contractOrderId === 'string' ? route.query.contractOrderId.trim() : ''
    if (requested && approvedPackages.value.some(item => item.orderId === requested)) activeOrderId.value = requested
  }
  finally {
    loading.value = false
  }
}

onMounted(load)

async function beginContract(orderId: string) {
  activeOrderId.value = orderId
  contractRoot.value = null
  contractError.value = ''
  consentVisible.value = false
  try {
    const flow = await fetchCardPackageContractFlow(account.value, orderId)
    contractRoot.value = flow.getContract
  }
  catch (error) {
    if (isContactsRequiredApiError(error)) {
      consentVisible.value = true
      return
    }
    const message = String((error as Error).message || '合同加载失败，请稍后重试')
    contractError.value = message
    notifyError(message)
  }
}

async function continueContactsAuthorization() {
  consentVisible.value = false
  if (!activeOrderId.value || contactsUploading.value) return
  contactsUploading.value = true
  try {
    const contacts = await readNativeDeviceContacts()
    if (!contacts.length) {
      notifyWarning('未选择联系人，未上传任何数据')
      return
    }
    await uploadIosAuthorizedContacts(account.value, activeOrderId.value, contacts)
    notifySuccess('已上传系统授权返回的联系人')
    const flow = await fetchCardPackageContractFlow(account.value, activeOrderId.value)
    contractRoot.value = flow.getContract
  }
  catch (error) {
    const message = String((error as Error).message || '')
    if (/permission|denied|cancel|contacts_permission/i.test(message)) notifyWarning('已取消或拒绝授权，未上传任何联系人')
    else notifyError(message || '联系人授权失败，请稍后重试')
  }
  finally {
    contactsUploading.value = false
  }
}

async function confirmSigned() {
  if (!activeOrderId.value) return
  try {
    await ackCardPackageContract(account.value, activeOrderId.value)
    const flow = await fetchCardPackageContractFlow(account.value, activeOrderId.value)
    contractRoot.value = flow.getContract
    notifySuccess(contractShowsSigned.value ? '合同签署已确认' : '合同状态已刷新')
  }
  catch (error) {
    notifyError((error as Error).message || '合同状态确认失败')
  }
}
</script>

<template>
  <section class="mx-auto min-h-screen max-w-lg bg-[#f5f3ed] px-4 py-6 text-[#1f2925]">
    <p class="text-xs font-semibold tracking-[.16em] text-[#9a5b39] uppercase">iOS Card Wallet</p>
    <h1 class="mt-2 text-3xl font-semibold">卡包与合同</h1>
    <p class="mt-2 text-sm leading-6 text-[#65716b]">通讯录权限只会在先享后付订单审核通过、您主动进入合同签署时请求。</p>

    <p v-if="loading" class="mt-8 text-center text-sm text-[#65716b]">加载中…</p>
    <div v-else-if="approvedPackages.length" class="mt-6 grid gap-4">
      <article v-for="item in approvedPackages" :key="item.orderId" class="rounded-[24px] bg-white p-5 shadow-sm">
        <div class="flex items-start justify-between gap-3"><div><p class="font-semibold">{{ item.title }}</p><p class="mt-1 text-sm text-[#65716b]">订单 {{ item.orderId }}</p></div><span class="rounded-full bg-[#e3efe8] px-3 py-1 text-xs text-[#295d49]">已审核</span></div>
        <button type="button" class="mt-5 w-full rounded-2xl bg-[#173f35] px-4 py-3 font-semibold text-white disabled:opacity-55" :disabled="contactsUploading" @click="beginContract(item.orderId)">{{ contactsUploading && activeOrderId === item.orderId ? '处理中…' : '进入合同签署' }}</button>
      </article>
    </div>
    <p v-else class="mt-8 rounded-[24px] bg-white p-5 text-sm leading-6 text-[#65716b]">暂无已审核通过、可进入合同流程的先享后付订单。</p>

    <div v-if="contractFrameUrl" class="mt-6 overflow-hidden rounded-[24px] bg-white p-3 shadow-sm">
      <iframe :src="contractFrameUrl" title="先享后付合同" class="h-[65vh] w-full rounded-2xl border-0" />
      <button type="button" class="mt-3 w-full rounded-2xl bg-[#c66c42] px-4 py-3 font-semibold text-white" @click="confirmSigned">我已完成签署，刷新状态</button>
    </div>

    <IosContactsConsent v-if="consentVisible" @continue="continueContactsAuthorization" @cancel="consentVisible = false" />
  </section>
</template>
