<script setup lang="ts">
import {
  LAKALA_PENDING_PAY_KEY,
  type LakalaPayBizType,
  type LakalaPreorderPayload,
  type LakalaPreorderResult,
} from '~/composables/useLakalaPayment'
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

const loading = ref(false)
const redirecting = ref(false)
const paying = ref(false)
const preorder = ref<LakalaPreorderResult | null>(null)
const pollAbort = ref(false)
/** 自动跳转被拦截时展示手动入口 */
const redirectBlocked = ref(false)

const displayAmount = computed(() => Number(props.amountYuan || 0).toFixed(2))

const counterUrl = computed(() => {
  return String(preorder.value?.counterUrl || preorder.value?.payCode || '').trim()
})

const isMockPay = computed(() => {
  const code = counterUrl.value
  return isMockPayLink(code) || Boolean(preorder.value?.mock) || Boolean(config.value?.mock)
})

const canOpenCounter = computed(() => {
  return Boolean(counterUrl.value) && !isMockPay.value
})

function isMockPayLink(code: string) {
  return code.includes('/mock-counter/') || code.includes('/mock/') || code.includes('MOCK_DEMO')
}

function rememberPendingPay(outTradeNo: string) {
  if (typeof sessionStorage === 'undefined') {
    return
  }
  try {
    sessionStorage.setItem(LAKALA_PENDING_PAY_KEY, JSON.stringify({
      outTradeNo,
      phone: props.phone,
      at: Date.now(),
    }))
  }
  catch {
    /* ignore */
  }
}

function normalizeCounterUrl(url: string) {
  const raw = String(url || '').trim()
  if (!raw) {
    return raw
  }
  try {
    const u = new URL(raw)
    const host = u.hostname.toLowerCase()
    if (!host.includes('pay.wsmsd.cn') && !host.includes('pay.lakala.com')) {
      return raw
    }
    const q = u.search.startsWith('?') ? u.search.slice(1) : ''
    if (q.includes('%3D') || q.includes('%26')) {
      return `${u.origin}${u.pathname}?${decodeURIComponent(q)}`
    }
  }
  catch {
    /* ignore */
  }
  return raw
}

function isLikelyDesktopBrowser() {
  if (typeof navigator === 'undefined') {
    return false
  }
  const ua = navigator.userAgent || ''
  return !/MicroMessenger/i.test(ua) && !/iPhone|iPad|iPod|Android/i.test(ua)
}

function goToCounter(url: string) {
  if (typeof window === 'undefined' || !url) {
    return false
  }
  const target = normalizeCounterUrl(url)
  redirecting.value = true
  redirectBlocked.value = false
  if (preorder.value?.outTradeNo) {
    rememberPendingPay(preorder.value.outTradeNo)
  }
  if (isLikelyDesktopBrowser()) {
    notifyWarning('电脑浏览器里微信支付常会失败（拉卡拉会跳转微信小程序）。请用手机 Safari/微信打开商城，或在收银台改选支付宝。')
  }
  /** replace 避免返回商城后再进收银台时命中历史错误 hash */
  window.location.replace(target)
  return true
}

function resetState() {
  preorder.value = null
  paying.value = false
  redirecting.value = false
  redirectBlocked.value = false
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
    const result = await createPreorder(props.phone, props.preorderPayload)
    preorder.value = result
    const url = String(result.counterUrl || result.payCode || '').trim()

    if (canOpenCounter.value && url) {
      goToCounter(url)
      /** 若数秒内仍在页内，说明跳转失败，展示手动按钮 */
      window.setTimeout(() => {
        if (visible.value && redirecting.value) {
          redirecting.value = false
          redirectBlocked.value = true
        }
      }, 2500)
      return
    }

    paying.value = true
    pollAbort.value = false
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
  try {
    sessionStorage.removeItem(LAKALA_PENDING_PAY_KEY)
  }
  catch {
    /* ignore */
  }
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

function openCounter() {
  goToCounter(counterUrl.value)
}

function closeSheet() {
  pollAbort.value = true
  paying.value = false
  redirecting.value = false
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
</script>

<template>
  <Teleport to="body">
    <Transition name="order-address-mask">
      <div
        v-if="visible"
        class="fixed inset-0 z-[7000] flex flex-col justify-end bg-black/50"
        role="dialog"
        aria-modal="true"
        @click.self="closeSheet"
      >
        <div
          class="mx-auto w-full max-w-md overflow-hidden rounded-t-2xl bg-white shadow-xl"
          @click.stop
        >
          <div class="border-b border-black/6 px-5 py-4">
            <h3 class="text-center text-lg font-semibold text-black/88">
              {{ title || '支付订单' }}
            </h3>
            <p
              v-if="redirecting"
              class="mt-1 text-center text-sm text-black/55"
            >
              正在打开拉卡拉收银台…
            </p>
            <p
              v-else-if="isMockPay"
              class="mt-1 text-center text-sm text-black/55"
            >
              测试环境：请使用下方模拟支付
            </p>
          </div>

          <div class="px-5 py-4">
            <p class="mb-3 text-center text-2xl font-semibold text-[#e35f82]">
              ￥{{ displayAmount }}
            </p>

            <div
              v-if="loading || redirecting"
              class="py-8 text-center text-sm text-black/50"
            >
              {{ redirecting ? '正在跳转收银台，请稍候…' : '正在创建支付…' }}
            </div>

            <template v-else-if="preorder && isMockPay">
              <div class="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm leading-relaxed text-amber-950">
                当前为<strong>模拟支付</strong>，请点下方「模拟支付成功」完成联调。
              </div>
              <button
                v-if="config?.mock"
                type="button"
                class="w-full rounded-xl border border-dashed border-amber-400 bg-amber-50 py-2.5 text-sm font-medium text-amber-900"
                :disabled="loading"
                @click="onMockPay"
              >
                测试环境：模拟支付成功
              </button>
            </template>

            <template v-else-if="preorder && redirectBlocked">
              <p class="mb-3 text-center text-sm leading-relaxed text-black/55">
                未能自动打开收银台，请手动点击下方按钮。若收银台提示「token解析异常」，请重新下单，勿刷新收银台页；在微信里支付失败时，请改用 Safari 打开商城或选支付宝。
              </p>
              <button
                type="button"
                class="w-full rounded-xl bg-[var(--theme-color)] py-2.5 text-sm font-medium text-white"
                @click="openCounter"
              >
                前往拉卡拉收银台支付
              </button>
            </template>
          </div>

          <div
            v-if="!redirecting"
            class="border-t border-black/6 px-5 py-3 pb-[max(0.75rem,var(--app-safe-area-bottom))]"
          >
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
