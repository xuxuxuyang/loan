import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

function collectStyleSources(directoryUrl) {
  const files = []
  for (const entry of fs.readdirSync(directoryUrl, { withFileTypes: true })) {
    const childUrl = new URL(entry.isDirectory() ? `${entry.name}/` : entry.name, directoryUrl)
    if (entry.isDirectory()) {
      files.push(...collectStyleSources(childUrl))
    }
    else if (/\.(?:vue|css|scss)$/.test(entry.name)) {
      files.push(childUrl)
    }
  }
  return files
}

test('keeps every native iOS route below the status bar without double-insetting the PWA', () => {
  const capacitorConfig = fs.readFileSync(
    new URL('../capacitor.config.ts', import.meta.url),
    'utf8',
  )
  const mainSource = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  const globalStyles = fs.readFileSync(
    new URL('../src/assets/styles/main.scss', import.meta.url),
    'utf8',
  )
  const pwaSafeAreaPaths = [
    '../src/components/index/HomeBannerMobile.vue',
    '../src/components/list/MallListMobile.vue',
    '../src/components/my/MyCenterMobile.vue',
    '../src/components/search/MallSearchMobile.vue',
    '../src/views/MallProductDetailView.vue',
    '../src/views/MallCsChatView.vue',
    '../src/views/MallCsChatView.api.vue',
    '../src/views/MallPrivacyPolicyView.vue',
    '../src/views/MallUserAgreementView.vue',
  ]

  assert.match(capacitorConfig, /ios:\s*\{[^}]*contentInset:\s*['"]always['"]/s)
  assert.match(mainSource, /Capacitor\.getPlatform\(\)\s*===\s*['"]ios['"]/)
  assert.match(mainSource, /document\.documentElement\.classList\.add\(['"]capacitor-ios['"]\)/)
  assert.match(globalStyles, /--app-safe-area-top:\s*env\(safe-area-inset-top\)/)
  assert.match(globalStyles, /--app-safe-area-bottom:\s*env\(safe-area-inset-bottom\)/)
  assert.match(globalStyles, /html\.capacitor-ios[^{]*\{[^}]*--app-safe-area-top:\s*0px[^}]*--app-safe-area-bottom:\s*0px/s)

  for (const relativePath of pwaSafeAreaPaths) {
    const source = fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8')
    assert.match(
      source,
      /var\(--app-safe-area-top\)/,
      `${relativePath} must retain the safe area when used as a Safari PWA`,
    )
  }

  for (const fileUrl of collectStyleSources(new URL('../src/', import.meta.url))) {
    if (fileUrl.pathname.endsWith('/assets/styles/main.scss')) {
      continue
    }
    const source = fs.readFileSync(fileUrl, 'utf8')
    assert.doesNotMatch(
      source,
      /env\(safe-area-inset-(?:top|bottom)\)/,
      `${fileUrl.pathname} must use the shared safe-area variables`,
    )
  }
})
