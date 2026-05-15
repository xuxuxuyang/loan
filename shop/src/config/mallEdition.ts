/**
 * 商城「仅直付 / 仅商城货架」版本开关。
 * 为 true 时：隐藏先享后付入口与列表、不拉取 installment 商品、下单走 payType `full`（直接支付）。
 * 恢复先享后付时改为 false 即可（原 BNPL 逻辑保留在代码中，由分支与 v-if 控制）。
 */
export const MALL_EDITION_SHOP_DIRECT_ONLY = true
