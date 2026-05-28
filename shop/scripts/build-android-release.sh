#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ANDROID_DIR="$ROOT/android"
KEYSTORE_PROPS="$ANDROID_DIR/keystore.properties"

if [ ! -f "$KEYSTORE_PROPS" ]; then
  echo "缺少 $KEYSTORE_PROPS"
  echo "请先执行: bash scripts/init-android-keystore.sh"
  exit 1
fi

if [ -z "${JAVA_HOME:-}" ]; then
  for candidate in \
    "/c/Program Files/Android/Android Studio/jbr" \
    "/c/Program Files/Java/jdk-21" \
    "/c/Program Files/Eclipse Adoptium/jdk-21"*
  do
    if [ -d "$candidate" ] && [ -x "$candidate/bin/java" ]; then
      export JAVA_HOME="$candidate"
      break
    fi
  done
fi

if [ -z "${JAVA_HOME:-}" ] || [ ! -x "$JAVA_HOME/bin/java" ]; then
  echo "未找到 Java，请设置 JAVA_HOME 或安装 Android Studio / JDK 17+"
  exit 1
fi

export PATH="$JAVA_HOME/bin:$PATH"

cd "$ANDROID_DIR"
./gradlew.bat assembleRelease

APK="$ANDROID_DIR/app/build/outputs/apk/release/app-release.apk"
if [ -f "$APK" ]; then
  echo ""
  echo "已签名 Release APK:"
  echo "  $APK"
  ls -lh "$APK"
else
  echo "构建完成，但未找到 app-release.apk，请检查 signing 配置"
  exit 1
fi
