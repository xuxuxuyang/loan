import { Capacitor } from '@capacitor/core'
import { CapacitorUpdater } from '@capgo/capacitor-updater'

/** OSS / CDN 上的 latest.json，与 scripts/build-ota-bundle.sh 产出格式一致 */
export interface OtaManifest {
  version: string
  url: string
  checksum?: string
  changelog?: string
}

function otaManifestUrl(): string {
  return String(import.meta.env.VITE_APP_OTA_MANIFEST_URL || '').trim()
}

function normalizeVersionLabel(raw: unknown): string {
  return String(raw ?? '').trim().toLowerCase()
}

/** 内置包（APK 自带 dist）视为低于任意远程版本 */
function shouldApplyRemoteVersion(current: string, remote: string): boolean {
  const cur = normalizeVersionLabel(current)
  const next = String(remote || '').trim()
  if (!next) {
    return false
  }
  if (cur === normalizeVersionLabel(next)) {
    return false
  }
  if (!cur || cur === 'builtin' || cur === 'built-in') {
    return true
  }
  return cur !== normalizeVersionLabel(next)
}

async function fetchOtaManifest(url: string): Promise<OtaManifest | null> {
  const res = await fetch(url, {
    method: 'GET',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) {
    return null
  }
  const data = await res.json() as Partial<OtaManifest>
  const version = String(data.version || '').trim()
  const bundleUrl = String(data.url || '').trim()
  if (!version || !bundleUrl) {
    return null
  }
  return {
    version,
    url: bundleUrl,
    checksum: data.checksum ? String(data.checksum).trim() : undefined,
    changelog: data.changelog ? String(data.changelog).trim() : undefined,
  }
}

/**
 * 原生 App 启动时检查 OTA 更新（Capgo manual 模式）。
 * 须先 notifyAppReady，再拉 manifest；有新版本则下载并 set（会 reload）。
 */
export async function runAppOtaCheck(): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    return
  }

  try {
    await CapacitorUpdater.notifyAppReady()
  }
  catch (err) {
    console.warn('[OTA] notifyAppReady failed', err)
  }

  const manifestUrl = otaManifestUrl()
  if (!manifestUrl) {
    return
  }

  try {
    const manifest = await fetchOtaManifest(manifestUrl)
    if (!manifest) {
      return
    }

    const current = await CapacitorUpdater.current()
    const currentVersion = String(current?.bundle?.version || 'builtin')
    if (!shouldApplyRemoteVersion(currentVersion, manifest.version)) {
      return
    }

    const bundle = await CapacitorUpdater.download({
      version: manifest.version,
      url: manifest.url,
      checksum: manifest.checksum,
    })
    await CapacitorUpdater.set(bundle)
  }
  catch (err) {
    console.warn('[OTA] update skipped', err)
  }
}
