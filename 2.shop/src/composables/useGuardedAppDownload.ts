import { useRoute, useRouter } from 'vue-router'
import { useMallAuth } from './useMallAuth'
import {
  getPendingRegisterChannel,
  resolveChannelFromRouteQuery,
} from './useRegisterChannel'
import { notifyInfo, notifySuccess } from '../utils/epFeedback'

type IosGuideHandler = () => Promise<void> | void

export interface GuardedAppDownloadOptions {
  iosGuide?: IosGuideHandler
  successMessage?: string
  skipAuthSync?: boolean
}

function isAppleMobileBrowser() {
  if (typeof navigator === 'undefined') {
    return false
  }
  const ua = navigator.userAgent || ''
  return /iPhone|iPad|iPod/i.test(ua)
    || (navigator.platform === 'MacIntel' && Number(navigator.maxTouchPoints || 0) > 1)
}

function isAndroidBrowser() {
  return typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent || '')
}

function appDownloadUrl() {
  return String(import.meta.env.VITE_MALL_APP_APK_URL || '').trim()
}

export function useGuardedAppDownload() {
  const route = useRoute()
  const router = useRouter()
  const { isLoggedIn, syncFromStorage } = useMallAuth()

  async function openGuardedAppDownload(options: GuardedAppDownloadOptions = {}) {
    if (!options.skipAuthSync) {
      await syncFromStorage()
    }

    if (!isLoggedIn.value) {
      const channel = resolveChannelFromRouteQuery(route.query as Record<string, unknown>) || getPendingRegisterChannel()
      notifyInfo('请登录后下载APP')
      await router.push({
        path: '/login',
        query: {
          redirect: '/app-download',
          downloadAfterAuth: '1',
          ...(channel ? { channel } : {}),
        },
      })
      return
    }

    if (isAppleMobileBrowser()) {
      if (options.iosGuide) {
        await options.iosGuide()
      }
      else {
        notifyInfo('iPhone 请使用 Safari 添加到主屏幕')
      }
      return
    }

    const apkUrl = appDownloadUrl()
    if (!apkUrl) {
      notifyInfo(isAndroidBrowser() ? '暂未配置 APK 下载链接' : '请在安卓手机浏览器内下载 App')
      return
    }
    window.location.href = apkUrl
    if (options.successMessage) {
      notifySuccess(options.successMessage)
    }
  }

  return {
    openGuardedAppDownload,
  }
}
