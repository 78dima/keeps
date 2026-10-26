#!/usr/bin/env bash
set -euo pipefail
MONOKEEP_ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$MONOKEEP_ROOT"
MONOKEEP_BUILD_MODE="${MONOKEEP_BUILD_MODE:-release}"
if [[ "$MONOKEEP_BUILD_MODE" != release && "$MONOKEEP_BUILD_MODE" != debug ]]; then
  echo 'MONOKEEP_BUILD_MODE must be release or debug.' >&2
  exit 1
fi
# This app has a permanent signing identity. Never generate a replacement on a clean clone.
if [[ "$MONOKEEP_BUILD_MODE" == release && ! -f android/key.properties ]]; then
  echo 'Restore the permanent release keystore and android/key.properties from the private signing backup, or use the configured GitHub Actions release build.' >&2
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

# Keep a known test-key path across local and CI builds (AGP defaults vary by runner).
if [[ ! -f .toolchain/monokeep-debug.keystore ]]; then
  mkdir -p .toolchain
  (umask 077; keytool -genkeypair -noprompt -keystore .toolchain/monokeep-debug.keystore \
    -storetype JKS -storepass android -keypass android -alias androiddebugkey \
    -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=Android Debug, O=MonoKeep, C=US')
fi


flutter pub get
flutter analyze
flutter test
flutter build apk "--$MONOKEEP_BUILD_MODE"
python3 tools/verify_apk.py "build/app/outputs/flutter-apk/app-$MONOKEEP_BUILD_MODE.apk" "$MONOKEEP_BUILD_MODE"
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
