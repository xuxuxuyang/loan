import { resolveMallOrderEligibilityPolicyFromEnv } from '~/utils/orderEligibility'

export const MALL_ORDER_ELIGIBILITY_POLICY = resolveMallOrderEligibilityPolicyFromEnv(import.meta.env)
