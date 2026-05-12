<script setup lang="ts">
import { normalizeMallAccount } from '~/composables/useMallAuth'
import { resolveMallCreditQuota } from '~/composables/mallCreditQuota'
import { formatMallAddressLine, useMallMy } from '~/composables/useMallMy'
import type { TeaProduct } from '~/composables/useTeaProducts'
import {
  ensureMallProductsLoaded,
  ensureMallShowcaseProductsLoaded,
  normalizeApiProduct,
  useMallShowcaseProducts,
  useTeaProducts,
} from '~/composables/useTeaProducts'

const route = useRoute()
const router = useRouter()
const { smartNavigate } = useCustomRouting(route)
const installmentProducts = useTeaProducts()
const mallShowcaseProducts = useMallShowcaseProducts()
const { ensureRegistered, profile, loginPhone, syncFromStorage } = useMallAuth()
const { addresses, fetchAddresses } = useMallMy()
const { orders, createOrder, syncFromRemote } = useMallOrders()
const runtimeConfig = useRuntimeConfig()

/** 本页仅支持单件下单 */
const ORDER_QUANTITY = 1

const submitting = ref(false)
const currentOrderNo = ref('')
const addressesLoaded = ref(false)
const addressSectionRef = ref<HTMLElement | null>(null)
const addressHighlight = ref(false)
/** 下单系统审核：Teleport 全屏提示（不依赖 Element Plus Loading 的 CSS，避免 H5 上不可见） */
const orderSubmitLoadingVisible = ref(false)
/** 自定义底部弹层：替代 ElMessageBox，避免 H5 上样式错乱、与固定底栏重叠 */
const addressPromptOpen = ref(false)
const addressPromptKind = ref<'add' | 'pick'>('add')
/** 用户在本页选中的收货地址 id；与「我的 — 收货地址」列表一致，可切换非默认地址 */
const selectedAddressId = ref<number | undefined>(undefined)

const productId = computed(() => {
  const rawId = Number.parseInt(String(route.query.productId || ''), 10)
  return Number.isNaN(rawId) ? 0 : rawId
})

/** 列表未命中时（深链、缓存未就绪）按 id 拉取单条 */
const fetchedProductById = ref<TeaProduct | null>(null)

const selectedProduct = computed(() => {
  const id = productId.value
  if (!id) {
    return null
  }
  const fromMall = mallShowcaseProducts.value.find(item => item.id === id)
  if (fromMall) {
    return fromMall
  }
  const fromInstallment = installmentProducts.value.find(item => item.id === id)
  if (fromInstallment) {
    return fromInstallment
  }
  return fetchedProductById.value
})

function parseAddressIdFromRoute(): number | undefined {
  const raw = route.query.addressId
  if (typeof raw !== 'string' || !/^\d+$/.test(raw.trim())) {
    return undefined
  }
  return Number(raw.trim())
}

function syncSelectedAddressAfterFetch() {
  const list = addresses.value
  if (!list.length) {
    selectedAddressId.value = undefined
    return
  }
  const fromRoute = parseAddressIdFromRoute()
  if (fromRoute !== undefined && list.some(a => Number(a.id) === fromRoute)) {
    selectedAddressId.value = fromRoute
    return
  }
  const cur = selectedAddressId.value
  if (cur !== undefined && list.some(a => Number(a.id) === Number(cur))) {
    return
  }
  const def = list.find(a => a.isDefault)
  selectedAddressId.value = def ? Number(def.id) : Number(list[0].id)
}

/** 当前选中的收货地址（由用户在列表中点选，不再固定为默认） */
const shippingAddress = computed(() => {
  const id = selectedAddressId.value
  if (id === undefined) {
    return null
  }
  return addresses.value.find(a => Number(a.id) === Number(id)) || null
})

const receiverName = computed(() => shippingAddress.value?.receiver?.trim() || '')
const receiverPhone = computed(() => {
  if (shippingAddress.value) {
    return (shippingAddress.value.phone || '').trim()
  }
  return (loginPhone.value || profile.value?.phone || '').trim()
})
const receiverAddressLine = computed(() =>
  shippingAddress.value ? formatMallAddressLine(shippingAddress.value) : '',
)

/** 与「我的 — 订单」一致：按收货手机号归属当前账号的商城订单 */
const currentUserPhone = computed(() =>
  normalizeMallAccount(loginPhone.value || profile.value?.phone || ''),
)

const myMallOrders = computed(() => {
  const phone = currentUserPhone.value
  if (!/^1\d{10}$/.test(phone)) {
    return []
  }
  return orders.value.filter(o => o.receiverPhone === phone)
})

/** 存在任一未「已完成」(enjoying) 的订单时，不允许再下单 */
const hasBlockingMallOrder = computed(() =>
  myMallOrders.value.some(o => o.status !== 'enjoying'),
)

const creditQuota = computed(() => resolveMallCreditQuota(profile.value))

const orderBlacklisted = computed(() => Boolean(profile.value?.orderBlacklisted))

async function loadShippingAddresses() {
  const account = normalizeMallAccount(loginPhone.value || profile.value?.phone || '')
  if (!/^1\d{10}$/.test(account)) {
    selectedAddressId.value = undefined
    addressesLoaded.value = true
    return
  }
  try {
    await fetchAddresses(account)
    syncSelectedAddressAfterFetch()
  }
  finally {
    addressesLoaded.value = true
  }
}

async function openAddressPicker() {
  await smartNavigate({
    path: '/address',
    query: {
      pick: '1',
      return: '/order-create',
      ...(productId.value ? { productId: String(productId.value) } : {}),
    },
  })
}

function scrollToAddressSection() {
  void nextTick(() => {
    addressSectionRef.value?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  })
}

function pulseAddressSection() {
  addressHighlight.value = true
  window.setTimeout(() => {
    addressHighlight.value = false
  }, 2200)
}

const addressPromptTitle = computed(() =>
  addressPromptKind.value === 'add' ? '请先添加收货地址' : '请选择收货地址',
)
const addressPromptBody = computed(() =>
  addressPromptKind.value === 'add'
    ? '下单前需要填写收货地址。前往地址页添加并保存后，将自动返回本页继续提交。'
    : '您已保存过收货地址，但本页尚未选中。前往地址列表选中一条并保存后即可返回提交。',
)
const addressPromptPrimaryLabel = computed(() =>
  addressPromptKind.value === 'add' ? '去添加地址' : '去选择地址',
)

function dismissAddressPrompt() {
  addressPromptOpen.value = false
}

async function onAddressPromptPrimary() {
  dismissAddressPrompt()
  await openAddressPicker()
}

/** 未选地址时也允许点击提交，由 submitOrder 内打开本页弹层引导（避免 Element 弹窗在移动端错位） */
function promptAddressBeforeSubmit() {
  scrollToAddressSection()
  pulseAddressSection()
  addressPromptKind.value = addresses.value.length ? 'pick' : 'add'
  addressPromptOpen.value = true
}

const itemAmount = computed(() => {
  if (!selectedProduct.value) {
    return 0
  }
  return selectedProduct.value.price * ORDER_QUANTITY
})

/** 先享后付应还总额：与订单商品小计、后端入账 `totalAmount` 一致（不再乘以系数） */
const installmentRepayTotal = computed(() => Number(itemAmount.value.toFixed(2)))

/** 授信口径：商品金额（单件）与授信额度比较 */
const exceedsCreditLimit = computed(() => itemAmount.value > creditQuota.value)

const canSubmitOrder = computed(() =>
  Boolean(
    selectedProduct.value
    && addressesLoaded.value
    && !hasBlockingMallOrder.value
    && !exceedsCreditLimit.value
    && !orderBlacklisted.value,
  ),
)

/** 按规则首期还款为下单后第 14 天；未下单前展示为自今日起第 14 天（预计） */
const estimatedRepayDateYmd = computed(() => {
  const d = new Date()
  d.setDate(d.getDate() + 14)
  const y = d.getFullYear()
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${y}-${m}-${day}`
})

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

  if (!shippingAddress.value || !receiverAddressLine.value) {
    promptAddressBeforeSubmit()
    return
  }

  if (!receiverName.value || !receiverPhone.value) {
    ElMessage.warning('收货人姓名或手机号不完整，请重新选择或编辑收货地址')
    scrollToAddressSection()
    pulseAddressSection()
    return
  }

  if (hasBlockingMallOrder.value) {
    ElMessage.warning('您尚有进行中的订单，请待订单状态为「已完成」后再下单')
    return
  }

  if (orderBlacklisted.value) {
    ElMessage.warning('您的账号暂不可下单，如有疑问请联系客服')
    return
  }

  if (exceedsCreditLimit.value) {
    ElMessage.warning(
      `当前商品总额（￥${itemAmount.value.toFixed(2)}）已超过您的授信额度（￥${creditQuota.value}），请更换商品后再试`,
    )
    return
  }

  submitting.value = true
  orderSubmitLoadingVisible.value = true
  await nextTick()
  let newOrder: Awaited<ReturnType<typeof createOrder>> | undefined
  try {
    const apiBase = String(runtimeConfig.public.mallApiBase || '/api').replace(/\/$/, '')
    const idNumber = String(profile.value?.idNumber || '').trim()
    if (!idNumber) {
      ElMessage.warning('先享后付下单需填写身份证号，请先在「我的」完善注册资料后再试')
      return
    }
    type WaveCreateData = { waveId: string, stepKeys: string[] }
    type StepData = { ok: boolean, step?: { error?: string, label?: string } }
    const waveRes = await $fetch<{ success: boolean, msg?: string, data?: WaveCreateData }>(
      `${apiBase}/mall/installment-risk/wave`,
      {
        method: 'POST',
        body: {
          userName: receiverName.value,
          phoneNumber: receiverPhone.value,
          idNumber,
        },
      },
    )
    if (!waveRes.success || !waveRes.data?.waveId || !Array.isArray(waveRes.data.stepKeys)) {
      ElMessage.error(typeof waveRes.msg === 'string' && waveRes.msg.trim() ? waveRes.msg : '创建风控会话失败')
      return
    }
    const { waveId, stepKeys } = waveRes.data
    for (const stepKey of stepKeys) {
      const stepRes = await $fetch<{ success: boolean, msg?: string, data?: StepData }>(
        `${apiBase}/mall/installment-risk/wave/${encodeURIComponent(waveId)}/step/${encodeURIComponent(stepKey)}`,
        { method: 'POST' },
      )
      const ok = Boolean(stepRes.success && stepRes.data?.ok)
      if (!ok) {
        const errText = stepRes.data?.step?.error || (typeof stepRes.msg === 'string' ? stepRes.msg : '') || '系统审核不通过'
        ElMessage.error(`审核未通过（${stepRes.data?.step?.label || stepKey}）：${errText}`)
        return
      }
    }
    newOrder = await createOrder({
      productId: selectedProduct.value.id,
      name: selectedProduct.value.name,
      spec: selectedProduct.value.subtitle,
      totalAmount: installmentRepayTotal.value,
      quantity: ORDER_QUANTITY,
      status: 'reviewing',
      paid: false,
      payType: 'installment',
      payChannel: 'wechat',
      installmentPeriods: 1,
      receiverName: receiverName.value,
      receiverPhone: receiverPhone.value,
      receiverAddress: receiverAddressLine.value,
      idNumber: profile.value?.idNumber,
      idCardFront: profile.value?.idCardFront,
      idCardBack: profile.value?.idCardBack,
      installmentRiskWaveId: waveId,
    })
    currentOrderNo.value = newOrder.id
  }
  catch (error: unknown) {
    let msg = ''
    if (error && typeof error === 'object') {
      const o = error as { data?: { msg?: string } }
      msg = typeof o.data?.msg === 'string' ? o.data.msg.trim() : ''
    }
    ElMessage.error(msg || '创建订单失败，请稍后重试')
    return
  }
  finally {
    orderSubmitLoadingVisible.value = false
    submitting.value = false
  }
  if (!newOrder) {
    return
  }
  if (newOrder.riskStatus === 'failed') {
    ElMessage.warning(
      newOrder.riskReason
        ? `审核不通过：${newOrder.riskReason}`
        : '审核不通过，请稍后在订单列表查看详情',
    )
  }
  else {
    ElMessage.success(`系统审核通过，订单已提交，订单号 ${currentOrderNo.value}`)
  }
  await smartNavigate({
    path: '/orders',
    query: {
      status: 'reviewing',
      productId: String(selectedProduct.value.id),
      fromOrderCreate: '1',
    },
  })
}

async function bootstrapOrderPage() {
  await syncFromStorage()
  await Promise.all([
    ensureMallProductsLoaded(),
    ensureMallShowcaseProductsLoaded(),
    loadShippingAddresses(),
    syncFromRemote(),
  ])
}

if (!import.meta.env.SSR) {
  void bootstrapOrderPage()
  watch(
    () => addressPromptOpen.value || orderSubmitLoadingVisible.value,
    (busy) => {
      document.body.style.overflow = busy ? 'hidden' : ''
    },
  )
}

watch(
  () => `${String(route.query.addressId || '')}|${String(route.query.productId || '')}|${addresses.value.map(a => a.id).join(',')}`,
  () => {
    if (addresses.value.length) {
      syncSelectedAddressAfterFetch()
    }
  },
)

watch(
  () => String(route.query.productId || ''),
  async (pidStr) => {
    fetchedProductById.value = null
    const id = Number.parseInt(pidStr, 10)
    if (!pidStr || Number.isNaN(id) || id <= 0) {
      return
    }
    await Promise.all([ensureMallProductsLoaded(), ensureMallShowcaseProductsLoaded()])
    const hitMall = mallShowcaseProducts.value.some(p => p.id === id)
    const hitInst = installmentProducts.value.some(p => p.id === id)
    if (hitMall || hitInst) {
      return
    }
    const base = String(runtimeConfig.public.mallApiBase || '/api').replace(/\/$/, '')
    try {
      const res = await $fetch<{ success: boolean; data: Record<string, unknown> }>(`${base}/products/${id}`)
      if (res?.success && res.data) {
        fetchedProductById.value = normalizeApiProduct(res.data as Partial<TeaProduct>)
      }
    }
    catch {
      fetchedProductById.value = null
    }
  },
  { immediate: true },
)

watch(
  () => normalizeMallAccount(loginPhone.value || profile.value?.phone || ''),
  (account) => {
    void syncFromRemote()
    if (/^1\d{10}$/.test(account)) {
      addressesLoaded.value = false
      void fetchAddresses(account).finally(() => {
        addressesLoaded.value = true
        syncSelectedAddressAfterFetch()
      })
    }
    else {
      addressesLoaded.value = false
      void fetchAddresses('').finally(() => {
        addressesLoaded.value = true
        syncSelectedAddressAfterFetch()
      })
    }
  },
)
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
            <div class="mt-2 flex flex-wrap items-center gap-2">
              <span class="text-lg font-semibold text-[#e35f82]">￥{{ selectedProduct.price }}</span>
            </div>
          </div>
        </div>
      </div>

      <div
        v-else-if="productId"
        class="mb-4 rounded-2xl border border-dashed border-black/15 bg-white p-6 text-center shadow-[0_8px_18px_rgba(24,39,75,0.05)]"
      >
        <p class="text-sm text-black/65 leading-relaxed">
          未找到该商品信息，或商品列表仍在加载。请返回商品页重新点击「购买」。
        </p>
        <button
          type="button"
          class="mt-4 rounded-full bg-[var(--theme-color)] px-5 py-2 text-sm font-medium text-white active:opacity-90"
          @click="router.back()"
        >
          返回上一页
        </button>
      </div>

      <div
        ref="addressSectionRef"
        class="mb-4 rounded-2xl bg-white p-4 shadow-[0_8px_18px_rgba(24,39,75,0.05)] transition-shadow duration-300"
        :class="addressHighlight ? 'ring-2 ring-[var(--theme-color)] ring-offset-2 ring-offset-[#f3f4f8]' : ''"
      >
        <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 class="text-lg font-semibold text-black/82">
            收货信息
          </h2>
          <button
            type="button"
            class="text-sm font-medium text-[var(--theme-color)] underline-offset-2 hover:underline"
            @click="openAddressPicker"
          >
            {{ addresses.length ? '选择收货地址' : '添加收货地址' }}
          </button>
        </div>
        <template v-if="!addressesLoaded">
          <p class="text-sm text-black/50">
            正在加载收货地址…
          </p>
        </template>
        <template v-else-if="addresses.length && shippingAddress">
          <p class="mb-2 text-xs text-black/50">
            已选收货地址（可点右上角更换）
          </p>
          <div class="rounded-xl border border-black/10 bg-[#fafafa] p-3 text-sm">
            <p class="font-medium text-black/85">
              {{ receiverName }}
              <span
                v-if="shippingAddress.isDefault"
                class="ml-1.5 rounded bg-black/6 px-1.5 py-0.5 text-[10px] font-normal text-black/55"
              >默认</span>
            </p>
            <p class="mt-0.5 text-black/65">
              {{ receiverPhone }}
            </p>
            <p class="mt-1 text-xs text-black/55 leading-relaxed">
              {{ receiverAddressLine }}
            </p>
          </div>
        </template>
        <template v-else-if="addresses.length && !shippingAddress">
          <p class="text-sm text-amber-700">
            地址数据异常，请点击右上角「选择收货地址」重新选择
          </p>
        </template>
        <template v-else>
          <p class="text-sm text-black/60 leading-relaxed">
            您还没有收货地址。请点击右上角「添加收货地址」进入地址页添加，保存后将返回本页继续下单。
          </p>
        </template>
      </div>

      <div class="mb-4 rounded-2xl bg-white p-4 shadow-[0_8px_18px_rgba(24,39,75,0.05)]">
        <h2 class="mb-3 text-lg font-semibold text-black/82">
          支付方式
        </h2>
        <div class="rounded-xl border border-[var(--theme-color)] bg-[#eefcf8] px-3 py-3">
          <p class="text-sm font-semibold text-black/82">
            先享后付支付
          </p>
          <div class="mt-2 space-y-1.5 text-sm text-black/72">
            <p class="flex items-baseline justify-between gap-3">
              <span class="text-black/55">还款金额</span>
              <span class="text-lg font-semibold text-[#e35f82]">￥{{ installmentRepayTotal.toFixed(2) }}</span>
            </p>
            <p class="flex items-baseline justify-between gap-3">
              <span class="text-black/55">还款日</span>
              <span class="font-medium text-black/82 tabular-nums">{{ estimatedRepayDateYmd }}</span>
            </p>
          </div>
        </div>
      </div>

      <div class="rounded-2xl bg-white p-4 shadow-[0_8px_18px_rgba(24,39,75,0.05)]">
        <h2 class="mb-3 text-lg font-semibold text-black/82">
          金额明细
        </h2>
        <div class="space-y-1.5 text-sm text-black/68">
          <p class="flex items-center justify-between">
            <span>授信额度（可下单商品总额上限）</span>
            <span class="tabular-nums">￥{{ creditQuota }}</span>
          </p>
          <p class="flex items-center justify-between">
            <span>商品金额</span>
            <span>￥{{ itemAmount.toFixed(2) }}</span>
          </p>
          <p class="flex items-center justify-between text-black/80">
            <span>还款金额</span>
            <span class="font-medium text-[#e35f82]">￥{{ installmentRepayTotal.toFixed(2) }}</span>
          </p>
        </div>
        <div class="my-3 h-px bg-black/8" />
        <p class="flex items-center justify-between text-base font-semibold text-black/85">
          <span>应付金额</span>
          <span class="text-[#e35f82]">￥{{ installmentRepayTotal.toFixed(2) }}</span>
        </p>
      </div>

      <div class="mt-4 rounded-2xl bg-white p-4 shadow-[0_8px_18px_rgba(24,39,75,0.05)]">
        <div class="mb-3 flex items-center justify-between">
          <p class="text-sm text-black/65">
            合计金额
          </p>
          <p class="text-xl font-semibold text-[#e35f82]">
            ￥{{ installmentRepayTotal.toFixed(2) }}
          </p>
        </div>
        <p
          v-if="orderBlacklisted"
          class="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-900 leading-relaxed"
        >
          您的账号暂不可下单
        </p>
        <p
          v-else-if="hasBlockingMallOrder"
          class="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 leading-relaxed"
        >
          您已有进行中的订单，须待该订单在「我的订单」中显示为「已完成」后才可再次下单。
          <button
            type="button"
            class="ml-0.5 font-medium text-[var(--theme-color)] underline-offset-2 hover:underline"
            @click="smartNavigate({ path: '/orders' })"
          >
            查看我的订单
          </button>
        </p>
        <p
          v-else-if="exceedsCreditLimit"
          class="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 leading-relaxed"
        >
          当前商品总额已超过授信额度（￥{{ creditQuota }}）。请选择低价商品后再试。
        </p>
        <button
          type="button"
          class="w-full rounded-xl bg-[var(--theme-color)] px-5 py-3 text-sm font-semibold text-white disabled:opacity-60"
          :disabled="submitting || !canSubmitOrder"
          @click="submitOrder"
        >
          {{ submitting ? '系统审核与提交中…' : '提交订单并等待审核' }}
        </button>
        <p class="mt-2 text-center text-xs text-black/45">
          审核通过后可进入发货流程
        </p>
      </div>
    </div>
  </section>

  <Teleport to="body">
    <Transition name="order-review-loading">
      <div
        v-if="orderSubmitLoadingVisible"
        class="fixed inset-0 z-[8000] flex flex-col items-center justify-center bg-black/50 px-6"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <div class="order-review-loading-card flex max-w-[min(100%,20rem)] flex-col items-center rounded-2xl bg-white px-8 py-7 shadow-xl">
          <span class="order-review-spinner mb-4 inline-block h-11 w-11 rounded-full border-[3px] border-[var(--theme-color)] border-t-transparent" />
          <p class="text-center text-base font-semibold text-black/88">
            系统审核中
          </p>
          <p class="mt-2 text-center text-xs leading-relaxed text-black/52">
            正在校验运营商、法院及资信信息，请稍候…
          </p>
        </div>
      </div>
    </Transition>
  </Teleport>

  <Teleport to="body">
    <Transition name="order-address-mask">
      <div
        v-if="addressPromptOpen"
        class="fixed inset-0 z-[6000] flex flex-col justify-end bg-black/50 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:items-center sm:justify-center sm:pb-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="order-address-prompt-title"
        @click.self="dismissAddressPrompt"
      >
        <div
          class="order-address-sheet-panel mx-auto w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-[0_12px_48px_rgba(24,39,75,0.18)]"
          @click.stop
        >
          <div class="max-h-[min(70vh,28rem)] overflow-y-auto overscroll-contain px-5 pb-5 pt-6">
            <div class="mx-auto mb-4 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-100 text-base font-bold text-amber-800">
              ！
            </div>
            <h3
              id="order-address-prompt-title"
              class="text-center text-lg font-semibold leading-snug text-black/88"
            >
              {{ addressPromptTitle }}
            </h3>
            <p class="mt-3 text-center text-sm leading-relaxed text-black/62">
              {{ addressPromptBody }}
            </p>
            <div class="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:flex-row-reverse">
              <button
                type="button"
                class="min-h-[44px] w-full rounded-xl bg-[var(--theme-color)] px-4 py-2.5 text-sm font-semibold text-white active:opacity-90 sm:flex-1"
                @click="onAddressPromptPrimary"
              >
                {{ addressPromptPrimaryLabel }}
              </button>
              <button
                type="button"
                class="min-h-[44px] w-full rounded-xl border border-black/12 bg-white px-4 py-2.5 text-sm font-medium text-black/75 active:bg-black/[0.03] sm:flex-1"
                @click="dismissAddressPrompt"
              >
                {{ addressPromptKind === 'add' ? '稍后再说' : '留在本页' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.order-address-mask-enter-active,
.order-address-mask-leave-active {
  transition: opacity 0.2s ease;
}
.order-address-mask-enter-from,
.order-address-mask-leave-to {
  opacity: 0;
}
.order-address-mask-enter-active .order-address-sheet-panel,
.order-address-mask-leave-active .order-address-sheet-panel {
  transition: transform 0.22s ease, opacity 0.22s ease;
}
.order-address-mask-enter-from .order-address-sheet-panel,
.order-address-mask-leave-to .order-address-sheet-panel {
  opacity: 0;
  transform: translateY(16px);
}
@media (min-width: 640px) {
  .order-address-mask-enter-from .order-address-sheet-panel,
  .order-address-mask-leave-to .order-address-sheet-panel {
    transform: translateY(10px) scale(0.98);
  }
}

.order-review-loading-enter-active,
.order-review-loading-leave-active {
  transition: opacity 0.18s ease;
}
.order-review-loading-enter-from,
.order-review-loading-leave-to {
  opacity: 0;
}
.order-review-loading-enter-active .order-review-loading-card,
.order-review-loading-leave-active .order-review-loading-card {
  transition: transform 0.2s ease, opacity 0.2s ease;
}
.order-review-loading-enter-from .order-review-loading-card,
.order-review-loading-leave-to .order-review-loading-card {
  opacity: 0;
  transform: scale(0.96);
}

.order-review-spinner {
  animation: order-review-spin 0.75s linear infinite;
}
@keyframes order-review-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
