import { normalizeMallAccount } from '~/composables/useMallAuth'
import type { MallCardPackageDTO, MallCardPackageContractFlowData } from '~/api/modules/mall'
import type { MallOrderStatus } from '~/composables/useMallOrders'

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
}

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

function resolveMallApiBase() {
  const runtimeConfig = useRuntimeConfig()
  return runtimeConfig.public.mallApiBase || '/api'
}

/** 合同下载（含服务端 Puppeteer 生成 PDF）可能较慢；fetch 与 JSON 备用路径共用 */
const CONTRACT_DOWNLOAD_FETCH_MS = 180_000

/** 用户取消与内置超时任一触发即中止 fetch */
function mergeAbortSignals(user?: AbortSignal, timeout?: AbortSignal): AbortSignal | undefined {
  if (!user && !timeout) {
    return undefined
  }
  if (!timeout) {
    return user
  }
  if (!user) {
    return timeout
  }
  const u = user
  const t = timeout
  if (u.aborted || t.aborted) {
    const c = new AbortController()
    c.abort(u.aborted ? u.reason : t.reason)
    return c.signal
  }
  const merged = new AbortController()
  u.addEventListener('abort', () => merged.abort(u.reason), { once: true })
  t.addEventListener('abort', () => merged.abort(t.reason), { once: true })
  return merged.signal
}

function base64ToContractBlob(b64: string, fileType: unknown): Blob {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  const mime = Number(fileType) === 1 ? 'application/zip' : 'application/pdf'
  return new Blob([bytes], { type: mime })
}

function parseContractDownloadDataObject(root: Record<string, unknown>): { blob: Blob, fileName: string } {
  const flatData = root.data
  if (typeof flatData === 'string' && flatData.trim()) {
    const b64 = flatData.trim()
    const fileName = String(root.fileName || root.file_name || '合同.pdf')
    const fileType = root.fileType ?? root.file_type
    return { blob: base64ToContractBlob(b64, fileType), fileName }
  }
  if (flatData && typeof flatData === 'object' && !Array.isArray(flatData)) {
    const nested = flatData as Record<string, unknown>
    const b64 = typeof nested.data === 'string' ? nested.data.trim() : ''
    if (!b64) {
      throw new Error('暂无可下载的文件')
    }
    const fileName = String(
      nested.fileName || nested.file_name || root.fileName || root.file_name || '合同.pdf',
    )
    const fileType = nested.fileType ?? nested.file_type ?? root.fileType ?? root.file_type
    return { blob: base64ToContractBlob(b64, fileType), fileName }
  }
  throw new Error('暂无可下载的文件')
}

function parseContractDownloadEnvelope(envelope: Record<string, unknown>): { blob: Blob, fileName: string } {
  if (!envelope.success) {
    const msg = typeof envelope.msg === 'string' ? envelope.msg : '下载失败'
    const err = new Error(msg) as Error & { data?: unknown }
    err.data = envelope
    throw err
  }
  const root = envelope.data
  if (!root || typeof root !== 'object' || Array.isArray(root)) {
    throw new Error('合同数据为空')
  }
  return parseContractDownloadDataObject(root as Record<string, unknown>)
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
  const cardPackages = useState<MallCardPackageDTO[]>('mall-my-card-packages', () => [])
  const billSummary = useState<MallBillSummary>('mall-my-bill-summary', () => ({
    shouldRepay: 0,
    totalPending: 0,
    availableQuota: 0,
    billDate: '每月 08 日',
    minRepayment: 0,
  }))
  const bills = useState<MallBillItem[]>('mall-my-bills', () => [])

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
      query: { phone },
    })
    cardPackages.value = Array.isArray(response?.data) ? response.data : []
    return cardPackages.value
  }

  const fetchCardPackageContractFlow = async (account: string, orderId: string) => {
    const phone = normalizeMallAccount(account)
    if (!/^1\d{10}$/.test(phone)) {
      throw new Error('请先登录')
    }
    const response = await $fetch<{ success: boolean, data: MallCardPackageContractFlowData }>(
      `${resolveMallApiBase()}/card-packages/${encodeURIComponent(orderId)}/contract-flow`,
      { method: 'GET', query: { phone } },
    )
    if (!response?.data) {
      throw new Error('合同数据为空')
    }
    return response.data
  }

  const downloadCardPackageContract = async (account: string, orderId: string) => {
    const phone = normalizeMallAccount(account)
    if (!/^1\d{10}$/.test(phone)) {
      throw new Error('请先登录')
    }
    return await $fetch<{ success: boolean, data: Record<string, unknown> }>(
      `${resolveMallApiBase()}/card-packages/${encodeURIComponent(orderId)}/contract-download`,
      { method: 'GET', query: { phone }, timeout: CONTRACT_DOWNLOAD_FETCH_MS },
    )
  }

  /**
   * 下载卡包合同：优先请求 PDF 二进制（mock 下 `file=1`，减轻 JSON Base64 体积与网关断连）；
   * 否则解析 JSON（上游或旧版接口）。
   * @param opts.signal 传入则用户可中止（与内置 180s 超时合并，任一即 abort）
   */
  const downloadCardPackageContractBlob = async (
    account: string,
    orderId: string,
    opts?: { signal?: AbortSignal },
  ) => {
    const phone = normalizeMallAccount(account)
    if (!/^1\d{10}$/.test(phone)) {
      throw new Error('请先登录')
    }
    const base = `${resolveMallApiBase()}/card-packages/${encodeURIComponent(orderId)}/contract-download`
    const urlPdf = `${base}?phone=${encodeURIComponent(phone)}&file=1`
    const timeoutCtrl = new AbortController()
    const timer = setTimeout(() => timeoutCtrl.abort(), CONTRACT_DOWNLOAD_FETCH_MS)
    const signal = mergeAbortSignals(opts?.signal, timeoutCtrl.signal)
    try {
      const res = await fetch(urlPdf, { method: 'GET', signal })
      const ct = (res.headers.get('content-type') || '').toLowerCase()
      if (res.ok && ct.includes('application/pdf')) {
        const disp = res.headers.get('content-disposition') || ''
        let fileName = '合同.pdf'
        const mStar = /filename\*=UTF-8''([^;]+)/i.exec(disp)
        const mQuot = /filename="([^"]+)"/i.exec(disp)
        if (mStar?.[1]) {
          try {
            fileName = decodeURIComponent(mStar[1].trim())
          }
          catch {
            /* ignore */
          }
        }
        else if (mQuot?.[1]) {
          fileName = mQuot[1]
        }
        const blob = await res.blob()
        return { blob, fileName }
      }
      const json = (await res.json().catch(() => null)) as Record<string, unknown> | null
      if (!res.ok) {
        const msg = (json && typeof json.msg === 'string' && json.msg) || res.statusText || '下载失败'
        const err = new Error(msg) as Error & { data?: unknown }
        err.data = json
        throw err
      }
      if (json && json.success) {
        return parseContractDownloadEnvelope(json)
      }
      const msg = (json && typeof json.msg === 'string' && json.msg) || '暂无可下载的文件'
      throw new Error(msg)
    }
    finally {
      clearTimeout(timer)
    }
  }

  const ackCardPackageContract = async (account: string, orderId: string) => {
    const phone = normalizeMallAccount(account)
    if (!/^1\d{10}$/.test(phone)) {
      throw new Error('请先登录')
    }
    return await $fetch<{ success: boolean, data: { signed?: boolean } }>(
      `${resolveMallApiBase()}/card-packages/${encodeURIComponent(orderId)}/contract-ack`,
      { method: 'POST', query: { phone } },
    )
  }

  const resetCardPackageContractSign = async (account: string, orderId: string) => {
    const phone = normalizeMallAccount(account)
    if (!/^1\d{10}$/.test(phone)) {
      throw new Error('请先登录')
    }
    return await $fetch<{ success: boolean, data: { reset?: boolean } }>(
      `${resolveMallApiBase()}/card-packages/${encodeURIComponent(orderId)}/contract-sign-reset`,
      { method: 'POST', query: { phone } },
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
    addresses.value = Array.isArray(response?.data) ? response.data : []
    return addresses.value
  }

  const createAddress = async (account: string, payload: MallAddressPayload) => {
    const phone = normalizeMallAccount(account)
    await $fetch(`${resolveMallApiBase()}/addresses`, {
      method: 'POST',
      body: {
        userPhone: phone,
        ...payload,
      },
    })
    await fetchAddresses(phone)
  }

  const updateAddress = async (addressId: number, payload: Partial<MallAddressPayload>) => {
    await $fetch(`${resolveMallApiBase()}/addresses/${addressId}`, {
      method: 'PATCH',
      body: payload,
    })
  }

  const setDefaultAddress = async (addressId: number) => {
    await $fetch(`${resolveMallApiBase()}/addresses/${addressId}/default`, {
      method: 'PATCH',
    })
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
    bankCards.value = Array.isArray(response?.data) ? response.data : []
    return bankCards.value
  }

  const createBankCard = async (account: string, payload: { bankName: string, cardType: string, cardNo: string, owner: string }) => {
    const phone = normalizeMallAccount(account)
    await $fetch(`${resolveMallApiBase()}/bank-cards`, {
      method: 'POST',
      body: {
        userPhone: phone,
        ...payload,
      },
    })
    await fetchBankCards(phone)
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
    await fetchBankCards(phone)
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
    billSummary.value = response?.data?.summary || {
      shouldRepay: 0,
      totalPending: 0,
      availableQuota: 0,
      billDate: '每月 08 日',
      minRepayment: 0,
    }
    bills.value = Array.isArray(response?.data?.list) ? response.data.list : []
    const tp = Number(Number(billSummary.value.totalPending ?? billSummary.value.shouldRepay ?? 0).toFixed(2))
    summary.value = { ...summary.value, billPendingAmount: tp }
    return response.data
  }

  /** 用户端协商支付：支付后台登记的协商还款金额后，再落库剩余应还本金（成功后 fetchBills 更新界面） */
  const repayNegotiatedBills = async (account: string, payload: MallRepayNegotiatedPayload) => {
    const phone = normalizeMallAccount(account)
    if (!/^1\d{10}$/.test(phone)) {
      throw new Error('请先登录')
    }
    await $fetch<{ success: boolean }>(`${resolveMallApiBase()}/bills/repay-negotiated`, {
      method: 'POST',
      query: { phone },
      body: payload,
    })
    await fetchBills(phone)
    await fetchSummary(phone)
  }

  /** 用户端还款：与后台订单分期 `paid` 同步（需卡包已发放等规则与 POST /bills/repay 一致） */
  const repayBills = async (account: string, payload: MallRepayPayload) => {
    const phone = normalizeMallAccount(account)
    if (!/^1\d{10}$/.test(phone)) {
      throw new Error('请先登录')
    }
    await $fetch<{ success: boolean }>(`${resolveMallApiBase()}/bills/repay`, {
      method: 'POST',
      query: { phone },
      body: payload,
    })
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
    downloadCardPackageContract,
    downloadCardPackageContractBlob,
    ackCardPackageContract,
    resetCardPackageContractSign,
    saveMallEmergencyContacts,
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
  }
}
