export interface RegisterPayload {
  name: string
  phone: string
  idCardFront: string
  idCardBack: string
  locationText: string
  latitude: number
  longitude: number
}

const STORAGE_KEY = 'mall-register-profile'
const COOKIE_KEY = 'mall_registered'
const LOGIN_COOKIE_KEY = 'mall_login_phone'

export function useMallAuth() {
  const route = useRoute()
  const { smartNavigate } = useCustomRouting(route)

  const registerCookie = useCookie<string>(COOKIE_KEY, {
    maxAge: 60 * 60 * 24 * 365,
    default: () => '',
  })
  const loginCookie = useCookie<string>(LOGIN_COOKIE_KEY, {
    maxAge: 60 * 60 * 24 * 30,
    default: () => '',
  })

  const isRegistered = useState<boolean>('mall-is-registered', () => registerCookie.value === '1')
  const profile = useState<RegisterPayload | null>('mall-register-profile', () => null)
  const loginPhone = useState<string>('mall-login-phone', () => loginCookie.value || '')
  const isLoggedIn = computed(() => !!loginPhone.value)

  const syncFromStorage = () => {
    if (!import.meta.client) {
      return
    }

    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return
    }

    try {
      const parsed = JSON.parse(raw) as RegisterPayload
      profile.value = parsed
    }
    catch (error) {
      console.error('读取注册信息失败', error)
    }
  }

  const register = (payload: RegisterPayload) => {
    profile.value = payload
    isRegistered.value = true
    registerCookie.value = '1'

    if (import.meta.client) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
    }
  }

  const logout = () => {
    profile.value = null
    isRegistered.value = false
    loginPhone.value = ''
    registerCookie.value = ''
    loginCookie.value = ''

    if (import.meta.client) {
      localStorage.removeItem(STORAGE_KEY)
    }
  }

  const loginByPhone = (phone: string) => {
    loginPhone.value = phone
    loginCookie.value = phone
  }

  const ensureRegistered = async (redirectPath?: string) => {
    if (isRegistered.value) {
      return true
    }

    const redirect = redirectPath || route.fullPath || '/'
    await smartNavigate({
      path: '/register',
      query: { redirect },
    })
    return false
  }

  if (import.meta.client && !profile.value) {
    syncFromStorage()
  }

  return {
    isRegistered,
    isLoggedIn,
    profile,
    loginPhone,
    register,
    loginByPhone,
    logout,
    ensureRegistered,
    syncFromStorage,
  }
}
