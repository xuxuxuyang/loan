<script setup lang="ts">
import QRCode from 'qrcode'
import type { LakalaPayBizType, LakalaPreorderPayload, LakalaPreorderResult } from '~/composables/useLakalaPayment'
import type { MallPayChannel } from '~/composables/useMallOrders'
import type { MallBillingRefreshPayload } from '~/composables/useMallMy'
import { notifyError, notifySuccess, notifyWarning } from '~/utils/epFeedback'

const props = defineProps<{
  modelValue: boolean
  phone: string
  amountYuan: number
  title?: string
  preorderPayload: LakalaPreorderPayload | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  success: [payload: { billing?: MallBillingRefreshPayload, bizType: LakalaPayBizType }]
  cancel: []
}>()

const { fetchPayConfig, createPreorder, pollUntilPaid, mockCompletePay, config } = useLakalaPayment()

const visible = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

/** 拉卡拉测试商户对支付宝主扫常报 BBS16064，微信主扫可正常返回收款码 */
const payChannel = ref<MallPayChannel>('wechat')
const loading = ref(false)
const paying = ref(false)
const preorder = ref<LakalaPreorderResult | null>(null)
const qrDataUrl = ref('')
const pollAbort = ref(false)

const channelOptions: Array<{ key: MallPayChannel, label: string }> = [
  { key: 'alipay', label: '支付宝' },
  { key: 'wechat', label: '微信' },
]

const displayAmount = computed(() => Number(props.amountYuan || 0).toFixed(2))

/** 模拟预下单返回的假链接，扫码会 404，不可当真实收款码 */
const isMockPayCode = computed(() => {
  const code = String(preorder.value?.payCode || '')
  return isMockPayLink(code) || Boolean(preorder.value?.mock) || Boolean(config.value?.mock)
})

const canOpenExternal = computed(() => {
  if (isMockPayCode.value) {
    return false
  }
  const code = String(preorder.value?.payCode || '')
  return code.startsWith('http://') || code.startsWith('https://')
})

function isMockPayLink(code: string) {
  return code.includes('/mock/') || code.includes('MOCK_DEMO')
}

async function renderQr(code: string) {
  qrDataUrl.value = ''
  if (!code || isMockPayLink(code)) {
    return
  }
  try {
    qrDataUrl.value = await QRCode.toDataURL(code, { width: 220, margin: 2 })
  }
  catch {
    qrDataUrl.value = ''
  }
}

function resetState() {
  preorder.value = null
  qrDataUrl.value = ''
  paying.value = false
  pollAbort.value = false
}

async function startPay() {
  if (!props.preorderPayload || !props.phone) {
    notifyWarning('支付参数不完整')
    return
  }
  loading.value = true
  resetState()
  try {
    await fetchPayConfig()
    if (config.value && !config.value.enabled) {
      notifyError('支付功能未配置，请联系管理员配置拉卡拉参数')
      return
    }
    const result = await createPreorder(props.phone, {
      ...props.preorderPayload,
      payChannel: payChannel.value,
    })
    preorder.value = result
    await renderQr(result.payCode)
    paying.value = true
    pollAbort.value = false
    /** 模拟模式：支付单在服务端，轮询无意义；请点「模拟支付成功」 */
    if (!config.value?.mock) {
      void pollPaymentLoop(result.outTradeNo)
    }
  }
  catch (e) {
    notifyError((e as Error)?.message || '发起支付失败')
  }
  finally {
    loading.value = false
  }
}

async function pollPaymentLoop(outTradeNo: string) {
  try {
    const status = await pollUntilPaid(props.phone, outTradeNo)
    if (!pollAbort.value && status.status === 'success') {
      onPaySuccess(status.billing)
    }
  }
  catch (e) {
    if (!pollAbort.value) {
      notifyWarning((e as Error)?.message || '尚未检测到支付成功，可稍后刷新页面查看')
    }
  }
}

function onPaySuccess(billing?: MallBillingRefreshPayload) {
  paying.value = false
  visible.value = false
  notifySuccess('支付成功')
  emit('success', {
    billing,
    bizType: props.preorderPayload?.bizType || 'order_full',
  })
}

async function onMockPay() {
  if (!preorder.value) {
    return
  }
  loading.value = true
  try {
    const status = await mockCompletePay(props.phone, preorder.value.outTradeNo)
    onPaySuccess(status.billing)
  }
  catch (e) {
    notifyError((e as Error)?.message || '模拟支付失败')
  }
  finally {
    loading.value = false
  }
}

function openPayLink() {
  const code = String(preorder.value?.payCode || '')
  if (canOpenExternal.value && typeof window !== 'undefined') {
    window.open(code, '_blank', 'noopener,noreferrer')
  }
}

function closeSheet() {
  pollAbort.value = true
  paying.value = false
  visible.value = false
  emit('cancel')
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      void fetchPayConfig()
      if (props.preorderPayload) {
        void startPay()
      }
    }
    else {
      resetState()
    }
  },
)

/** 仅由 modelValue 打开时发起支付，避免与 preorderPayload 重复触发两次 preorder */
</script>

<template>
  <Teleport to="body">
    <Transition name="order-address-mask">
      <div
        v-if="visible"
        class="fixed inset-0 z-[7000] flex flex-col justify-end bg-black/50 sm:items-center sm:justify-center sm:p-4"
        role="dialog"
        aria-modal="true"
        @click.self="closeSheet"
      >
        <div
          class="mx-auto w-full max-w-md overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-2xl"
          @click.stop
        >
          <div class="border-b border-black/6 px-5 py-4">
            <h3 class="text-center text-lg font-semibold text-black/88">
              {{ title || '收银台' }}
            </h3>
            <p class="mt-1 text-center text-sm text-black/55">
              请使用{{ payChannel === 'wechat' ? '微信' : '支付宝' }}扫码完成支付
            </p>
          </div>

          <div class="px-5 py-4">
            <p class="mb-3 text-center text-2xl font-semibold text-[#e35f82]">
              ￥{{ displayAmount }}
            </p>

            <div
              v-if="!preorder"
              class="mb-4 flex justify-center gap-2"
            >
              <button
                v-for="opt in channelOptions"
                :key="opt.key"
                type="button"
                class="rounded-full px-4 py-1.5 text-sm"
                :class="payChannel === opt.key ? 'bg-[var(--theme-color)] text-white' : 'bg-black/6 text-black/65'"
                :disabled="loading"
                @click="payChannel = opt.key"
              >
                {{ opt.label }}
              </button>
            </div>

            <div
              v-if="loading && !preorder"
              class="py-8 text-center text-sm text-black/50"
            >
              正在创建支付…
            </div>

            <template v-else-if="preorder">
              <div
                v-if="isMockPayCode"
                class="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm leading-relaxed text-amber-950"
              >
                当前为<strong>模拟支付</strong>，二维码不可用，请勿用支付宝扫描（会打开无效链接）。请点下方「测试环境：模拟支付成功」完成联调。
              </div>
              <div class="flex flex-col items-center">
                <img
                  v-if="qrDataUrl && !isMockPayCode"
                  :src="qrDataUrl"
                  alt="支付二维码"
                  class="h-[220px] w-[220px] rounded-lg border border-black/8"
                >
                <p
                  v-else-if="!isMockPayCode"
                  class="py-6 text-center text-sm text-black/55"
                >
                  未获取到二维码，请尝试下方按钮
                </p>
                <p
                  v-if="paying"
                  class="mt-3 text-xs text-black/45"
                >
                  支付结果确认中…
                </p>
              </div>

              <div class="mt-4 flex flex-col gap-2">
                <button
                  v-if="canOpenExternal"
                  type="button"
                  class="w-full rounded-xl bg-[var(--theme-color)] py-2.5 text-sm font-medium text-white"
                  @click="openPayLink"
                >
                  打开支付宝付款
                </button>
                <button
                  v-if="config?.mock"
                  type="button"
                  class="w-full rounded-xl border border-dashed border-amber-400 bg-amber-50 py-2.5 text-sm font-medium text-amber-900"
                  :disabled="loading"
                  @click="onMockPay"
                >
                  测试环境：模拟支付成功
                </button>
              </div>
            </template>
          </div>

          <div class="border-t border-black/6 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <button
              type="button"
              class="w-full rounded-xl border border-black/12 py-2.5 text-sm text-black/65"
              @click="closeSheet"
            >
              取消
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
