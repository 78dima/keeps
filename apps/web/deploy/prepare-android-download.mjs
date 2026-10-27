// Keep release binaries outside Git and verify them before publishing.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const release = JSON.parse(fs.readFileSync(new URL('../src/lib/android-release.json', import.meta.url), 'utf8'));
const [apkPath, outputPath = 'dist/android-downloads'] = process.argv.slice(2);
if (!apkPath) throw new Error('Usage: node apps/web/deploy/prepare-android-download.mjs <release.apk> [output-directory]');
const apk = fs.readFileSync(apkPath);
const sha256 = createHash('sha256').update(apk).digest('hex');
if (apk.length !== release.sizeBytes || sha256 !== release.sha256) {
    throw new Error('APK does not match the verified release in android-release.json');
}
fs.mkdirSync(outputPath, { recursive: true });
const destination = path.join(outputPath, release.fileName);
fs.writeFileSync(`${destination}.tmp`, apk, { mode: 0o644 });
fs.renameSync(`${destination}.tmp`, destination);
fs.writeFileSync(`${destination}.sha256`, `${sha256}  ${release.fileName}\n`);
console.log(`Verified Android ${release.version}+${release.versionCode}: ${destination}`);
