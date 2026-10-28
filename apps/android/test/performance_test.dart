import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:monokeep/main.dart';
import 'package:monokeep/models/note.dart';
import 'package:monokeep/platform/native_store.dart';
import 'package:monokeep/ui/note_card.dart';

class SnapshotStore extends NativeStore {
  List<Note> rows = [];
  int reads = 0;
  Completer<void>? gate;
  @override Future<List<Note>> list() async {
    reads++; await gate?.future;
    return rows.map((note) => Note.fromMap(note.toMap())).toList();
  }
  @override Future<void> reschedule() async {}
  @override Future<Map<String, dynamic>?> initialIntent() async => null;
}
Note row(int i) => Note(id: '$i', title: 'Note $i', content: 'Content\n' * (i % 5 + 1),
  createdAt: DateTime(2026), updatedAt: DateTime(2026).subtract(Duration(seconds: i)));
Future<void> changed(WidgetTester tester) async {
  final complete = Completer<void>();
  // Simulate the native event, rather than calling widget internals.
  // ignore: deprecated_member_use
  await tester.binding.defaultBinaryMessenger.handlePlatformMessage('com.monokeep.app/native',
    const StandardMethodCodec().encodeMethodCall(const MethodCall('notesChanged')),
    (_) => complete.complete());
  await complete.future;
}
void phone(WidgetTester tester) {
  tester.view.physicalSize = const Size(390, 844); tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
}
void main() {
  testWidgets('1000 notes build only nearby cards and remain editable after scrolling', (tester) async {
    phone(tester);
    final store = SnapshotStore()..rows = List.generate(1000, row);
    await tester.pumpWidget(MonoKeepApp(store: store)); await tester.pumpAndSettle();
    expect(find.byType(NoteCard).evaluate().length, lessThan(15));
    expect(find.text('Note 999'), findsNothing);
    await tester.scrollUntilVisible(find.text('Note 999'), 6000,
      scrollable: find.byType(Scrollable).last, maxScrolls: 150);
    expect(find.byType(NoteCard).evaluate().length, lessThan(15));
    await tester.tap(find.text('Note 999')); await tester.pumpAndSettle();
    expect(find.byKey(const Key('editor-save')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
  testWidgets('native bursts coalesce and identical snapshots retain card widgets', (tester) async {
    phone(tester);
    final store = SnapshotStore()..rows = [row(0), row(1)];
    await tester.pumpWidget(MonoKeepApp(store: store)); await tester.pumpAndSettle();
    final before = tester.widgetList<NoteCard>(find.byType(NoteCard)).toList();
    final reads = store.reads;
    for (var i = 0; i < 20; i++) { await changed(tester); }
    await tester.pump(const Duration(milliseconds: 130)); await tester.pumpAndSettle();
    expect(store.reads, reads + 1);
    final after = tester.widgetList<NoteCard>(find.byType(NoteCard)).toList();
    expect(identical(before.first, after.first), isTrue);
    // Delivery can change without changing updatedAt.
    store.rows[0] = Note.fromMap({...store.rows[0].toMap(), 'isReminderSent': true});
    await changed(tester); await tester.pump(const Duration(milliseconds: 130)); await tester.pumpAndSettle();
    final updated = tester.widgetList<NoteCard>(find.byType(NoteCard)).toList();
    expect(updated.first.note.isReminderSent, isTrue);
    expect(identical(after.last, updated.last), isTrue);
  });
  testWidgets('in-flight changes trigger one trailing read and retain latest data', (tester) async {
    phone(tester);
    final store = SnapshotStore()..rows = [row(0)];
    await tester.pumpWidget(MonoKeepApp(store: store)); await tester.pumpAndSettle();
    final initial = store.reads;
    store.gate = Completer<void>();
    await changed(tester); await tester.pump(const Duration(milliseconds: 130));
    for (var i = 0; i < 20; i++) { await changed(tester); }
    store.rows = [Note.fromMap({...row(0).toMap(), 'title': 'Newest'})];
    store.gate!.complete(); store.gate = null;
    await tester.pumpAndSettle();
    expect(store.reads, initial + 2); expect(find.text('Newest'), findsOneWidget);
    await changed(tester); await tester.pumpWidget(const SizedBox());
    await tester.pump(const Duration(milliseconds: 200));
    expect(tester.takeException(), isNull);
  });
}
