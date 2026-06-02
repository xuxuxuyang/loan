/**
 * 商城业务接口相关类型（请求走 `mallApiBase`，实现见 `composables/useMallMy.ts`）。
 */
export interface MallCardPackageContractFlowData {
  contractNo: string
  /** 上游 getContract 完整 JSON（含 data.status、signUser 等） */
  getContract: Record<string, unknown>
}

export interface MallCardPackageDTO {
  orderId: string
  title: string
  spec: string
  /** 订单金额（元），用于与卡包展示公式反推 */
  totalAmount: number
  packageAmount: number
  cardPackageIssued: boolean
  orderStatus: string
  createdAt: string
}
