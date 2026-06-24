import { normalizeMallAccount } from '~/composables/useMallAuth'
import type { MallCardPackageDTO, MallCardPackageContractFlowData } from '~/api/modules/mall'
import type { MallOrderStatus } from '~/composables/useMallOrders'
import { resolveTenantId } from '~/utils/tenant'

/** mall 租户：与 x-tenant-id 一致；iframe 打不开合同时依赖 URL query 也需此口径 */
function mallTenantQueryProps() {
  if (import.meta.env.SSR)
    return {} as Record<string, string>
  return { tenantId: resolveTenantId() }
}

export interface MallMySummary {
  orderCount: Record<MallOrderStatus, number>
  bankCardCount: number
  billPendingAmount: number
}

export interface MallAddressItem {
  id: number
  userPhone: string
  receiver: string
  phone: string
  province: string
  city: string
  district: string
  detail: string
  isDefault: boolean
  createdAt?: string
}

export interface MallAddressPayload {
  receiver: string
  phone: string
  province: string
  city: string
  district: string
  detail: string
  isDefault: boolean
}

export interface MallBankCardItem {
  id: number
  userPhone: string
  bankName: string
  cardType: string
  cardNo: string
  cardNoMasked: string
  owner: string
  createdAt?: string
}

export interface MallBillNegotiationEntry {
  negotiatedAmount: number
  remainderAmount: number
  remainderDueDate: string
  /** 登记协商的时间（ISO），用于展示「协商日期」 */
  createdAt: string
  /** 用户完成前台「协商支付」的时间（ISO） */
  userPaidAt?: string
}

export interface MallNegotiationPayPending {
  negotiatedAmount: number
  remainderAmount: number
  remainderDueDate: string
  createdAt: string
}

export interface MallBillItem {
  /** 稳定键，格式 `orderId:period` 或 `orderId:period:negotiation` */
  id: string
  orderId: string
  period: number
  userPhone: string
  title: string
  amount: number
  time: string
  status: string
  /** 对账单汇总去重：`negotiation` 与对应分期行金额一致，仅用于展示 */
  billKind?: 'installment' | 'negotiation'
  /** 最近一条协商中登记的「协商还款金额」（旧接口协商行；新接口见 negotiationHistory） */
  negotiatedAmount?: number
  /** 该期多次协商的完整记录（与后台 installmentPlan.negotiationHistory 一致） */
  negotiationHistory?: MallBillNegotiationEntry[]
  /** 后台协商后待用户完成「协商支付」的款项；支付成功后顶部待还金额才会按剩余本金更新 */
  negotiationPayPending?: MallNegotiationPayPending
  /** 对应订单卡包是否已发放；未发放时不可还款（与预下单接口一致） */
  cardPackageIssued?: boolean
}

/** 账单是否允许发起还款/协商支付（卡包未发放时在前台拦截） */
export function mallBillRepayAllowed(item: MallBillItem): boolean {
  return item.cardPackageIssued !== false
}

export const MALL_BILL_CARD_PACKAGE_REPAY_MSG = '卡包尚未发放，暂无法还款，请待卡包发放后再试'

export type MallRepayPayload = { orderId: string, period: number } | { all: true }

export type MallRepayNegotiatedPayload = { orderId: string, period: number }

export interface MallBillSummary {
  /** 本月到期应还（与列表「到期日所在月」筛选一致） */
  shouldRepay: number
  /** 全部待还期次合计（与列表、一键还款扣款范围一致） */
  totalPending: number
  availableQuota: number
  billDate: string
  minRepayment: number
}

export interface MallBillingRefreshPayload {
  summary: MallBillSummary
  list: MallBillItem[]
}

/** POST /orders 成功后携带，与紧随其后的 GET /bills、GET /my/summary 一致 */
export interface MallPostOrderRefreshPayload {
  billing: MallBillingRefreshPayload
  mySummary: MallMySummary
}

export interface MallBillRiskUploadLink {
  generated: boolean
  guideUrl: string
  lastGeneratedAt: string
}

function resolveMallApiBase() {
  const runtimeConfig = useRuntimeConfig()
  return runtimeConfig.public.mallApiBase || '/api'
}

function emptySummary(): MallMySummary {
  return {
    orderCount: {
      reviewing: 0,
      shipping: 0,
      receiving: 0,
      enjoying: 0,
    },
    bankCardCount: 0,
    billPendingAmount: 0,
  }
}

function toNumber(value: unknown, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function normalizeMallCardPackage(item: unknown): MallCardPackageDTO | null {
  if (!item || typeof item !== 'object') {
    return null
  }
  const raw = item as Record<string, unknown>
  const orderId = String(raw.orderId || '').trim()
  const title = String(raw.title || '').trim()
  const createdAt = String(raw.createdAt || '').trim()
  if (!orderId || !title) {
    return null
  }
  return {
    orderId,
    title,
    spec: String(raw.spec || ''),
    totalAmount: toNumber(raw.totalAmount),
    packageAmount: toNumber(raw.packageAmount),
    cardPackageIssued: Boolean(raw.cardPackageIssued),
    orderStatus: String(raw.orderStatus || ''),
    createdAt,
  }
}

function normalizeMallAddress(item: unknown): MallAddressItem | null {
  if (!item || typeof item !== 'object') {
    return null
  }
  const raw = item as Record<string, unknown>
  const id = toNumber(raw.id, NaN)
  if (!Number.isFinite(id)) {
    return null
  }
  return {
    id,
    userPhone: String(raw.userPhone || ''),
    receiver: String(raw.receiver || '').trim(),
    phone: String(raw.phone || '').trim(),
    province: String(raw.province || '').trim(),
    city: String(raw.city || '').trim(),
    district: String(raw.district || '').trim(),
    detail: String(raw.detail || '').trim(),
    isDefault: Boolean(raw.isDefault),
    createdAt: String(raw.createdAt || '').trim() || undefined,
  }
}

function normalizeMallBankCard(item: unknown): MallBankCardItem | null {
  if (!item || typeof item !== 'object') {
    return null
  }
  const raw = item as Record<string, unknown>
  const id = toNumber(raw.id, NaN)
  if (!Number.isFinite(id)) {
    return null
  }
  const cardNo = String(raw.cardNo || '').trim()
  const masked = String(raw.cardNoMasked || '').trim()
  return {
    id,
    userPhone: String(raw.userPhone || '').trim(),
    bankName: String(raw.bankName || '').trim(),
    cardType: String(raw.cardType || '').trim(),
    cardNo,
    cardNoMasked: masked || cardNo,
    owner: String(raw.owner || '').trim(),
    createdAt: String(raw.createdAt || '').trim() || undefined,
  }
}

function normalizeMallBillRiskUploadLink(item: unknown): MallBillRiskUploadLink {
  const raw = item && typeof item === 'object' ? item as Record<string, unknown> : {}
  return {
    generated: Boolean(raw.generated),
    guideUrl: String(raw.guideUrl || '').trim(),
    lastGeneratedAt: String(raw.lastGeneratedAt || '').trim(),
  }
}

/** 与 GET /addresses 排序一致 */
function sortMallAddressList(list: MallAddressItem[]) {
  return [...list].sort(
    (a, b) => Number(b.isDefault) - Number(a.isDefault) || b.id - a.id,
  )
}

export function formatBillAmount(amount: number) {
  const value = Number(amount || 0)
  const abs = Math.abs(value).toFixed(2)
  return `${value >= 0 ? '+' : '-'}￥${abs}`
}

/** 省市区 + 详细地址，用于下单展示 */
export function formatMallAddressLine(item: MallAddressItem) {
  return `${item.province || ''}${item.city || ''}${item.district || ''}${item.detail || ''}`.trim()
}

/**
 * 地址页保存成功后跳转回下单（URL query：return=/order-create&productId=商品id）
 */
export function consumeAddressPageReturnNavigation(route: { query: Record<string, unknown> }): { path: string, query: Record<string, string> } | null {
  if (String(route.query.return || '') !== '/order-create') {
    return null
  }
  const pid = route.query.productId
  const query: Record<string, string> = {}
  if (typeof pid === 'string' && /^\d+$/.test(pid.trim())) {
    query.productId = pid.trim()
  }
  return { path: '/order-create', query }
}

/** 从下单页进入地址列表点选收货地址（与 return=/order-create 同时使用） */
export function isAddressPickForOrderRoute(route: { query: Record<string, unknown> }) {
  return String(route.query.pick || '') === '1' && String(route.query.return || '') === '/order-create'
}

export function orderCreateProductIdFromAddressRoute(route: { query: Record<string, unknown> }): string {
  const pid = route.query.productId
  return typeof pid === 'string' && /^\d+$/.test(pid.trim()) ? pid.trim() : ''
}

export function useMallMy() {
  const summary = useState<MallMySummary>('mall-my-summary', emptySummary)
  const addresses = useState<MallAddressItem[]>('mall-my-addresses', () => [])
  const bankCards = useState<MallBankCardItem[]>('mall-my-bank-cards', () => [])

  function applyAddressUpsert(row: MallAddressItem) {
    const phone = row.userPhone
    const withoutId = addresses.value.filter(a => a.id !== row.id)
    const mapped = row.isDefault
      ? withoutId.map(a => (a.userPhone === phone ? { ...a, isDefault: false } : a))
      : withoutId
    addresses.value = sortMallAddressList([row, ...mapped])
  }
  const cardPackages = useState<MallCardPackageDTO[]>('mall-my-card-packages', () => [])
  const billSummary = useState<MallBillSummary>('mall-my-bill-summary', () => ({
    shouldRepay: 0,
    totalPending: 0,
    availableQuota: 0,
    billDate: '每月 08 日',
    minRepayment: 0,
  }))
  const bills = useState<MallBillItem[]>('mall-my-bills', () => [])

  function applyBillingPayloadToState(data: { summary?: unknown, list?: unknown }): boolean {
    const s = data.summary
    if (!s || typeof s !== 'object' || !Array.isArray(data.list))
      return false
    const r = s as Record<string, unknown>
    billSummary.value = {
      shouldRepay: Number(r.shouldRepay ?? 0),
      totalPending: Number(r.totalPending ?? 0),
      availableQuota: Number(r.availableQuota ?? 0),
      billDate: String(r.billDate ?? '每月 08 日'),
      minRepayment: Number(r.minRepayment ?? 0),
    }
    bills.value = data.list as MallBillItem[]
    const tp = Number(Number(billSummary.value.totalPending ?? billSummary.value.shouldRepay ?? 0).toFixed(2))
    summary.value = { ...summary.value, billPendingAmount: tp }
    return true
  }

  function mergeCardPackageRowFromPayload(row: unknown): boolean {
    const dto = normalizeMallCardPackage(row)
    if (!dto)
      return false
    cardPackages.value = [dto, ...cardPackages.value.filter(p => String(p.orderId) !== String(dto.orderId))]
    return true
  }

  function applyPostOrderCreationBundles(account: string, bundle: MallPostOrderRefreshPayload | null | undefined) {
    const phone = normalizeMallAccount(account)
    if (!/^1\d{10}$/.test(phone) || !bundle)
      return
    if (bundle.billing?.summary != null && Array.isArray(bundle.billing.list))
      applyBillingPayloadToState(bundle.billing)
    if (bundle.mySummary) {
      summary.value = {
        ...bundle.mySummary,
        billPendingAmount: Number(Number(bundle.mySummary.billPendingAmount ?? 0).toFixed(2)),
      }
    }
  }

  const fetchSummary = async (account: string) => {
    const phone = normalizeMallAccount(account)
    if (!/^1\d{10}$/.test(phone)) {
      summary.value = emptySummary()
      return summary.value
    }
    const response = await $fetch<{ success: boolean, data: MallMySummary }>(`${resolveMallApiBase()}/my/summary`, {
      method: 'GET',
      query: { phone },
    })
    const raw = response.data || emptySummary()
    summary.value = {
      ...raw,
      billPendingAmount: Number(Number(raw.billPendingAmount ?? 0).toFixed(2)),
    }
    return summary.value
  }

  const fetchCardPackages = async (account: string) => {
    const phone = normalizeMallAccount(account)
    if (!/^1\d{10}$/.test(phone)) {
      cardPackages.value = []
      return cardPackages.value
    }
    const response = await $fetch<{ success: boolean, data: MallCardPackageDTO[] }>(`${resolveMallApiBase()}/card-packages`, {
      method: 'GET',
      query: { phone, ...mallTenantQueryProps() },
    })
    const list = Array.isArray(response?.data) ? response.data : []
    cardPackages.value = list
      .map(normalizeMallCardPackage)
      .filter((item): item is MallCardPackageDTO => Boolean(item))
    return cardPackages.value
  }

  const fetchCardPackageContractFlow = async (account: string, orderId: string) => {
    const phone = normalizeMallAccount(account)
    if (!/^1\d{10}$/.test(phone)) {
      throw new Error('请先登录')
    }
    const response = await $fetch<{ success: boolean, data: MallCardPackageContractFlowData }>(
      `${resolveMallApiBase()}/card-packages/${encodeURIComponent(orderId)}/contract-flow`,
      { method: 'GET', query: { phone, ...mallTenantQueryProps() } },
    )
    if (!response?.data) {
      throw new Error('合同数据为空')
    }
    return response.data
  }

  const ackCardPackageContract = async (account: string, orderId: string) => {
    const phone = normalizeMallAccount(account)
    if (!/^1\d{10}$/.test(phone)) {
      throw new Error('请先登录')
    }
    const res = await $fetch<{ success: boolean, data: { signed?: boolean, cardPackageRow?: unknown } }>(
      `${resolveMallApiBase()}/card-packages/${encodeURIComponent(orderId)}/contract-ack`,
      { method: 'POST', query: { phone, ...mallTenantQueryProps() } },
    )
    mergeCardPackageRowFromPayload(res.data?.cardPackageRow)
    return res
  }

  const resetCardPackageContractSign = async (account: string, orderId: string) => {
    const phone = normalizeMallAccount(account)
    if (!/^1\d{10}$/.test(phone)) {
      throw new Error('请先登录')
    }
    return await $fetch<{ success: boolean, data: { reset?: boolean } }>(
      `${resolveMallApiBase()}/card-packages/${encodeURIComponent(orderId)}/contract-sign-reset`,
      { method: 'POST', query: { phone, ...mallTenantQueryProps() } },
    )
  }

  const saveMallEmergencyContacts = async (
    account: string,
    contacts: Array<{ name: string, phone: string }>,
  ) => {
    const phone = normalizeMallAccount(account)
    if (!/^1\d{10}$/.test(phone)) {
      throw new Error('请先登录')
    }
    return await $fetch<{ success: boolean, data: { user?: Record<string, unknown> } }>(
      `${resolveMallApiBase()}/mall/me/emergency-contacts`,
      { method: 'POST', query: { phone }, body: { contacts } },
    )
  }

  const fetchBillRiskUploadLink = async (account: string) => {
    const phone = normalizeMallAccount(account)
    if (!/^1\d{10}$/.test(phone)) {
      throw new Error('请先登录')
    }
    const response = await $fetch<{ success: boolean, data: MallBillRiskUploadLink }>(
      `${resolveMallApiBase()}/mall/me/bill-risk`,
      { method: 'GET', query: { phone } },
    )
    return normalizeMallBillRiskUploadLink(response?.data)
  }

  const fetchAddresses = async (account: string) => {
    const phone = normalizeMallAccount(account)
    if (!/^1\d{10}$/.test(phone)) {
      addresses.value = []
      return addresses.value
    }
    const response = await $fetch<{ success: boolean, data: MallAddressItem[] }>(`${resolveMallApiBase()}/addresses`, {
      method: 'GET',
      query: { phone },
    })
    const list = Array.isArray(response?.data) ? response.data : []
    addresses.value = sortMallAddressList(
      list
        .map(normalizeMallAddress)
        .filter((item): item is MallAddressItem => Boolean(item)),
    )
    return addresses.value
  }

  const createAddress = async (account: string, payload: MallAddressPayload) => {
    const phone = normalizeMallAccount(account)
    const res = await $fetch<{ success?: boolean, data?: unknown }>(`${resolveMallApiBase()}/addresses`, {
      method: 'POST',
      body: {
        userPhone: phone,
        ...payload,
      },
    })
    const item = normalizeMallAddress(res.data)
    if (item)
      applyAddressUpsert(item)
    else
      await fetchAddresses(phone)
  }

  const updateAddress = async (addressId: number, payload: Partial<MallAddressPayload>) => {
    const res = await $fetch<{ success?: boolean, data?: unknown }>(`${resolveMallApiBase()}/addresses/${addressId}`, {
      method: 'PATCH',
      body: payload,
    })
    const item = normalizeMallAddress(res.data)
    if (item) {
      applyAddressUpsert(item)
    }
    else {
      const row = addresses.value.find(a => a.id === addressId)
      if (row?.userPhone)
        await fetchAddresses(row.userPhone)
    }
  }

  const setDefaultAddress = async (addressId: number) => {
    const res = await $fetch<{ success?: boolean, data?: unknown }>(`${resolveMallApiBase()}/addresses/${addressId}/default`, {
      method: 'PATCH',
    })
    const item = normalizeMallAddress(res.data)
    if (item) {
      applyAddressUpsert(item)
    }
    else {
      const row = addresses.value.find(a => a.id === addressId)
      if (row?.userPhone)
        await fetchAddresses(row.userPhone)
    }
  }

  const fetchBankCards = async (account: string) => {
    const phone = normalizeMallAccount(account)
    if (!/^1\d{10}$/.test(phone)) {
      bankCards.value = []
      return bankCards.value
    }
    const response = await $fetch<{ success: boolean, data: MallBankCardItem[] }>(`${resolveMallApiBase()}/bank-cards`, {
      method: 'GET',
      query: { phone },
    })
    const list = Array.isArray(response?.data) ? response.data : []
    bankCards.value = list
      .map(normalizeMallBankCard)
      .filter((item): item is MallBankCardItem => Boolean(item))
    return bankCards.value
  }

  const createBankCard = async (account: string, payload: { bankName: string, cardType: string, cardNo: string, owner: string }) => {
    const phone = normalizeMallAccount(account)
    const res = await $fetch<{ success?: boolean, data?: unknown }>(`${resolveMallApiBase()}/bank-cards`, {
      method: 'POST',
      body: {
        userPhone: phone,
        ...payload,
      },
    })
    const item = normalizeMallBankCard(res.data)
    if (item) {
      bankCards.value = [item, ...bankCards.value.filter(c => c.id !== item.id)]
    }
    else {
      await fetchBankCards(phone)
    }
  }

  const deleteBankCard = async (account: string, cardId: number) => {
    const phone = normalizeMallAccount(account)
    if (!/^1\d{10}$/.test(phone)) {
      return
    }
    await $fetch(`${resolveMallApiBase()}/bank-cards/${cardId}`, {
      method: 'DELETE',
      query: { phone },
    })
    bankCards.value = bankCards.value.filter(c => c.id !== cardId)
    await fetchSummary(phone)
  }

  const fetchBills = async (account: string) => {
    const phone = normalizeMallAccount(account)
    if (!/^1\d{10}$/.test(phone)) {
      billSummary.value = {
        shouldRepay: 0,
        totalPending: 0,
        availableQuota: 0,
        billDate: '每月 08 日',
        minRepayment: 0,
      }
      bills.value = []
      summary.value = { ...summary.value, billPendingAmount: 0 }
      return {
        summary: billSummary.value,
        list: bills.value,
      }
    }
    const response = await $fetch<{ success: boolean, data: { summary: MallBillSummary, list: MallBillItem[] } }>(`${resolveMallApiBase()}/bills`, {
      method: 'GET',
      query: { phone },
    })
    const d = response?.data
    if (!applyBillingPayloadToState({ summary: d?.summary, list: d?.list })) {
      billSummary.value = {
        shouldRepay: 0,
        totalPending: 0,
        availableQuota: 0,
        billDate: '每月 08 日',
        minRepayment: 0,
      }
      bills.value = []
      summary.value = { ...summary.value, billPendingAmount: 0 }
    }
    return {
      summary: billSummary.value,
      list: bills.value,
    }
  }

  /** 用户端协商支付（优先合并响应内 billing；与 POST /bills/repay 返回结构一致） */
  const repayNegotiatedBills = async (account: string, payload: MallRepayNegotiatedPayload) => {
    const phone = normalizeMallAccount(account)
    if (!/^1\d{10}$/.test(phone)) {
      throw new Error('请先登录')
    }
    const res = await $fetch<{ success: boolean, data?: { billing?: MallBillingRefreshPayload } }>(
      `${resolveMallApiBase()}/bills/repay-negotiated`,
      { method: 'POST', query: { phone }, body: payload },
    )
    if (!applyBillingPayloadToState({ summary: res.data?.billing?.summary, list: res.data?.billing?.list }))
      await fetchBills(phone)
    await fetchSummary(phone)
  }

  /** 用户端还款（同上） */
  const repayBills = async (account: string, payload: MallRepayPayload) => {
    const phone = normalizeMallAccount(account)
    if (!/^1\d{10}$/.test(phone)) {
      throw new Error('请先登录')
    }
    const res = await $fetch<{ success: boolean, data?: { billing?: MallBillingRefreshPayload } }>(
      `${resolveMallApiBase()}/bills/repay`,
      { method: 'POST', query: { phone }, body: payload },
    )
    if (!applyBillingPayloadToState({ summary: res.data?.billing?.summary, list: res.data?.billing?.list }))
      await fetchBills(phone)
    await fetchSummary(phone)
  }

  return {
    summary,
    addresses,
    bankCards,
    cardPackages,
    billSummary,
    bills,
    fetchSummary,
    fetchCardPackages,
    fetchCardPackageContractFlow,
    ackCardPackageContract,
    resetCardPackageContractSign,
    saveMallEmergencyContacts,
    fetchBillRiskUploadLink,
    fetchAddresses,
    createAddress,
    updateAddress,
    setDefaultAddress,
    fetchBankCards,
    createBankCard,
    deleteBankCard,
    fetchBills,
    repayBills,
    repayNegotiatedBills,
    applyPostOrderCreationBundles,
    mergeCardPackageRowFromPayload,
  }
}
