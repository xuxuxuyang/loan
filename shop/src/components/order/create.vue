<script setup lang="ts">
const route = useRoute()
const { smartNavigate } = useCustomRouting(route)
const products = useTeaProducts()
const { ensureRegistered, profile, loginPhone } = useMallAuth()
const { createOrder } = useMallOrders()

const quantity = ref(1)
const selectedInstallmentPeriods = ref<3 | 6 | 12>(12)
const submitting = ref(false)
const currentOrderNo = ref('')

const productId = computed(() => {
  const rawId = Number.parseInt(String(route.query.productId || ''), 10)
  return Number.isNaN(rawId) ? 0 : rawId
})

const selectedProduct = computed(() => {
  return products.value.find(item => item.id === productId.value) || products.value[0] || null
})

const receiverName = computed(() => profile.value?.name || '测试收货人')
const receiverPhone = computed(() => loginPhone.value || profile.value?.phone || '15180545617')
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
  return 88
})

const payableAmount = computed(() => {
  return Math.max(0, itemAmount.value + shippingFee.value - discountAmount.value)
})

const installmentPlanText = computed(() => {
  const monthly = payableAmount.value / selectedInstallmentPeriods.value
  return `分${selectedInstallmentPeriods.value}期，预计每期 ¥${monthly.toFixed(2)}`
})

function selectInstallmentPeriods(period: number) {
  if (period === 3 || period === 6 || period === 12) {
    selectedInstallmentPeriods.value = period
  }
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
      payType: 'installment',
      payChannel: 'wechat',
      installmentPeriods: selectedInstallmentPeriods.value,
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
}
</script>

<template>
  <section class="bg-[#f3f4f8] pb-20 pt-4">
    <div class="mx-auto w-full max-w-[980px] px-4">
      

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
        <div class="rounded-xl border border-[var(--theme-color)] bg-[#eefcf8] px-3 py-3">
          <p class="text-sm font-semibold text-black/82">
            分期支付
          </p>
          <p class="mt-1 text-xs text-black/55">
            {{ installmentPlanText }}
          </p>
          <div class="mt-3 grid grid-cols-3 gap-2">
            <button
              v-for="period in [3, 6, 12]"
              :key="period"
              type="button"
              class="rounded-lg border px-2 py-2 text-sm"
              :class="selectedInstallmentPeriods === period ? 'border-[var(--theme-color)] bg-white text-[var(--theme-color)]' : 'border-black/10 bg-white text-black/72'"
              @click="selectInstallmentPeriods(period)"
            >
              {{ period }} 期
            </button>
          </div>
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
          {{ submitting ? '提交中...' : '提交订单并等待审核' }}
        </button>
        <p class="mt-2 text-center text-xs text-black/45">
          审核通过后可进入发货流程
        </p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.quantity-wrap :deep(.el-input-number) {
  width: 122px;
}
</style>
