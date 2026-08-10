import { Capacitor } from '@capacitor/core'

export function isIosNativeApp(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios'
}
