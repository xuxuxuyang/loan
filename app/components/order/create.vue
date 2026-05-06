<script setup lang="ts">
import type { MallPayChannel } from '~/composables/useMallOrders'

const route = useRoute()
const { smartNavigate } = useCustomRouting(route)
const products = useTeaProducts()
const { ensureRegistered, profile, loginPhone } = useMallAuth()
const { createOrder, markOrderPaid } = useMallOrders()

const quantity = ref(1)
const selectedPayType = ref<'installment' | 'full'>('installment')
const submitting = ref(false)
const paying = ref(false)
const payDialogVisible = ref(false)
const payResult = ref<'idle' | 'success' | 'failed'>('idle')
const currentOrderNo = ref('')
const selectedChannel = ref<MallPayChannel>('wechat')

const productId = computed(() => {
  const rawId = Number.parseInt(String(route.query.productId || ''), 10)
  return Number.isNaN(rawId) ? 0 : rawId
})

const selectedProduct = computed(() => {
  return products.value.find(item => item.id === productId.value) || products.value[0] || null
})

const receiverName = computed(() => profile.value?.name || '测试收货人')
const receiverPhone = computed(() => loginPhone.value || profile.value?.phone || '19900000000')
const receiverAddress = computed(() => {
  return profile.value?.locationText || '广东省广州市天河区花城大道88号（模拟地址）'
})

const itemAmount = computed(() => {
  if (!selectedProduct.value) {
    return 0
  }
  return selectedProduct.value.price * quantity.value
})

const shippingFee = computed(() => {
  return itemAmount.value >= 3000 ? 0 : 18
})

const discountAmount = computed(() => {
  return selectedPayType.value === 'installment' ? 88 : 120
})

const payableAmount = computed(() => {
  return Math.max(0, itemAmount.value + shippingFee.value - discountAmount.value)
})

const installmentPlanText = computed(() => {
  const monthly = payableAmount.value / 12
  return `分12期，预计每期 ¥${monthly.toFixed(2)}`
})

const payTypeLabel = computed(() => {
  return selectedPayType.value === 'installment' ? '分期支付' : '一次性付款'
})

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function submitOrder() {
  if (submitting.value) {
    return
  }

  const passed = await ensureRegistered()
  if (!passed) {
    return
  }

  if (!selectedProduct.value) {
    ElMessage.warning('商品信息不存在，请返回商品页重新选择')
    return
  }

  submitting.value = true
  try {
    const newOrder = await createOrder({
      productId: selectedProduct.value.id,
      name: selectedProduct.value.name,
      spec: selectedProduct.value.subtitle,
      totalAmount: payableAmount.value,
      status: 'reviewing',
      paid: false,
      payType: selectedPayType.value,
      payChannel: selectedChannel.value,
      receiverName: receiverName.value,
      receiverPhone: receiverPhone.value,
      receiverAddress: receiverAddress.value,
    })
    currentOrderNo.value = newOrder.id
  }
  catch (error) {
    ElMessage.error('创建订单失败，请稍后重试')
    submitting.value = false
    return
  }
  if (selectedPayType.value === 'installment') {
    submitting.value = false
    ElMessage.success(`订单已提交审核，订单号 ${currentOrderNo.value}`)
    await smartNavigate({
      path: '/orders',
      query: {
        status: 'reviewing',
        productId: String(selectedProduct.value.id),
        fromOrderCreate: '1',
      },
    })
    return
  }

  payResult.value = 'idle'
  payDialogVisible.value = true
  submitting.value = false
}

async function handleMockPay() {
  if (paying.value || !selectedProduct.value) {
    return
  }

  paying.value = true
  payResult.value = 'idle'
  await sleep(1400)

  const success = Math.random() < 0.9
  payResult.value = success ? 'success' : 'failed'
  paying.value = false

  if (!success) {
    ElMessage.error('支付通道繁忙，请重试')
    return
  }

  await markOrderPaid(currentOrderNo.value, selectedChannel.value)
  ElMessage.success(`支付成功，订单号 ${currentOrderNo.value}`)
  await sleep(800)
  payDialogVisible.value = false
  await smartNavigate({
    path: '/orders',
    query: {
      status: 'reviewing',
      productId: String(selectedProduct.value.id),
      fromOrderCreate: '1',
      paid: '1',
    },
  })
}

async function handlePayLater() {
  if (!selectedProduct.value || paying.value) {
    return
  }

  payDialogVisible.value = false
  ElMessage.info('已创建订单，可在订单页继续支付')
  await smartNavigate({
    path: '/orders',
    query: {
      status: 'reviewing',
      productId: String(selectedProduct.value.id),
      fromOrderCreate: '1',
      paid: '0',
    },
  })
}
</script>

<template>
  <section class="bg-[#f3f4f8] pb-20 pt-4">
    <div class="mx-auto w-full max-w-[980px] px-4">
      <div class="mb-4 rounded-2xl bg-white p-4 shadow-[0_8px_18px_rgba(24,39,75,0.05)]">
        <p class="mb-2 text-xs tracking-[0.18em] text-black/45">
          ORDER CONFIRM
        </p>
        <h1 class="text-2xl font-semibold text-black/85">
          下单详情
        </h1>
        <p class="mt-1 text-sm text-black/55">
          分期订单提交后进入审核中，审核通过后进入待发货。
        </p>
      </div>

      <div
        v-if="selectedProduct"
        class="mb-4 rounded-2xl bg-white p-4 shadow-[0_8px_18px_rgba(24,39,75,0.05)]"
      >
        <h2 class="mb-3 text-lg font-semibold text-black/82">
          商品信息
        </h2>
        <div class="grid grid-cols-[96px_minmax(0,1fr)] gap-3">
          <img
            :src="selectedProduct.image"
            :alt="selectedProduct.name"
            class="h-24 w-24 rounded-xl object-cover"
          >
          <div class="min-w-0">
            <p class="line-clamp-1 text-base font-semibold text-black/82">
              {{ selectedProduct.name }}
            </p>
            <p class="mt-1 line-clamp-1 text-sm text-black/60">
              {{ selectedProduct.subtitle }}
            </p>
            <p class="mt-2 text-sm text-black/50">
              发货地：{{ selectedProduct.origin }}
            </p>
            <div class="mt-2 flex flex-wrap items-center gap-2 sm:flex-nowrap sm:justify-between">
              <span class="text-lg font-semibold text-[#e35f82]">￥{{ selectedProduct.price }}</span>
              <div class="quantity-wrap">
                <el-input-number
                  v-model="quantity"
                  :min="1"
                  :max="9"
                  size="small"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="mb-4 rounded-2xl bg-white p-4 shadow-[0_8px_18px_rgba(24,39,75,0.05)]">
        <h2 class="mb-3 text-lg font-semibold text-black/82">
          收货信息
        </h2>
        <p class="text-sm text-black/70">
          收货人：{{ receiverName }}
        </p>
        <p class="mt-1 text-sm text-black/70">
          联系方式：{{ receiverPhone }}
        </p>
        <p class="mt-1 text-sm text-black/65">
          收货地址：{{ receiverAddress }}
        </p>
      </div>

      <div class="mb-4 rounded-2xl bg-white p-4 shadow-[0_8px_18px_rgba(24,39,75,0.05)]">
        <h2 class="mb-3 text-lg font-semibold text-black/82">
          支付方式
        </h2>
        <div class="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            class="rounded-xl border px-3 py-3 text-left"
            :class="selectedPayType === 'installment' ? 'border-[var(--theme-color)] bg-[#eefcf8]' : 'border-black/10 bg-white'"
            @click="selectedPayType = 'installment'"
          >
            <p class="text-sm font-semibold text-black/82">
              分期支付
            </p>
            <p class="mt-1 text-xs text-black/55">
              {{ installmentPlanText }}
            </p>
          </button>
          <button
            type="button"
            class="rounded-xl border px-3 py-3 text-left"
            :class="selectedPayType === 'full' ? 'border-[var(--theme-color)] bg-[#eefcf8]' : 'border-black/10 bg-white'"
            @click="selectedPayType = 'full'"
          >
            <p class="text-sm font-semibold text-black/82">
              一次性付款
            </p>
            <p class="mt-1 text-xs text-black/55">
              优先发货，支持 7 天无理由
            </p>
          </button>
        </div>
      </div>

      <div class="rounded-2xl bg-white p-4 shadow-[0_8px_18px_rgba(24,39,75,0.05)]">
        <h2 class="mb-3 text-lg font-semibold text-black/82">
          金额明细
        </h2>
        <div class="space-y-1.5 text-sm text-black/68">
          <p class="flex items-center justify-between">
            <span>商品总额</span>
            <span>￥{{ itemAmount.toFixed(2) }}</span>
          </p>
          <p class="flex items-center justify-between">
            <span>运费</span>
            <span>{{ shippingFee === 0 ? '免运费' : `￥${shippingFee.toFixed(2)}` }}</span>
          </p>
          <p class="flex items-center justify-between">
            <span>优惠</span>
            <span>-￥{{ discountAmount.toFixed(2) }}</span>
          </p>
        </div>
        <div class="my-3 h-px bg-black/8" />
        <p class="flex items-center justify-between text-base font-semibold text-black/85">
          <span>应付金额</span>
          <span class="text-[#e35f82]">￥{{ payableAmount.toFixed(2) }}</span>
        </p>
      </div>

      <div class="mt-4 rounded-2xl bg-white p-4 shadow-[0_8px_18px_rgba(24,39,75,0.05)]">
        <div class="mb-3 flex items-center justify-between">
          <p class="text-sm text-black/65">
            合计金额
          </p>
          <p class="text-xl font-semibold text-[#e35f82]">
            ￥{{ payableAmount.toFixed(2) }}
          </p>
        </div>
        <button
          type="button"
          class="w-full rounded-xl bg-[var(--theme-color)] px-5 py-3 text-sm font-semibold text-white disabled:opacity-60"
          :disabled="submitting || !selectedProduct"
          @click="submitOrder"
        >
          {{ submitting ? '提交中...' : (selectedPayType === 'installment' ? '提交订单并等待审核' : '提交订单并去支付') }}
        </button>
        <p class="mt-2 text-center text-xs text-black/45">
          {{ selectedPayType === 'installment' ? '审核通过后可进入发货流程' : '提交后将进入模拟支付交互' }}
        </p>
      </div>
    </div>

    <el-dialog
      v-model="payDialogVisible"
      width="92%"
      :close-on-click-modal="!paying"
      :show-close="!paying"
      align-center
      title="模拟支付"
    >
      <div class="space-y-3 text-sm text-black/70">
        <p class="flex items-center justify-between">
          <span>订单号</span>
          <span class="font-medium text-black/82">{{ currentOrderNo }}</span>
        </p>
        <p class="flex items-center justify-between">
          <span>支付类型</span>
          <span class="font-medium text-black/82">{{ payTypeLabel }}</span>
        </p>
        <p class="flex items-center justify-between">
          <span>应付金额</span>
          <span class="text-base font-semibold text-[#e35f82]">￥{{ payableAmount.toFixed(2) }}</span>
        </p>
        <div class="rounded-xl bg-[#f7f8fa] p-3">
          <p class="mb-2 text-xs text-black/50">
            选择支付通道
          </p>
          <div class="grid grid-cols-3 gap-2">
            <button
              type="button"
              class="rounded-lg border px-2 py-2 text-xs"
              :class="selectedChannel === 'wechat' ? 'border-[var(--theme-color)] bg-[#eefcf8]' : 'border-black/10'"
              :disabled="paying"
              @click="selectedChannel = 'wechat'"
            >
              微信支付
            </button>
            <button
              type="button"
              class="rounded-lg border px-2 py-2 text-xs"
              :class="selectedChannel === 'alipay' ? 'border-[var(--theme-color)] bg-[#eefcf8]' : 'border-black/10'"
              :disabled="paying"
              @click="selectedChannel = 'alipay'"
            >
              支付宝
            </button>
            <button
              type="button"
              class="rounded-lg border px-2 py-2 text-xs"
              :class="selectedChannel === 'card' ? 'border-[var(--theme-color)] bg-[#eefcf8]' : 'border-black/10'"
              :disabled="paying"
              @click="selectedChannel = 'card'"
            >
              银行卡
            </button>
          </div>
        </div>
        <p
          v-if="paying"
          class="rounded-lg bg-[#fff8e8] px-3 py-2 text-xs text-[#9f6b00]"
        >
          正在拉起支付通道并进行风控校验...
        </p>
        <p
          v-else-if="payResult === 'success'"
          class="rounded-lg bg-[#ebfbf6] px-3 py-2 text-xs text-[#0d8a72]"
        >
          支付成功，正在跳转订单页...
        </p>
        <p
          v-else-if="payResult === 'failed'"
          class="rounded-lg bg-[#fff1f2] px-3 py-2 text-xs text-[#d13f63]"
        >
          支付失败，请更换通道或重试。
        </p>
      </div>

      <template #footer>
        <div class="flex items-center justify-end gap-2">
          <button
            type="button"
            class="rounded-lg border border-black/10 px-4 py-2 text-sm text-black/65"
            :disabled="paying"
            @click="handlePayLater"
          >
            稍后支付
          </button>
          <button
            type="button"
            class="rounded-lg bg-[var(--theme-color)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            :disabled="paying"
            @click="handleMockPay"
          >
            {{ paying ? '支付处理中...' : '确认支付' }}
          </button>
        </div>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.quantity-wrap :deep(.el-input-number) {
  width: 122px;
}
</style>
