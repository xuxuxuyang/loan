import { Capacitor, registerPlugin } from '@capacitor/core'
import { isNativeMallContactsPlatform, type MallDeviceContact } from '~/utils/mallContacts'

interface MallContactsPlugin {
  getContacts: () => Promise<{ contacts?: MallDeviceContact[], count?: number }>
  openAppSettings: () => Promise<void>
}

const MallContacts = registerPlugin<MallContactsPlugin>('MallContacts')

export function isNativeContactsAvailable(): boolean {
  return Capacitor.isNativePlatform() && isNativeMallContactsPlatform(Capacitor.getPlatform())
}

export function isAndroidNativeContactsAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}

export async function readNativeDeviceContacts(): Promise<MallDeviceContact[]> {
  if (!isNativeContactsAvailable()) {
    throw new Error('当前环境不支持通讯录授权，请在手机 App 内继续')
  }
  const result = await MallContacts.getContacts()
  return Array.isArray(result.contacts) ? result.contacts : []
}

export async function openNativeAppSettings(): Promise<void> {
  if (!isNativeContactsAvailable()) {
    return
  }
  await MallContacts.openAppSettings()
}

export const readAndroidDeviceContacts = readNativeDeviceContacts
export const openAndroidAppSettings = openNativeAppSettings
