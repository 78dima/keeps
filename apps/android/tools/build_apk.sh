#!/usr/bin/env bash
set -euo pipefail
MONOKEEP_ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$MONOKEEP_ROOT"
MONOKEEP_BUILD_MODE="${MONOKEEP_BUILD_MODE:-release}"
if [[ "$MONOKEEP_BUILD_MODE" != release && "$MONOKEEP_BUILD_MODE" != debug ]]; then
  echo 'MONOKEEP_BUILD_MODE must be release or debug.' >&2
  exit 1
fi
if [[ -d .toolchain/flutter/bin ]]; then export PATH="$MONOKEEP_ROOT/.toolchain/flutter/bin:$PATH"; fi
if [[ -d .toolchain/jdk ]]; then export JAVA_HOME="$MONOKEEP_ROOT/.toolchain/jdk"; export PATH="$JAVA_HOME/bin:$PATH"; fi
if [[ -d .toolchain/android-sdk ]]; then export ANDROID_HOME="$MONOKEEP_ROOT/.toolchain/android-sdk"; fi
export ANDROID_SDK_ROOT="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
for MONOKEEP_TOOL in flutter java keytool python3; do
  if ! command -v "$MONOKEEP_TOOL" >/dev/null; then
    echo "Missing $MONOKEEP_TOOL. Run python3 tools/bootstrap_linux.py (requires internet)." >&2
    exit 1
  fi
done
if [[ ! -d "$ANDROID_SDK_ROOT/platforms/android-35" ]]; then
  echo 'Android SDK 35 missing. Set ANDROID_HOME or run python3 tools/bootstrap_linux.py.' >&2
  exit 1
fi
python3 tools/prepare.py
chmod +x android/gradlew

# The key persists across builds so APK updates preserve the installed app and its notes.
if [[ "$MONOKEEP_BUILD_MODE" == release && ! -f android/key.properties ]]; then
  umask 077
  mkdir -p .toolchain
  if [[ -f .toolchain/monokeep-release.jks ]]; then
    echo 'Existing release key found without key.properties. Restore its configuration; refusing to overwrite it.' >&2
    exit 1
  fi
  MONOKEEP_SIGN_PASSWORD=$(python3 -c 'import secrets; print(secrets.token_hex(32))')
  export MONOKEEP_SIGN_PASSWORD
  keytool -genkeypair -noprompt -keystore .toolchain/monokeep-release.jks -storetype JKS \
    -alias monokeep -keyalg RSA -keysize 3072 -validity 10000 \
    -storepass:env MONOKEEP_SIGN_PASSWORD -keypass:env MONOKEEP_SIGN_PASSWORD \
    -dname 'CN=MonoKeep, OU=Android, O=MonoKeep'
  python3 - <<'PY'
import os, pathlib
password = os.environ['MONOKEEP_SIGN_PASSWORD']
pathlib.Path('android/key.properties').write_text(
    f'storeFile=../.toolchain/monokeep-release.jks\nkeyAlias=monokeep\nstorePassword={password}\nkeyPassword={password}\n'
)
PY
  unset MONOKEEP_SIGN_PASSWORD
fi

flutter pub get
flutter analyze
flutter test
flutter build apk "--$MONOKEEP_BUILD_MODE"
"$ANDROID_SDK_ROOT/build-tools/35.0.0/apksigner" verify "build/app/outputs/flutter-apk/app-$MONOKEEP_BUILD_MODE.apk"
mkdir -p dist
cp "build/app/outputs/flutter-apk/app-$MONOKEEP_BUILD_MODE.apk" "dist/monokeep-$MONOKEEP_BUILD_MODE.apk"
export MONOKEEP_BUILD_MODE
python3 - <<'PY'
import hashlib, os, pathlib
path = pathlib.Path(f"dist/monokeep-{os.environ['MONOKEEP_BUILD_MODE']}.apk")
digest = hashlib.sha256(path.read_bytes()).hexdigest()
path.with_suffix('.apk.sha256').write_text(f'{digest}  {path.name}\n')
print(f'APK: {path.resolve()} ({path.stat().st_size / 1024 / 1024:.1f} MB)')
PY
