import { normalizeReceiverPhoneDigits } from '~/composables/useMallOrders'
import type { MallPayChannel } from '~/composables/useMallOrders'
import type { MallBillingRefreshPayload } from '~/composables/useMallMy'

export type LakalaPayBizType =
  | 'order_full'
  | 'bill_repay'
  | 'bill_repay_negotiated'
  | 'bill_repay_all'

export interface LakalaPreorderPayload {
  bizType: LakalaPayBizType
  /** 不传则由拉卡拉收银台展示全部已开通支付方式 */
  payChannel?: MallPayChannel
  orderId?: string
  period?: number
  all?: boolean
}

export interface LakalaPreorderResult {
  outTradeNo: string
  tradeNo?: string
  payOrderNo?: string
  amountYuan: number
  payChannel?: MallPayChannel
  accountType?: string
  payCode: string
  counterUrl?: string
  payCodeImage?: string
  mock?: boolean
  bizType: LakalaPayBizType
  orderId?: string
  period?: number
}

export interface LakalaPayStatusResult {
  status: 'pending' | 'success'
  tradeState?: string
  outTradeNo: string
  billing?: MallBillingRefreshPayload
}

function resolveMallApiBase() {
  const runtimeConfig = useRuntimeConfig()
  return String(runtimeConfig.public.mallApiBase || '/api').replace(/\/$/, '')
}

function buildMallAuthHeader(phoneRaw: string): Record<string, string> | undefined {
  let u = normalizeReceiverPhoneDigits(phoneRaw)
  if (u.startsWith('86') && u.length === 13) {
    u = u.slice(2)
  }
  if (!/^1\d{10}$/.test(u)) {
    return undefined
  }
  return { Authorization: `Bearer mock-token-${u}` }
}

export function useLakalaPayment() {
  const config = useState<{ enabled: boolean, mock: boolean, mode?: 'counter' | 'scan' } | null>('lakala-pay-config', () => null)

  async function fetchPayConfig() {
    try {
      const res = await $fetch<{ success: boolean, data: { enabled: boolean, mock: boolean, mode?: 'counter' | 'scan' } }>(
        `${resolveMallApiBase()}/payment/lakala/config`,
      )
      config.value = res.data || { enabled: false, mock: false }
      return config.value
    }
    catch {
      config.value = { enabled: false, mock: false }
      return config.value
    }
  }

  async function createPreorder(phone: string, payload: LakalaPreorderPayload) {
    const headers = buildMallAuthHeader(phone)
    if (!headers) {
      throw new Error('请先登录')
    }
    const res = await $fetch<{ success: boolean, data: LakalaPreorderResult, msg?: string }>(
      `${resolveMallApiBase()}/payment/lakala/preorder`,
      { method: 'POST', headers, body: payload },
    )
    if (!res?.success || !res.data) {
      throw new Error(res?.msg || '创建支付失败')
    }
    return res.data
  }

  async function queryPayStatus(phone: string, outTradeNo: string) {
    const headers = buildMallAuthHeader(phone)
    if (!headers) {
      throw new Error('请先登录')
    }
    const res = await $fetch<{ success: boolean, data: LakalaPayStatusResult, msg?: string }>(
      `${resolveMallApiBase()}/payment/lakala/status/${encodeURIComponent(outTradeNo)}`,
      { headers },
    ).catch((err: unknown) => {
      const o = err as { data?: { msg?: string }, statusCode?: number, status?: number }
      const msg = o?.data?.msg || (err as Error)?.message || '查询支付状态失败'
      const code = o?.statusCode ?? o?.status
      if (code === 404 && String(msg).includes('支付单不存在')) {
        throw new Error('支付单尚未就绪，请稍后重试或点击「模拟支付成功」')
      }
      throw new Error(msg)
    })
    if (!res?.success || !res.data) {
      throw new Error(res?.msg || '查询支付状态失败')
    }
    return res.data
  }

  async function mockCompletePay(phone: string, outTradeNo: string) {
    const headers = buildMallAuthHeader(phone)
    if (!headers) {
      throw new Error('请先登录')
    }
    const res = await $fetch<{ success: boolean, data: LakalaPayStatusResult, msg?: string }>(
      `${resolveMallApiBase()}/payment/lakala/mock-complete/${encodeURIComponent(outTradeNo)}`,
      { method: 'POST', headers },
    )
    if (!res?.success || !res.data) {
      throw new Error(res?.msg || '模拟支付失败')
    }
    return res.data
  }

  /** 轮询直至成功或超时 */
  async function pollUntilPaid(
    phone: string,
    outTradeNo: string,
    { intervalMs = 2500, timeoutMs = 5 * 60 * 1000 } = {},
  ): Promise<LakalaPayStatusResult> {
    const started = Date.now()
    for (;;) {
      const status = await queryPayStatus(phone, outTradeNo)
      if (status.status === 'success') {
        return status
      }
      if (Date.now() - started > timeoutMs) {
        throw new Error('支付超时，请稍后在订单/账单页查看是否到账')
      }
      await new Promise(r => setTimeout(r, intervalMs))
    }
  }

  return {
    config,
    fetchPayConfig,
    createPreorder,
    queryPayStatus,
    mockCompletePay,
    pollUntilPaid,
  }
}
