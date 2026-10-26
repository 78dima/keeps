"""Verify signatures and reject debuggable or unexpectedly signed release APKs."""
import os
from pathlib import Path
import re
import subprocess
import sys

apk = Path(sys.argv[1])
mode = sys.argv[2]
build_tools = Path(os.environ['ANDROID_SDK_ROOT']) / 'build-tools/35.0.0'
certificate = subprocess.check_output(
    [str(build_tools / 'apksigner'), 'verify', '--print-certs', str(apk)], text=True)
print(certificate, end='')
if mode == 'release':
    expected = Path('release-certificate.sha256').read_text().strip()
    actual = re.search(r'Signer #1 certificate SHA-256 digest: ([0-9a-f]+)', certificate)
    if not actual or actual.group(1) != expected:
        raise SystemExit('Release certificate does not match the saved permanent signing identity')
    manifest = subprocess.check_output(
        [str(build_tools / 'aapt'), 'dump', 'badging', str(apk)], text=True)
    if 'application-debuggable' in manifest:
        raise SystemExit('Release APK must not be debuggable')
    print('Release signature and non-debuggable manifest verified')
