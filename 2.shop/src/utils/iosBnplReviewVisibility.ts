import { isIosNativeApp } from '~/utils/iosNativePlatform'

/** App Store 审核期仅隐藏原生 iOS 的先享后付能力；H5 与 Android 保持原状。 */
export function isIosBnplReviewHidden(): boolean {
  return isIosNativeApp()
}
