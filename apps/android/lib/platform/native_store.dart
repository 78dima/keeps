import 'dart:isolate';
import 'package:flutter/services.dart';
import '../models/note.dart';

class NoteChanges {
  const NoteChanges({this.token, this.rows = const [], this.ids, this.unchanged = false});
  /// Opaque cursor for the next [NativeStore.changes] call.
  final String? token;
  /// Changed notes, or every note when [ids] is null.
  final List<Note> rows;
  /// Every visible note ID, for a delta.
  final List<String>? ids;
  final bool unchanged;

  static NoteChanges decode(Uint8List bytes) {
    final data = const StandardMessageCodec().decodeMessage(ByteData.sublistView(bytes)) as Map;
    return NoteChanges(
      token: data['token'] as String?, unchanged: data['unchanged'] == true,
      rows: [for (final row in data['rows'] as List? ?? const []) Note.fromMap(row as Map)],
      ids: (data['ids'] as List?)?.cast<String>(),
    );
  }
}

class NativeStore {
  static const channel = MethodChannel('com.monokeep.app/native');

  Future<Map<String, dynamic>> syncStatus() async =>
    Map<String, dynamic>.from((await channel.invokeMapMethod<String, dynamic>('syncStatus'))!);
  Future<void> syncNow() => channel.invokeMethod<void>('syncNow');
  Future<void> signIn(String email, String password) async {
    await channel.invokeMethod<dynamic>('signIn', {'email': email, 'password': password});
  }
  Future<void> signOut() => channel.invokeMethod<void>('signOut');

  /// Card previews changed since [token]; a null token reads every note.
  Future<NoteChanges> changes(String? token) async {
    final bytes = (await channel.invokeMethod<Uint8List>('listChanges', {'token': token}))!;
    // Large snapshots are decoded off the UI isolate; small deltas are not worth a spawn.
    return bytes.length < 32 * 1024 ? NoteChanges.decode(bytes) : Isolate.run(() => NoteChanges.decode(bytes));
  }

  Future<List<Note>> list() async => (await changes(null)).rows;

  /// The complete note, or null when it no longer exists.
  Future<Note?> get(String id) async {
    final row = await channel.invokeMapMethod<dynamic, dynamic>('getNote', {'id': id});
    return row == null ? null : Note.fromMap(row);
  }

  /// IDs of notes whose title, full content or a tag contains [query], ignoring case.
  Future<Set<String>> search(String query) async =>
    (await channel.invokeListMethod<String>('searchNotes', {'query': query}) ?? const <String>[]).toSet();

  Future<Note> save(Map<String, Object?> patch) async => Note.fromMap(
    (await channel.invokeMapMethod<dynamic, dynamic>('saveNote', patch))!,
  );

  Future<void> deleteForever(String id) => channel.invokeMethod<void>('deleteForever', {'id': id});
  Future<DateTime?> pickReminder(DateTime? initial) async {
    final millis = await channel.invokeMethod<int>('pickReminder', {'initial': initial?.millisecondsSinceEpoch});
    return millis == null ? null : DateTime.fromMillisecondsSinceEpoch(millis);
  }
  Future<Map<String, dynamic>> notificationStatus() async => Map<String, dynamic>.from(
    (await channel.invokeMapMethod<String, dynamic>('notificationStatus'))!,
  );
  Future<Map<String, dynamic>> requestNotifications() async => Map<String, dynamic>.from(
    (await channel.invokeMapMethod<String, dynamic>('requestNotifications'))!,
  );
  Future<void> openSettings(String kind) => channel.invokeMethod<void>('openSettings', {'kind': kind});
  Future<void> reschedule() => channel.invokeMethod<void>('reschedule');
  Future<List<Map<String, dynamic>>> pickFiles() async =>
    (await channel.invokeListMethod<dynamic>('pickImportFiles') ?? [])
        .map((row) => Map<String, dynamic>.from(row as Map)).toList();
  Future<Map<String, dynamic>> importNotes(List<Map<String, Object?>> notes) async =>
    Map<String, dynamic>.from((await channel.invokeMapMethod<String, dynamic>('importNotes', {'notes': notes}))!);
  Future<bool> exportNotes() async => await channel.invokeMethod<bool>('exportNotes') ?? false;
  Future<void> share(Note note) => channel.invokeMethod<void>('shareNote', {'title': note.title, 'content': note.content});
  Future<Map<String, dynamic>?> initialIntent() => channel.invokeMapMethod<String, dynamic>('initialIntent');
}
