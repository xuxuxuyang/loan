const SESSION_KEY = 'traffic_partner_session'

export interface TrafficPartnerSession {
  token: string
  username: string
  name: string
  partnerId: string
  loginAt: string
}

export function getTrafficPartnerSession(): TrafficPartnerSession | null {
  if (typeof localStorage === 'undefined') {
    return null
  }
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) {
      return null
    }
    const parsed = JSON.parse(raw) as TrafficPartnerSession
    if (!parsed?.token || !parsed?.partnerId) {
      return null
    }
    return parsed
  }
  catch {
    return null
  }
}

export function setTrafficPartnerSession(session: TrafficPartnerSession) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

export function clearTrafficPartnerSession() {
  localStorage.removeItem(SESSION_KEY)
}

export function isTrafficPartnerAuthenticated() {
  return Boolean(getTrafficPartnerSession()?.token)
}
