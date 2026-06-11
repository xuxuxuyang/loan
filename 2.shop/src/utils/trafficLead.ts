export interface TrafficCreditLeadState {
  isLoggedIn: boolean
  hasRegisteredMarker: boolean
  routePath: string
  sessionShown: boolean
  channel?: string
}

const AUTH_ROUTE_PATHS = new Set(['/login', '/register'])
const TRAFFIC_CREDIT_LEAD_HOME_PATH = '/'
export const TRAFFIC_CREDIT_LEAD_SESSION_KEY = 'mall_traffic_credit_lead_shown'

export function createTrafficCreditLeadSessionKey() {
  return TRAFFIC_CREDIT_LEAD_SESSION_KEY
}

export function isAuthRouteForTrafficLead(routePath: string) {
  const normalized = routePath.split('?')[0]?.replace(/\/$/, '') || '/'
  return AUTH_ROUTE_PATHS.has(normalized)
}

export function isHomeRouteForTrafficLead(routePath: string) {
  const normalized = routePath.split('?')[0]?.replace(/\/$/, '') || '/'
  return normalized === TRAFFIC_CREDIT_LEAD_HOME_PATH
}

export function shouldShowTrafficCreditLead(state: TrafficCreditLeadState) {
  if (state.isLoggedIn || state.hasRegisteredMarker || state.sessionShown) {
    return false
  }
  if (!isHomeRouteForTrafficLead(state.routePath)) {
    return false
  }
  if (isAuthRouteForTrafficLead(state.routePath)) {
    return false
  }
  return true
}
