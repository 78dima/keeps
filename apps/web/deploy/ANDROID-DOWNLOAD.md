# Android APK on the website

The sidebar (desktop and mobile) and login page download the signed release APK
without an account. `/download/android` is a non-cacheable temporary redirect to
the current versioned file. Versioned APKs support resumable downloads and are
served as attachments with the Android package MIME type.

`src/lib/android-release.json` records the verified APK version, size, SHA-256 and
GitHub Actions source run. The current release is **1.1.3+9**, run **40571187209**.
Use that exact APK; do not rebuild it under the same download filename.

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
