# Liquid Glass web release

The approved material uses 23% note tint, 2px frost and SVG displacement scale 60.
The six background bubbles animate only transform/opacity, pause in hidden tabs,
and respect reduced motion. Small interactive controls use the same tint and
specular edges with a lightweight blur. SVG backdrop refraction depends on browser support; basic translucent blur
declarations are also supplied.

`src/app/liquid-glass.css` owns the material. `LiquidGlassScene` supplies one shared
SVG filter and the decorative background. `noteGlassStyle` converts the original
stored HEX color into a CSS variable without changing stored note data. Editors,
creation form, navigation, buttons, fields, links, color palettes, popovers, toasts
and auth screens share the material. Mouse/touch focus has no outline; Tab focus
uses a soft glow. Selected colors have checkmarks.

## Validation

- Local TypeScript and both existing sync/replication test suites passed.
- Isolated Chromium checks exercised real React components on desktop and mobile:
  loading six synthetic notes, editing and selecting a color, creating a note
  with a reminder, search, drawer, login, reduced motion, and exact 23/2/60 settings.
  Synthetic auth, HTTP and Realtime were intercepted in that browser; no test
  records were written to production. This validates UI integration, not live
  Supabase transport.
- GitHub Actions run `40718961101` passed web tests, type checking, production
  build and runtime-container smoke checks. Android jobs were skipped.
- Source: `41b1f875c705638636423964771b66ffc4d5bf85`.
- Artifact: `12828664746`, ZIP SHA-256
  `5ccd2fa21b86d3b37b810d3b0a41746e68612bfc265b4d69426f62b13b5e9b00`.
- Bundle SHA-256:
  `ca2b7d5501bc2531a186a6ec42dc9c2a75db435a1a5a101691f97809e24c166a`.

## Rollout

Deployed on 2026-10-28 at 15:50 UTC (23:50 Asia/Taipei).
The production bundle passed the same isolated UI flow through a private SSH
preview before switching. After switching, the public URL
`https://monokeep.cloudpub.ru` passed desktop/mobile login rendering, exact
23/2/60 material settings, no horizontal overflow, service-worker availability,
non-cacheable APK redirect, byte-range download and checksum-file checks. The
complete APK SHA-256 was verified directly on the server. The public browser
check waits for stylesheet loading, not just server-rendered HTML.


Backup before switching: `/var/backups/monokeep/20261028T154004Z`. The old image
`monokeep-web:6cfed151` is also retained as
`monokeep-web:rollback-20261028T154004Z`. The backup contains the image, source and
release files, Compose files, resolved configuration and release marker. Archive
checksums and readability were verified.

The new bundle is installed in `/var/www/monokeep-releases/41b1f875`, image
`monokeep-web:41b1f875`. Preserve the read-only downloads bind mount and existing
environment. No database migration is required. Android source and the signed
1.1.6+12 download remain unchanged.

Rollback: restore `docker-compose.override.yml` and `.monokeep-release.json` from
the backup, then run `docker compose up -d --no-build --no-deps web` in
`/var/www/notes`. The switch script also rolls back automatically if its runtime
checks fail.
