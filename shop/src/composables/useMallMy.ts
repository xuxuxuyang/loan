import { normalizeMallAccount } from '~/composables/useMallAuth'
import type { MallCardPackageDTO } from '~/api/modules/mall'
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

export interface MallBillItem {
  id: number
  userPhone: string
  title: string
  amount: number
  time: string
  status: string
}

export interface MallBillSummary {
  shouldRepay: number
  availableQuota: number
  billDate: string
  minRepayment: number
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
    summary.value = response.data || emptySummary()
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
        availableQuota: 0,
        billDate: '每月 08 日',
        minRepayment: 0,
      }
      bills.value = []
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
      availableQuota: 0,
      billDate: '每月 08 日',
      minRepayment: 0,
    }
    bills.value = Array.isArray(response?.data?.list) ? response.data.list : []
    return response.data
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
    fetchAddresses,
    createAddress,
    updateAddress,
    setDefaultAddress,
    fetchBankCards,
    createBankCard,
    deleteBankCard,
    fetchBills,
  }
}
