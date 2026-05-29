#!/usr/bin/env bash
# 构建 H5 OTA 热更新包：dist → zip + latest.json（上传 OSS 后 App 自动拉取，无需重打 APK）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

npm run build

VERSION="${OTA_VERSION:-$(node -p "require('./package.json').version")}"
OTA_BASE_URL="${OTA_BASE_URL:-https://gaoxiaofuwupingtai.oss-cn-hangzhou.aliyuncs.com/app-ota}"
OUT_DIR="$ROOT/ota-out"
ZIP_NAME="wenshuo-mall-${VERSION}.zip"
ZIP_PATH="$OUT_DIR/$ZIP_NAME"

mkdir -p "$OUT_DIR"
rm -f "$ZIP_PATH"

zip_dist() {
  if command -v zip >/dev/null 2>&1; then
    (cd dist && zip -r -q "../$ZIP_PATH" .)
    return
  fi
  if [ -n "${MSYSTEM:-}" ] || [ "${OS:-}" = "Windows_NT" ]; then
    powershell -NoProfile -Command "Set-Location dist; Compress-Archive -Path '*' -DestinationPath '../${ZIP_PATH#$ROOT/}' -Force"
    return
  fi
  echo "请安装 zip，或在 Windows 下使用 Git Bash / PowerShell 运行"
  exit 1
}

zip_dist

export OTA_VERSION="$VERSION"
export OTA_BASE_URL
export OTA_ZIP_NAME="$ZIP_NAME"
export OTA_ZIP_PATH="$ZIP_PATH"
export OTA_MANIFEST_PATH="$OUT_DIR/latest.json"

node <<'NODE'
const crypto = require('crypto')
const fs = require('fs')

const version = process.env.OTA_VERSION
const baseUrl = process.env.OTA_BASE_URL.replace(/\/$/, '')
const zipName = process.env.OTA_ZIP_NAME
const zipPath = process.env.OTA_ZIP_PATH
const manifestPath = process.env.OTA_MANIFEST_PATH

const buf = fs.readFileSync(zipPath)
const checksum = crypto.createHash('sha256').update(buf).digest('hex')
const manifest = {
  version,
  url: `${baseUrl}/${zipName}`,
  checksum,
}
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

console.log('')
console.log('OTA 包已生成：')
console.log(`  ${zipPath}`)
console.log(`  ${manifestPath}`)
console.log('')
console.log('请上传到 OSS 目录 app-ota/（覆盖 latest.json 与同版本 zip）：')
console.log(`  ${manifest.url}`)
console.log(`  ${baseUrl}/latest.json`)
NODE

ls -lh "$ZIP_PATH" 2>/dev/null || true
