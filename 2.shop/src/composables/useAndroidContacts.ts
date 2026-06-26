import { Capacitor, registerPlugin } from '@capacitor/core'
import type { MallDeviceContact } from '~/utils/mallContacts'

interface MallContactsPlugin {
  getContacts: () => Promise<{ contacts?: MallDeviceContact[], count?: number }>
  openAppSettings: () => Promise<void>
}

const MallContacts = registerPlugin<MallContactsPlugin>('MallContacts')

export function isAndroidNativeContactsAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}

export async function readAndroidDeviceContacts(): Promise<MallDeviceContact[]> {
  if (!isAndroidNativeContactsAvailable()) {
    throw new Error('当前环境不支持通讯录授权，请在安卓 App 内继续')
  }
  const result = await MallContacts.getContacts()
  return Array.isArray(result.contacts) ? result.contacts : []
}

export async function openAndroidAppSettings(): Promise<void> {
  if (!isAndroidNativeContactsAvailable()) {
    return
  }
  await MallContacts.openAppSettings()
}
