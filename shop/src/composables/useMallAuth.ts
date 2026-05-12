import { clearPendingRegisterChannel, getPendingRegisterChannel, resolveChannelFromRouteQuery } from './useRegisterChannel'

export interface RegisterPayload {
  name: string
  phone: string
  /** 注册短信验证码，6 位；与 `POST /auth/register` 一致 */
  smsCode: string
  /** 可选；与 H5 `?channel=` 一致，须在后台流量管理中已配置 */
  channel?: string
  /** 二代身份证号；注册提交时必填，写入库供风控使用 */
  idNumber?: string
  idCardFront: string
  idCardBack: string
  /** 可选；未传时后端存空串 */
  idCardHandheld?: string
  locationText?: string
  latitude?: number
  longitude?: number
  /** 可选，至少 6 位；与后台 `POST /auth/register` 一致 */
  password?: string
}

const COOKIE_KEY = 'mall_registered'
const LOGIN_COOKIE_KEY = 'mall_login_phone'

interface MallUserProfile extends RegisterPayload {
  id: string
  /** 实名身份证号（若后端已存储则用于信誉初审） */
  idNumber?: string
  creditStatus?: '良好' | '待风控' | '风险'
  /** 授信额度（元）：可下单「商品总额」上限；注册默认见后端 `DEFAULT_USER_QUOTA` */
  quota?: number
  registerAt?: string
  orderCount?: number
  totalAmount?: number
  /** 为 true 时商城应禁止提交新订单（后台拉黑） */
  orderBlacklisted?: boolean
}

function resolveMallApiBase() {
  const runtimeConfig = useRuntimeConfig()
  return runtimeConfig.public.mallApiBase || '/api'
}

/** 登录账号一律按手机号字符串规范化（不再映射别名） */
export function normalizeMallAccount(account: unknown) {
  return typeof account === 'string'
    ? account.trim()
    : (typeof account === 'number' ? String(account) : '')
}

/** 解析注册接口等业务返回的 fail 文案（$fetch / ofetch 错误体） */
function readRegisterApiErrorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const o = err as { data?: { msg?: string }, message?: string }
    const fromBody = typeof o.data?.msg === 'string' ? o.data.msg.trim() : ''
    if (fromBody) {
      return fromBody
    }
    if (typeof o.message === 'string' && o.message.trim()) {
      return o.message.trim()
    }
  }
  return '注册失败，请稍后重试'
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
    if (import.meta.env.SSR || syncing.value) {
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

  const sendRegisterSms = async (phone: string) => {
    const normalizedPhone = normalizeMallAccount(phone)
    try {
      await $fetch<{ success: boolean }>(`${resolveMallApiBase()}/auth/register/sms/send`, {
        method: 'POST',
        body: { phone: normalizedPhone },
      })
    }
    catch (err: unknown) {
      throw new Error(readRegisterApiErrorMessage(err))
    }
  }

  const register = async (payload: RegisterPayload) => {
    const normalizedPayload = {
      ...payload,
      phone: normalizeMallAccount(payload.phone),
    }
    const pendingCh = getPendingRegisterChannel()
      || resolveChannelFromRouteQuery(route.query as Record<string, unknown>)
    if (pendingCh) {
      normalizedPayload.channel = pendingCh
    }
    try {
      const response = await $fetch<{ success: boolean, data: MallUserProfile }>(`${resolveMallApiBase()}/auth/register`, {
        method: 'POST',
        body: normalizedPayload,
      })
      profile.value = response.data
      registerCookie.value = '1'
      clearPendingRegisterChannel()
      /** 注册成功即视为已登录（与登录接口一致写入会话） */
      loginPhone.value = normalizedPayload.phone
      loginCookie.value = normalizedPayload.phone
      return response.data
    }
    catch (err: unknown) {
      const msg = readRegisterApiErrorMessage(err)
      throw new Error(msg)
    }
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

  const ensureRegistered = async (redirectPath?: string) => {
    await syncFromStorage()

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

  if (!import.meta.env.SSR && !profile.value) {
    void syncFromStorage()
  }

  return {
    isRegistered,
    isLoggedIn,
    profile,
    loginPhone,
    sendRegisterSms,
    register,
    loginByPhone,
    loginByPassword,
    logout,
    ensureRegistered,
    syncFromStorage,
  }
}
