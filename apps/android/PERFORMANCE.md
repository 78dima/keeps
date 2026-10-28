# Android rendering and refresh rate

Release 1.1.4+10 keeps the existing note order, filters, colors and reminder UI.

- The single-column note feed uses a lazy SliverList with repaint boundaries.
  It builds cards around the viewport instead of creating the entire collection.
  The pinned-notes drawer is lazy too.
- Wide layouts retain the website's balanced, top-to-bottom column order.
  Balancing now stops at subpixel precision; a single column skips the search.
- Native change events are debounced for 120 ms. Reads are serialized with one
  trailing refresh when another change arrives during an outstanding read.
  Identical snapshots cause no screen rebuild. Unchanged notes retain their
  object identity and their recent card widgets (bounded cache: 128 entries).
- Snapshot equality includes every stored field, including reminder delivery
  flags that may change without updatedAt. This optimization never changes sync
  timestamps or conflict resolution.
- LayoutBuilder runs outside the viewport, so scrolling does not recreate list
  delegates or enumerate all note IDs for every frame.
- The header uses the same translucent fill without a blur of its uniform
  background. The drawer retains its blur.
- DisplayRefreshController requests the highest advertised refresh rate at the
  current resolution while the activity is resumed. Android 11+ receives a
  Surface frame-rate vote; Android 12+ requests seamless switches only. Older
  Android uses the matching display mode. Pause and power saver clear the vote;
  display changes and surface recreation reapply it. The OS controls the final
  rate, including user settings, thermal limits and vendor policies.

## Verification

`flutter analyze`, `flutter test` and `python3 tools/test_schema.py` pass locally.
The added widget regressions cover a 1000-note collection (fewer than 15 mounted
cards both before and after scrolling; last note opens), 20 native events folded
into one read, unchanged-widget reuse, reminder status changes with unchanged
updatedAt, in-flight updates and teardown with a pending event.

Android instrumentation checks that the foreground vote matches the highest
same-resolution mode (or zero in power saver), clears on pause, and resumes
without crashing. The ordinary SQLite/reminder and integration suites and the
actual signed release launch also run in GitHub Actions.

These are correctness and bounded-work checks, not a physical-device FPS result.
The CI emulator does not demonstrate 120 Hz on a user's phone. To confirm that:

1. Use the signed release, disable power saver and select the desired refresh
   setting for MonoKeep in the phone's display settings if such a setting exists.
2. Android's "Show refresh rate" overlay checks the display mode. It does not
   count frames actually rendered by Flutter.
3. Capture the installed release in Perfetto (FrameTimeline on Android 12+) while
   scrolling, opening the drawer and receiving sync changes. Check presentation
   intervals and missed frames; a 120 Hz display has an 8.33 ms frame interval.
4. Use Flutter DevTools in profile mode for UI/raster breakdowns on a physical
   device. A profile build may have a different signing key: use a separate test
   installation/device rather than uninstalling a release containing local notes.

Do not infer a measured speedup or guaranteed 120 FPS from the emulator tests.
