#!/usr/bin/env bash
# Build H5 OTA bundle: dist -> zip + latest.json.
# Production upload URL is read from .env.production (VITE_APP_OTA_BASE_URL),
# so the OSS bucket/path is maintained with the rest of production config.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

npm run build

read_env_value() {
  node - "$1" <<'NODE'
const fs = require('fs')

const key = process.argv[2]
const file = '.env.production'
if (!fs.existsSync(file)) {
  process.exit(0)
}
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
for (const line of lines) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) continue
  const eq = trimmed.indexOf('=')
  if (eq === -1) continue
  if (trimmed.slice(0, eq).trim() !== key) continue
  let value = trimmed.slice(eq + 1).trim()
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1)
  }
  process.stdout.write(value)
  break
}
NODE
}

VERSION="${OTA_VERSION:-$(node -p "require('./package.json').version")}"
ENV_OTA_BASE_URL="$(read_env_value VITE_APP_OTA_BASE_URL)"
ENV_OTA_MANIFEST_URL="$(read_env_value VITE_APP_OTA_MANIFEST_URL)"
if [ -z "$ENV_OTA_BASE_URL" ] && [ -n "$ENV_OTA_MANIFEST_URL" ]; then
  ENV_OTA_BASE_URL="${ENV_OTA_MANIFEST_URL%/*}"
fi
OTA_BASE_URL="${OTA_BASE_URL:-$ENV_OTA_BASE_URL}"
if [ -z "$OTA_BASE_URL" ]; then
  echo "Missing OTA base URL. Set VITE_APP_OTA_BASE_URL in .env.production or export OTA_BASE_URL."
  exit 1
fi
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
  echo "Please install zip, or run this script with Git Bash / PowerShell on Windows."
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
console.log('OTA bundle generated:')
console.log(`  ${zipPath}`)
console.log(`  ${manifestPath}`)
console.log('')
console.log('Upload latest.json and the versioned zip to the configured OTA directory:')
console.log(`  ${manifest.url}`)
console.log(`  ${baseUrl}/latest.json`)
NODE

ls -lh "$ZIP_PATH" 2>/dev/null || true
