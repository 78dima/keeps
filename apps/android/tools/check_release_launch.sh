#!/usr/bin/env bash
# Runs only on the disposable CI emulator, after the debug integration suite.
set -euo pipefail
MONOKEEP_ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
MONOKEEP_APK="$MONOKEEP_ROOT/dist/monokeep-release.apk"
if [[ ! -f "$MONOKEEP_APK" ]]; then exit 0; fi
if adb shell pm path com.monokeep.app | tr -d '\r' | grep -q '^package:'; then
  adb uninstall com.monokeep.app
fi
adb install "$MONOKEEP_APK"
adb logcat -b crash -c
adb shell am start -W -n com.monokeep.app/.MainActivity
sleep 10
adb shell pidof com.monokeep.app
adb exec-out screencap -p > "$MONOKEEP_ROOT/dist/release-home.png"
python3 "$MONOKEEP_ROOT/tools/check_release_form.py"
adb logcat -d -b crash > "$MONOKEEP_ROOT/dist/release-crash.log"
test ! -s "$MONOKEEP_ROOT/dist/release-crash.log"
