# Android APK on the website

The sidebar (desktop and mobile) and login page download the signed release APK
without an account. `/download/android` is a non-cacheable temporary redirect to
the current versioned file. Versioned APKs support resumable downloads and are
served as attachments with the Android package MIME type.

`src/lib/android-release.json` records the verified APK version, size, SHA-256 and
GitHub Actions source run. The current release is **1.1.5+11**, run **40668131175**.
Use that exact APK; do not rebuild it under the same download filename.

## Deployed version

Deployed on 2026-10-28 at 18:13 Asia/Taipei (2026-10-28 10:13 UTC):

- Web revision `3d3c13c5b6109bf52b7493bfc0396b318526654e`, image
  `monokeep-web:3d3c13c5`, successful web job in Actions run `40669683402`.
- Bundle SHA-256: `c64e7f6001980b1eddcc901732517671ba4902620e75610fa1584853fc1af662`.
- Persistent public files: `/var/www/monokeep-downloads`, mounted read-only at
  `/app/apps/web/public/downloads` in the permanent Compose override. Earlier
  APKs (1.1.3+9, 1.1.4+10) are retained there.
- Verified backup of the previous image, source, release and Compose settings:
  `/var/backups/monokeep/20261028T100930Z`. Previous image: `monokeep-web:8f2f4e66`,
  also tagged `monokeep-web:rollback-20261028T100930Z`.
- The resolved Compose configuration changed only the web service's image, build
  context and revision label; environment and download mount were retained.
- Preview and public-site checks covered the complete APK checksum, download MIME
  and attachment headers, a non-cacheable 307 redirect and byte ranges (206).
  Public `/login` and `/sw.js` returned 200. Database migrations were not required.

## Publish or update

1. Download the signed APK from a successful, verified release run. Update
   `src/lib/android-release.json` for a new release; always use a new filename.
2. Prepare the public files (the script rejects a different size or SHA-256):

   ```sh
   node apps/web/deploy/prepare-android-download.mjs path/to/monokeep-release.apk
   ```

3. Upload the contents of `dist/android-downloads/` to the server's persistent
   download directory. Publish APKs atomically and retain earlier versioned files.
   This directory must contain only public APKs and checksums, never credentials.
4. Add this read-only volume to the deployed Compose `web` service, replacing the
   source with the persistent directory's absolute path:

   ```yaml
   volumes:
     - /path/to/android-downloads:/app/apps/web/public/downloads:ro
   ```

   Files must be present before the container starts because Next.js discovers
   public files at startup. Keep this mount in the permanent deployment override.
5. Build the web bundle with `node apps/web/deploy/build-bundle.mjs`. Back up the
   current image and Compose configuration; test the new image with the download
   volume on a private preview port before switching the web service.
6. Check `/login`, `/sw.js`, `/download/android`, the APK and `.sha256` over the
   public URL. Download the complete file and verify SHA-256. Verify byte ranges
   return HTTP 206 for resuming interrupted downloads.

The APK is deliberately absent from Git and the web bundle. Future deployments
must preserve the volume. Rolling back this web change only requires restoring
the previous image and Compose override; it does not change the database.
