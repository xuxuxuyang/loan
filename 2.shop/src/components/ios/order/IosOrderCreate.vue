<script setup lang="ts">
import type { IosInstallmentProfileStatus } from '~/api/modules/iosMall'
import {
  runIosInstallmentRiskStep,
  createIosInstallmentOrder,
  createIosInstallmentRiskWave,
  getIosInstallmentProfile,
} from '~/api/modules/iosMall'
import { formatMallAddressLine, useMallMy } from '~/composables/useMallMy'
import type { TeaProduct } from '~/composables/useTeaProducts'
import { normalizeApiProduct } from '~/composables/useTeaProducts'
import type { LakalaPreorderPayload } from '~/composables/useLakalaPayment'
import LakalaPaySheet from '~/components/payment/LakalaPaySheet.vue'
import IosInstallmentProfileForm from './IosInstallmentProfileForm.vue'
import IosInstallmentProfileSummary from './IosInstallmentProfileSummary.vue'
import { notifyError, notifySuccess, notifyWarning } from '~/utils/epFeedback'

type Stage = 'choice' | 'loading' | 'profile' | 'summary' | 'ready'
const route = useRoute()
const { smartNavigate } = useCustomRouting(route)
const runtimeConfig = useRuntimeConfig()
const { loginPhone, profile, ensureRegistered, syncFromStorage } = useMallAuth()
const { addresses, fetchAddresses } = useMallMy()
const { createOrder, syncFromRemote } = useMallOrders()
const stage = ref<Stage>('choice')
const profileStatus = ref<IosInstallmentProfileStatus | null>(null)
const selectedProduct = ref<TeaProduct | null>(null)
const pageLoading = ref(true)
const submitting = ref(false)
const paySheetOpen = ref(false)
const payPreorderPayload = ref<LakalaPreorderPayload | null>(null)
const payAmountYuan = ref(0)

const productId = computed(() => Number.parseInt(String(route.query.productId || ''), 10) || 0)
const currentPhone = computed(() => String(loginPhone.value || profile.value?.phone || '').replace(/\D/g, ''))
const selectedAddress = computed(() => {
  const addressId = Number.parseInt(String(route.query.addressId || ''), 10)
  return addresses.value.find(item => item.id === addressId)
    || addresses.value.find(item => item.isDefault)
    || addresses.value[0]
    || null
})

function receiverPayload() {
  if (!selectedAddress.value) return null
  return {
    receiverName: selectedAddress.value.receiver,
    receiverPhone: selectedAddress.value.phone,
    receiverAddress: formatMallAddressLine(selectedAddress.value),
  }
}

async function loadPage() {
  pageLoading.value = true
  try {
    await syncFromStorage()
    if (!await ensureRegistered(route.fullPath)) return
    if (/^1\d{10}$/.test(currentPhone.value)) await fetchAddresses(currentPhone.value)
    if (productId.value) {
      const apiBase = String(runtimeConfig.public.mallApiBase || '/api').replace(/\/+$/, '')
      const response = await $fetch<{ success: boolean, data: Record<string, unknown> }>(`${apiBase}/products/${productId.value}`)
      selectedProduct.value = normalizeApiProduct(response.data as Partial<TeaProduct>)
    }
  }
  catch (error) {
    notifyError((error as Error).message || '订单信息加载失败')
  }
  finally {
    pageLoading.value = false
  }
}

onMounted(loadPage)

async function requireOrderBasics(): Promise<boolean> {
  if (!selectedProduct.value) {
    notifyWarning('商品不存在或已下架')
    return false
  }
  if (!selectedAddress.value) {
    notifyWarning('请先添加收货地址')
    await smartNavigate({ path: '/address', query: { pick: '1', return: '/order-create', productId: String(productId.value) } })
    return false
  }
  return true
}

async function chooseInstallment() {
  if (!await requireOrderBasics()) return
  stage.value = 'loading'
  try {
    profileStatus.value = await getIosInstallmentProfile(loginPhone.value)
    stage.value = profileStatus.value.canReuse ? 'summary' : 'profile'
  }
  catch (error) {
    notifyError((error as Error).message)
    stage.value = 'choice'
  }
}

function onSaved(status: IosInstallmentProfileStatus) {
  profileStatus.value = status
  stage.value = 'ready'
}

async function onFullPaymentSuccess() {
  if (/^1\d{10}$/.test(currentPhone.value)) await syncFromRemote(currentPhone.value)
  await smartNavigate({ path: '/orders', query: { status: 'shipping' } })
}

async function submitFullOrder() {
  if (!await requireOrderBasics() || !selectedProduct.value) return
  const receiver = receiverPayload()
  if (!receiver) return
  submitting.value = true
  try {
    const creationResult = await createOrder({
      productId: selectedProduct.value.id,
      name: selectedProduct.value.name,
      spec: selectedProduct.value.subtitle,
      totalAmount: selectedProduct.value.price,
      quantity: 1,
      status: 'reviewing',
      paid: false,
      payType: 'full',
      payChannel: 'alipay',
      installmentPeriods: 1,
      ...receiver,
    }, { mallLoginPhone: currentPhone.value })
    payAmountYuan.value = creationResult.order.totalAmount
    payPreorderPayload.value = {
      bizType: 'order_full',
      payChannel: 'wechat',
      orderId: creationResult.order.id,
    }
    notifySuccess('全款订单已创建，请完成支付')
    paySheetOpen.value = true
  }
  catch (error) {
    notifyError((error as Error).message || '订单创建失败')
  }
  finally {
    submitting.value = false
  }
}

async function submitInstallmentOrder() {
  if (!await requireOrderBasics() || !selectedProduct.value) return
  const receiver = receiverPayload()
  if (!receiver) return
  submitting.value = true
  try {
    const wave = await createIosInstallmentRiskWave(currentPhone.value)
    for (const stepKey of wave.stepKeys) {
      const result = await runIosInstallmentRiskStep(currentPhone.value, wave.waveId, stepKey)
      if (!result.ok) throw new Error(result.step?.error || '系统审核未通过')
    }
    await createIosInstallmentOrder(currentPhone.value, {
      productId: selectedProduct.value.id,
      name: selectedProduct.value.name,
      spec: selectedProduct.value.subtitle,
      quantity: 1,
      totalAmount: selectedProduct.value.price,
      installmentPeriods: 1,
      installmentRiskWaveId: wave.waveId,
      ...receiver,
    })
    notifySuccess('先享后付订单已提交审核')
    await smartNavigate({ path: '/orders', query: { status: 'reviewing' } })
  }
  catch (error) {
    notifyError((error as Error).message || '系统审核未通过，未创建订单')
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <section class="mx-auto max-w-lg px-4 py-6 text-[#1f2925]">
    <h1 class="text-2xl font-semibold">确认订单</h1>
    <p class="mt-2 text-sm text-[#65716b]">请选择支付方式。只有先享后付会进入实名资料和风控流程。</p>

    <p v-if="pageLoading" class="mt-8 text-center text-sm text-[#65716b]">正在加载订单信息…</p>
    <div v-else-if="selectedProduct" class="mt-5 flex gap-4 rounded-[24px] bg-white p-4 shadow-sm">
      <img :src="selectedProduct.image" :alt="selectedProduct.name" class="h-20 w-20 rounded-2xl object-cover">
      <div class="min-w-0"><p class="font-semibold">{{ selectedProduct.name }}</p><p class="mt-1 text-sm text-[#65716b]">{{ selectedProduct.subtitle }}</p><p class="mt-2 font-semibold text-[#b95f39]">¥{{ selectedProduct.price.toFixed(2) }}</p></div>
    </div>
    <button v-if="!pageLoading" type="button" class="mt-4 w-full rounded-2xl border border-[#173f35]/12 bg-white p-4 text-left text-sm" @click="smartNavigate({ path: '/address', query: { pick: '1', return: '/order-create', productId: String(productId) } })">
      <span class="block font-medium">收货地址</span>
      <span class="mt-1 block text-[#65716b]">{{ selectedAddress ? `${selectedAddress.receiver} ${selectedAddress.phone} · ${formatMallAddressLine(selectedAddress)}` : '请选择或新增收货地址' }}</span>
    </button>

    <div v-if="!pageLoading && stage === 'choice'" class="mt-6 grid gap-4">
      <button type="button" class="rounded-[24px] border border-[#173f35]/12 bg-white p-5 text-left shadow-sm disabled:opacity-55" :disabled="submitting" @click="submitFullOrder">
        <span class="block text-lg font-semibold">普通全款购买</span>
        <span class="mt-2 block text-sm leading-6 text-[#65716b]">无需身份证、紧急联系人或通讯录权限。</span>
      </button>
      <button type="button" class="rounded-[24px] bg-[#173f35] p-5 text-left text-white shadow-[0_16px_36px_rgba(23,63,53,.2)]" @click="chooseInstallment">
        <span class="block text-lg font-semibold">申请先享后付</span>
        <span class="mt-2 block text-sm leading-6 text-white/75">进入资料说明、资料填写与独立风控流程。</span>
      </button>
    </div>
    <p v-else-if="stage === 'loading'" class="mt-8 text-center text-sm text-[#65716b]">正在读取资料状态…</p>
    <IosInstallmentProfileForm v-else-if="stage === 'profile'" class="mt-6" :phone="loginPhone" @saved="onSaved" @cancel="stage = 'choice'" />
    <IosInstallmentProfileSummary v-else-if="stage === 'summary' && profileStatus" class="mt-6" :status="profileStatus" @reuse="stage = 'ready'" @rewrite="stage = 'profile'" @cancel="stage = 'choice'" />
    <div v-else-if="stage === 'ready'" class="mt-6 rounded-[24px] bg-white p-5 shadow-sm">
      <h2 class="text-lg font-semibold">资料已确认</h2>
      <p class="mt-2 text-sm leading-6 text-[#65716b]">下一步将执行 iOS 独立风控；全部步骤通过前不会创建订单。</p>
      <button type="button" class="mt-5 w-full rounded-2xl bg-[#c66c42] px-4 py-3 font-semibold text-white disabled:opacity-55" :disabled="submitting" @click="submitInstallmentOrder">{{ submitting ? '系统审核中…' : '开始审核并提交订单' }}</button>
    </div>
    <LakalaPaySheet
      v-model="paySheetOpen"
      :phone="currentPhone"
      :amount-yuan="payAmountYuan"
      title="订单支付"
      :preorder-payload="payPreorderPayload"
      @success="onFullPaymentSuccess"
    />
  </section>
</template>
