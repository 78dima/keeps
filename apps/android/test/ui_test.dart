import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:monokeep/platform/native_store.dart';
import 'package:monokeep/main.dart';
import 'package:monokeep/models/note.dart';
import 'package:monokeep/ui/note_card.dart';

class MemoryStore extends NativeStore {
  final rows = <Note>[];
  bool failSave = false;
  @override Future<List<Note>> list() async => [...rows];
  @override Future<void> reschedule() async {}
  @override Future<Map<String, dynamic>?> initialIntent() async => null;
  @override Future<Map<String, dynamic>> notificationStatus() async => {'notifications': true, 'exactAlarms': true};
  @override Future<Note> save(Map<String, Object?> patch) async {
    if (failSave) throw Exception('disk full');
    final id = patch['id'] ?? '${rows.length + 1}';
    final existing = rows.where((n) => n.id == id);
    final map = existing.isEmpty ? <String, Object?>{} : existing.first.toMap();
    map.addAll({'createdAt': 1, 'updatedAt': 1, ...patch, 'id': id});
    final row = Note.fromMap(map);
    rows.removeWhere((n) => n.id == id); rows.add(row);
    return row;
  }
}

void main() {
  testWidgets('create, search, edit/cancel, pin, trash and restore', (tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final store = MemoryStore();
    await tester.pumpWidget(MonoKeepApp(store: store));
    await tester.pumpAndSettle();
    expect(find.text('No notes found'), findsOneWidget);
    await tester.tap(find.text('Take a note...')); await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('create-title')), 'Shopping');
    await tester.enterText(find.byKey(const Key('create-content')), 'Milk');
    await tester.tap(find.text('Create')); await tester.pumpAndSettle();
    expect(store.rows.single.content, 'Milk');
    expect(find.byType(NoteCard), findsOneWidget);
    await tester.tap(find.byTooltip('Pin')); await tester.pumpAndSettle();
    expect(store.rows.single.isPinned, true);
    await tester.tap(find.text('Shopping')); await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('editor-title')), 'Discarded');
    await tester.tap(find.text('Cancel')); await tester.pumpAndSettle();
    expect(store.rows.single.title, 'Shopping');
    await tester.enterText(find.byKey(const Key('search')), 'missing');
    await tester.pump(const Duration(milliseconds: 350));
    expect(find.byType(NoteCard), findsNothing);
    await tester.enterText(find.byKey(const Key('search')), 'MILK');
    await tester.pump(const Duration(milliseconds: 350));
    expect(find.byType(NoteCard), findsOneWidget);
    await tester.tap(find.byTooltip('Move to Trash')); await tester.pumpAndSettle();
    expect(store.rows.single.isDeleted, true);
    await tester.tap(find.byTooltip('Open menu')); await tester.pumpAndSettle();
    expect(tester.takeException(), isNull, reason: 'The mobile sidebar header must fit its drawer.');
    await tester.tap(find.text('Trash')); await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Restore')); await tester.pumpAndSettle();
    expect(store.rows.single.isDeleted, false);
    expect(tester.takeException(), isNull);
  });

  testWidgets('failed create keeps the draft for retry', (tester) async {
    final store = MemoryStore()..failSave = true;
    await tester.pumpWidget(MonoKeepApp(store: store)); await tester.pumpAndSettle();
    await tester.tap(find.text('Take a note...')); await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('create-content')), 'Do not lose me');
    await tester.tap(find.text('Create')); await tester.pumpAndSettle();
    expect(find.textContaining('Could not create note'), findsOneWidget);
    expect(find.text('Do not lose me'), findsOneWidget);
    store.failSave = false;
    await tester.tap(find.text('Create')); await tester.pumpAndSettle();
    expect(store.rows.single.content, 'Do not lose me');
  });

  for (final width in [320.0, 640.0, 800.0, 1280.0]) {
    testWidgets('cards and editor fit at width $width', (tester) async {
      tester.view.physicalSize = Size(width, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final store = MemoryStore();
      for (var i = 0; i < 7; i++) {
        await store.save({'title': 'Note $i', 'content': 'Line\n' * (i + 1), 'tags': ['one', 'two'], 'isPinned': i < 2, 'isReminderSent': true});
      }
      await tester.pumpWidget(MonoKeepApp(store: store)); await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await tester.tap(find.byType(NoteCard).first); await tester.pumpAndSettle();
      expect(find.byKey(const Key('editor-save')), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  }
}
