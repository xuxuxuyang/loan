/**
 * 历史全局开关：曾用于整站仅直付。现下单分流以商品 `salesMode` 为准（见 order/create.vue）：
 * - `installment` → 先享后付提交订单
 * - `mall` → 商城专区提交后拉起收银台
 * 保留常量供环境级兜底；默认 false，勿再全局强制直付。
 */
export const MALL_EDITION_SHOP_DIRECT_ONLY = false
