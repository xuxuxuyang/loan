#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ANDROID_DIR="$ROOT/android"
KEYSTORE_DIR="$ANDROID_DIR/keystore"
KEYSTORE_FILE="$KEYSTORE_DIR/wenshuo-mall.jks"
KEYSTORE_PROPS="$ANDROID_DIR/keystore.properties"

if [ -f "$KEYSTORE_FILE" ] && [ -f "$KEYSTORE_PROPS" ]; then
  echo "keystore 已存在，跳过生成:"
  echo "  $KEYSTORE_FILE"
  exit 0
fi

if [ -z "${JAVA_HOME:-}" ]; then
  for candidate in \
    "/c/Program Files/Android/Android Studio/jbr" \
    "/c/Program Files/Java/jdk-21" \
    "/c/Program Files/Eclipse Adoptium/jdk-21"*
  do
    if [ -d "$candidate" ] && [ -x "$candidate/bin/keytool" ]; then
      export JAVA_HOME="$candidate"
      break
    fi
  done
fi

if [ -z "${JAVA_HOME:-}" ] || [ ! -x "$JAVA_HOME/bin/keytool" ]; then
  echo "未找到 keytool，请设置 JAVA_HOME 或安装 Android Studio / JDK 17+"
  exit 1
fi

mkdir -p "$KEYSTORE_DIR"

STORE_PASS="${ANDROID_KEYSTORE_PASSWORD:-WenshuoMall2026!}"
KEY_PASS="${ANDROID_KEY_PASSWORD:-$STORE_PASS}"

"$JAVA_HOME/bin/keytool" -genkeypair -v -storetype PKCS12 \
  -keystore "$KEYSTORE_FILE" \
  -alias wenshuo \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass "$STORE_PASS" -keypass "$KEY_PASS" \
  -dname "CN=Wenshuo Mall, OU=Mobile, O=Wenshuo, L=Hangzhou, ST=ZJ, C=CN"

cat > "$KEYSTORE_PROPS" <<EOF
storeFile=keystore/wenshuo-mall.jks
keyAlias=wenshuo
storePassword=$STORE_PASS
keyPassword=$KEY_PASS
EOF

echo ""
echo "已生成签名材料（已 gitignore，请自行备份）："
echo "  $KEYSTORE_FILE"
echo "  $KEYSTORE_PROPS"
echo ""
echo "默认密码: $STORE_PASS"
echo "可通过环境变量 ANDROID_KEYSTORE_PASSWORD / ANDROID_KEY_PASSWORD 自定义。"
