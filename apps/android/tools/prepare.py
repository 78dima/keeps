#!/usr/bin/env python3
"""Fetch the original font families and Gradle wrapper. No global installation."""
import hashlib
import pathlib
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]


def download(url, path, checksum=None):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and (checksum is None or hashlib.sha256(path.read_bytes()).hexdigest() == checksum):
        return
    print(f"Downloading {path.name}", flush=True)
    with urllib.request.urlopen(url, timeout=45) as response:
        data = response.read()
    if checksum is not None and hashlib.sha256(data).hexdigest() != checksum:
        raise RuntimeError(f"Checksum mismatch: {path.name}")
    temporary = path.with_suffix(path.suffix + '.part')
    temporary.write_bytes(data)
    temporary.replace(path)


def main():
    fonts = ROOT / 'assets/fonts'
    # Upstream revisions recorded by the Google Fonts family metadata.
    dm = 'https://raw.githubusercontent.com/googlefonts/dm-fonts/d0520ba03bd780f5dccb3024854463d44f699b78/Sans/'
    outfit = 'https://raw.githubusercontent.com/Outfitio/Outfit-Fonts/902773808eb372f70fb34e8946dd1ffe604efc79/'
    download(dm + 'fonts/variable/DMSans%5Bopsz,wght%5D.ttf', fonts / 'DMSans.ttf')
    download(dm + 'OFL.txt', fonts / 'DMSans-OFL.txt')
    download(outfit + 'fonts/variable/Outfit%5Bwght%5D.ttf', fonts / 'Outfit.ttf')
    download(outfit + 'OFL.txt', fonts / 'Outfit-OFL.txt')
    wrapper = ROOT / 'android/gradle/wrapper/gradle-wrapper.jar'
    if not wrapper.exists():
        with urllib.request.urlopen('https://services.gradle.org/distributions/gradle-8.11.1-wrapper.jar.sha256', timeout=45) as response:
            checksum = response.read().decode().strip().split()[0]
        download('https://raw.githubusercontent.com/gradle/gradle/v8.11.1/gradle/wrapper/gradle-wrapper.jar', wrapper, checksum)
    print('Fonts and Gradle wrapper ready.')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        raise SystemExit(f'Preparation failed: {error}. Internet access is required for the first build.')
