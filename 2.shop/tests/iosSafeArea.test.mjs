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
  const safeAreaScreenPaths = [
    '../src/components/index/HomeBannerMobile.vue',
    '../src/components/list/MallListMobile.vue',
    '../src/components/my/MyCenterMobile.vue',
    '../src/components/search/MallSearchMobile.vue',
    '../src/views/MallLoginView.vue',
    '../src/views/MallRegisterView.vue',
    '../src/views/MallOrdersView.vue',
    '../src/views/MallBankCardView.vue',
    '../src/views/MallBillView.vue',
    '../src/views/MallBillRiskResultView.vue',
    '../src/views/MallAddressView.vue',
    '../src/views/MallCardPackageView.vue',
    '../src/views/MallOrderCreateView.vue',
    '../src/views/MallAppDownloadView.vue',
    '../src/views/MallProductDetailView.vue',
    '../src/views/MallCsChatView.vue',
    '../src/views/MallCsChatView.api.vue',
    '../src/views/MallPrivacyPolicyView.vue',
    '../src/views/MallUserAgreementView.vue',
  ]

  assert.doesNotMatch(capacitorConfig, /contentInset:\s*['"]always['"]/)
  assert.doesNotMatch(mainSource, /capacitor-ios/)
  assert.match(globalStyles, /--app-safe-area-top:\s*env\(safe-area-inset-top\)/)
  assert.match(globalStyles, /--app-safe-area-bottom:\s*env\(safe-area-inset-bottom\)/)

  for (const relativePath of safeAreaScreenPaths) {
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
