import 'package:flutter/services.dart';
import '../models/note.dart';

class NativeStore {
  static const channel = MethodChannel('com.monokeep.app/native');

  Future<Map<String, dynamic>> syncStatus() async =>
    Map<String, dynamic>.from((await channel.invokeMapMethod<String, dynamic>('syncStatus'))!);
  Future<void> syncNow() => channel.invokeMethod<void>('syncNow');
  Future<void> signIn(String email, String password) async {
    await channel.invokeMethod<dynamic>('signIn', {'email': email, 'password': password});
  }
  Future<void> signOut() => channel.invokeMethod<void>('signOut');

  Future<List<Note>> list() async {
    final rows = await channel.invokeListMethod<dynamic>('listNotes') ?? [];
    return rows.map((row) => Note.fromMap(row as Map)).toList();
  }

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
