import 'package:monokeep/models/note.dart';
import 'package:monokeep/platform/native_store.dart';

/// Serves full snapshots, the complete note and search from a test store's list().
mixin ListStore on NativeStore {
  @override Future<NoteChanges> changes(String? token) async => NoteChanges(rows: await list());
  @override Future<Note?> get(String id) async {
    for (final note in await list()) { if (note.id == id) return note; }
    return null;
  }
  @override Future<Set<String>> search(String query) async =>
    {for (final note in await list()) if (note.matches(query)) note.id};
}
