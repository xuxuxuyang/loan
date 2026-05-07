export interface RegisterPayload {
  name: string
  phone: string
  idCardFront: string
  idCardBack: string
  idCardHandheld: string
  locationText: string
  latitude: number
  longitude: number
  /** 可选，至少 6 位；与后台 `POST /auth/register` 一致 */
  password?: string
}

const COOKIE_KEY = 'mall_registered'
const LOGIN_COOKIE_KEY = 'mall_login_phone'
export const ADMIN_TEST_ACCOUNT_ALIAS = 'admin'
export const ADMIN_TEST_PHONE = '19900000000'
export const ADMIN_TEST_VERIFY_CODE = '1234'
/** 与 API `ADMIN_TEST_MALL_PASSWORD` / Mock 种子一致，供密码登录演示 */
export const ADMIN_TEST_MALL_PASSWORD = '123456'

interface MallUserProfile extends RegisterPayload {
  id: string
  creditStatus?: '优秀' | '良好' | '一般' | '风险'
  registerAt?: string
  orderCount?: number
  totalAmount?: number
}

function resolveMallApiBase() {
  const runtimeConfig = useRuntimeConfig()
  return runtimeConfig.public.mallApiBase || 'http://localhost:3110/api'
}

export function normalizeMallAccount(account: unknown) {
  const value = typeof account === 'string'
    ? account.trim()
    : (typeof account === 'number' ? String(account) : '')
  return value === ADMIN_TEST_ACCOUNT_ALIAS ? ADMIN_TEST_PHONE : value
}

export function isAdminTestAccount(account: string) {
  return normalizeMallAccount(account) === ADMIN_TEST_PHONE
}

function createAdminTestProfile(): RegisterPayload {
  return {
    name: '商城管理员',
    phone: ADMIN_TEST_PHONE,
    idCardFront: 'mock://admin/id-card-front',
    idCardBack: 'mock://admin/id-card-back',
    idCardHandheld: 'mock://admin/id-card-handheld',
    locationText: '广东省广州市天河区珠江新城（测试定位）',
    latitude: 23.119751,
    longitude: 113.327676,
  }
}

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

  const profile = useState<MallUserProfile | null>('mall-register-profile', () => null)
  const loginPhone = useState<string>('mall-login-phone', () => normalizeMallAccount(loginCookie.value || ''))
  const syncing = useState<boolean>('mall-auth-syncing', () => false)
  const isRegistered = computed(() => !!profile.value)
  const isLoggedIn = computed(() => !!loginPhone.value)

  const syncFromStorage = async () => {
    if (!import.meta.client || syncing.value) {
      return
    }
    const phone = normalizeMallAccount(loginPhone.value || loginCookie.value || '')
    if (!phone) {
      return
    }

    syncing.value = true
    try {
      const response = await $fetch<{ success: boolean, data: MallUserProfile | null }>(`${resolveMallApiBase()}/users/by-phone`, {
        method: 'GET',
        query: { phone },
      })
      profile.value = response?.data || null
      if (profile.value) {
        registerCookie.value = '1'
      }
    }
    catch (error) {
      console.error('读取用户信息失败', error)
    }
    finally {
      syncing.value = false
    }
  }

  const register = async (payload: RegisterPayload) => {
    const normalizedPayload = {
      ...payload,
      phone: normalizeMallAccount(payload.phone),
    }
    const response = await $fetch<{ success: boolean, data: MallUserProfile }>(`${resolveMallApiBase()}/auth/register`, {
      method: 'POST',
      body: normalizedPayload,
    })
    profile.value = response.data
    registerCookie.value = '1'
    return response.data
  }

  const logout = () => {
    profile.value = null
    loginPhone.value = ''
    registerCookie.value = ''
    loginCookie.value = ''
  }

  const loginByPhone = async (phone: string, verifyCode: string) => {
    const normalizedPhone = normalizeMallAccount(phone)
    const response = await $fetch<{ success: boolean, data: { token: string, user: MallUserProfile } }>(`${resolveMallApiBase()}/auth/login`, {
      method: 'POST',
      body: {
        phone: normalizedPhone,
        verifyCode,
      },
    })
    loginPhone.value = normalizedPhone
    loginCookie.value = normalizedPhone
    profile.value = response.data.user
    registerCookie.value = '1'
    return response.data.user
  }

  const loginByPassword = async (phone: string, password: string) => {
    const normalizedPhone = normalizeMallAccount(phone)
    const response = await $fetch<{ success: boolean, data: { token: string, user: MallUserProfile } }>(`${resolveMallApiBase()}/auth/login`, {
      method: 'POST',
      body: {
        phone: normalizedPhone,
        loginType: 'password',
        password,
      },
    })
    loginPhone.value = normalizedPhone
    loginCookie.value = normalizedPhone
    profile.value = response.data.user
    registerCookie.value = '1'
    return response.data.user
  }

  const ensureAdminTestAccountReady = async () => {
    if (profile.value?.phone === ADMIN_TEST_PHONE && isRegistered.value) {
      return
    }
    await register(createAdminTestProfile())
  }

  const ensureRegistered = async (redirectPath?: string) => {
    await syncFromStorage()

    if (isAdminTestAccount(loginPhone.value)) {
      await ensureAdminTestAccountReady()
    }

    if (isRegistered.value && isLoggedIn.value) {
      return true
    }

    const redirect = redirectPath || route.fullPath || '/'
    await smartNavigate({
      path: '/login',
      query: { redirect },
    })
    return false
  }

  if (import.meta.client && !profile.value) {
    void syncFromStorage()
  }

  return {
    isRegistered,
    isLoggedIn,
    profile,
    loginPhone,
    register,
    loginByPhone,
    loginByPassword,
    logout,
    ensureRegistered,
    ensureAdminTestAccountReady,
    syncFromStorage,
  }
}
