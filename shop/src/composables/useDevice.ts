/**
 * @description 替代 @nuxtjs/device 的 useDevice：在模板中用 `device.isMobile`（与移动端组合式返回值对接）
 */
import { reactive } from 'vue'
import { useCustomDevice } from './useCustomDevice'

export function useDevice() {
  const { isMobile, isDesktop } = useCustomDevice()
  return reactive({ isMobile, isDesktop })
}
