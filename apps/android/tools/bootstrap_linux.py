#!/usr/bin/env python3
"""Install a private build toolchain under .toolchain, on Linux x86_64."""
import hashlib
import json
import os
import pathlib
import platform
import subprocess
import tarfile
import urllib.error
import urllib.request
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
CACHE = ROOT / '.toolchain'
FLUTTER_VERSION = '3.32.8'
FLUTTER_MANIFEST_URL = 'https://storage.googleapis.com/flutter_infra_release/releases/releases_linux.json'


def open_url(url, timeout=45):
    try:
        return urllib.request.urlopen(url, timeout=timeout)
    except urllib.error.HTTPError as error:
        raise RuntimeError(f'HTTP {error.code} while downloading {url}') from error
    except urllib.error.URLError as error:
        raise RuntimeError(f'Cannot download {url}: {error.reason}') from error


def metadata(url):
    with open_url(url) as response:
        return json.load(response)


def download(url, name, checksum=None):
    target = CACHE / name
    if target.exists() and checksum and hashlib.sha256(target.read_bytes()).hexdigest() == checksum:
        return target
    print(f'Downloading {name}…', flush=True)
    temporary = target.with_suffix(target.suffix + '.part')
    digest = hashlib.sha256()
    with open_url(url, timeout=60) as response, temporary.open('wb') as output:
        while chunk := response.read(1024 * 1024):
            output.write(chunk)
            digest.update(chunk)
    if checksum and digest.hexdigest() != checksum:
        temporary.unlink()
        raise RuntimeError(f'Checksum mismatch: {name}')
    temporary.replace(target)
    return target


def main():
    if platform.system() != 'Linux' or platform.machine() != 'x86_64':
        raise SystemExit('Install Flutter 3.32.8, JDK 17 and Android SDK manually on this platform.')
    CACHE.mkdir(exist_ok=True)
    if not (CACHE / 'flutter/bin/flutter').exists():
        releases = metadata(FLUTTER_MANIFEST_URL)
        release = next((r for r in releases['releases'] if r['version'] == FLUTTER_VERSION and r['channel'] == 'stable' and r.get('dart_sdk_arch', 'x64') == 'x64'), None)
        if release is None:
            raise RuntimeError(f'Flutter {FLUTTER_VERSION} for Linux x64 is missing from {FLUTTER_MANIFEST_URL}')
        archive = download(f"{releases['base_url']}/{release['archive']}", 'flutter.tar.xz', release['sha256'])
        with tarfile.open(archive) as tar:
            tar.extractall(CACHE, filter='data')
        archive.unlink()
    if not (CACHE / 'jdk/bin/java').exists():
        releases = metadata('https://api.adoptium.net/v3/assets/latest/17/hotspot?architecture=x64&image_type=jdk&os=linux&vendor=eclipse')
        package = releases[0]['binary']['package']
        archive = download(package['link'], 'jdk.tar.gz', package['checksum'])
        with tarfile.open(archive) as tar:
            root_name = tar.getnames()[0].split('/')[0]
            tar.extractall(CACHE, filter='data')
        (CACHE / root_name).rename(CACHE / 'jdk')
        archive.unlink()
    sdk = CACHE / 'android-sdk'
    manager = sdk / 'cmdline-tools/latest/bin/sdkmanager'
    if not manager.exists():
        archive = download('https://dl.google.com/android/repository/commandlinetools-linux-13114758_latest.zip', 'android-commandline.zip')
        unpack = CACHE / 'android-unpack'
        with zipfile.ZipFile(archive) as source:
            source.extractall(unpack)
        manager.parent.parent.parent.mkdir(parents=True, exist_ok=True)
        (unpack / 'cmdline-tools').rename(sdk / 'cmdline-tools/latest')
        unpack.rmdir()
        for binary in manager.parent.iterdir():
            binary.chmod(0o755)
        archive.unlink()
    env = os.environ.copy()
    env['JAVA_HOME'] = str(CACHE / 'jdk')
    env['ANDROID_HOME'] = str(sdk)
    env['ANDROID_SDK_ROOT'] = str(sdk)
    env['PATH'] = f"{CACHE / 'jdk/bin'}:{env.get('PATH', '')}"
    # This script is the explicit installation entry point and accepts SDK package licenses.
    subprocess.run([str(manager), '--licenses'], input='y\n' * 100, text=True, env=env, check=True)
    subprocess.run([str(manager), 'platform-tools', 'platforms;android-35', 'build-tools;35.0.0', 'ndk;27.0.12077973', 'cmake;3.22.1'], env=env, check=True)
    print('Toolchain installed. Run ./tools/build_apk.sh')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        raise SystemExit(f'Toolchain setup failed: {error}')
