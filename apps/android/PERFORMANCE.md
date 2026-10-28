# Android rendering and refresh rate

Release 1.1.4+10 keeps the existing note order, filters, colors and reminder UI.

- Every note feed is lazy. A single column is one SliverList. Wide layouts keep the
  website's top-to-bottom column order with one lazy SliverList per column inside
  a SliverCrossAxisGroup; the split balances estimated card heights instead of
  laying out every card. The pinned-notes drawer is lazy too.
- The list reads card previews: content is cut to 800 characters in SQLite, with an
  `isPreview` flag for the ellipsis. Opening a note reads the complete row with
  `getNote`; the editor asserts it never receives a preview. Search runs natively
  over full content, titles and tags (`searchNotes`, `Locale.ROOT` lowercasing).
- `listChanges` takes the previous cursor. NoteDatabase records which notes changed
  their displayed fields; reminder arming does not count. An unchanged cursor
  returns no rows. A delta returns changed rows plus every visible ID, so removed
  notes disappear. Guest adoption, another account, another process or database
  instance, or an invalid cursor return a full snapshot. A delta that names an ID
  the screen never received makes Dart request a full snapshot.
- Flutter 3.32 runs Dart on the Android main thread. The reply is encoded with
  StandardMessageCodec on the storage thread, so the main thread only copies
  bytes. Snapshots of 32 KiB or more are decoded in a short-lived isolate.
- Native change events are debounced for 120 ms. Reads are serialized with one
  trailing refresh when another change arrives during an outstanding read.
  Identical snapshots cause no screen rebuild. Unchanged notes retain their
  object identity and their recent card widgets (bounded cache: 128 entries).
  Filtered sections, counts, colors and pinned drawer entries are recomputed
  only when notes, the view, search results or a filter change.
- Snapshot equality includes every displayed field, including reminder delivery
  flags that may change without updatedAt. This optimization never changes sync
  timestamps or conflict resolution.
- `rescheduleAll` reconciles only notes with a reminder date or an armed alarm,
  not every note: no per-note SQL update and alarm/notification IPC for plain
  notes. When sync replaces or clears a local reminder date, `accept` cancels the
  old alarm and notification itself. The list no longer waits for rescheduling
  on resume.
- Card actions omit Tooltip overlays and keep their labels as semantics.
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
The widget regressions cover a 1000-note collection in one column (fewer than 15
mounted cards before and after scrolling; last note opens) and in three columns
(fewer than 40), 20 native events folded into one read, unchanged-widget reuse,
reminder status changes with unchanged updatedAt, in-flight updates, teardown
with a pending event, deltas (changed card only, removed note, recovery from an
unknown ID), previews with full text in the editor and native search, the column
split order, and card action semantics. NoteDatabaseTest covers previews,
cursors, deltas, search and reminder candidates on real SQLite.

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
