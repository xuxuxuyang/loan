/**
 * 商城业务接口相关类型（请求走 `mallApiBase`，实现见 `composables/useMallMy.ts`）。
 */
export interface MallCardPackageDTO {
  orderId: string
  title: string
  spec: string
  packageAmount: number
  cardPackageIssued: boolean
  orderStatus: string
  createdAt: string
}
