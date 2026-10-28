import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:monokeep/main.dart';
import 'package:monokeep/models/note.dart';
import 'package:monokeep/platform/native_store.dart';
import 'list_store.dart';
import 'package:monokeep/ui/note_card.dart';

class SnapshotStore extends NativeStore with ListStore {
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
/// Mirrors the native cursor: full snapshot first, then only changed rows plus every visible ID.
class DeltaStore extends NativeStore {
  final notes = <String, Note>{};
  final full = <String, String>{};
  final changedSince = <String>{};
  final tokens = <String?>[];
  final queries = <String>[];
  bool forgetNext = false, removed = false;
  int version = 0;
  @override Future<NoteChanges> changes(String? token) async {
    tokens.add(token);
    final next = '${++version}';
    if (token != null && changedSince.isEmpty && !removed && !forgetNext) return NoteChanges(token: next, unchanged: true);
    final rows = token == null ? notes.values.toList() : [for (final id in changedSince) if (notes[id] != null) notes[id]!];
    final ids = token == null ? null : [...notes.keys, if (forgetNext) 'never-sent'];
    forgetNext = false; removed = false; changedSince.clear();
    return NoteChanges(token: next, rows: rows, ids: ids);
  }
  @override Future<Note?> get(String id) async => notes[id] == null ? null
    : Note.fromMap({...notes[id]!.toMap(), 'content': full[id] ?? notes[id]!.content, 'isPreview': false});
  @override Future<Set<String>> search(String query) async {
    queries.add(query);
    return {for (final note in notes.values) if ((full[note.id] ?? note.content).toLowerCase().contains(query.toLowerCase())) note.id};
  }
  @override Future<void> reschedule() async {}
  @override Future<Map<String, dynamic>?> initialIntent() async => null;
  @override Future<Map<String, dynamic>> notificationStatus() async => {'notifications': true, 'exactAlarms': true};
  void put(Note note) { notes[note.id] = note; changedSince.add(note.id); }
  void remove(String id) { notes.remove(id); removed = true; }
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
  testWidgets('deltas update only changed cards, drop removed notes and recover from gaps', (tester) async {
    phone(tester);
    final store = DeltaStore();
    for (var i = 0; i < 3; i++) { store.put(row(i)); }
    await tester.pumpWidget(MonoKeepApp(store: store)); await tester.pumpAndSettle();
    expect(store.tokens, [null]);
    final before = {for (final card in tester.widgetList<NoteCard>(find.byType(NoteCard))) card.note.id: card};
    store.put(Note.fromMap({...row(1).toMap(), 'title': 'Edited'}));
    store.remove('2');
    await changed(tester); await tester.pump(const Duration(milliseconds: 130)); await tester.pumpAndSettle();
    expect(store.tokens.last, '1');
    expect(find.text('Edited'), findsOneWidget);
    expect(find.text('Note 2'), findsNothing);
    final after = {for (final card in tester.widgetList<NoteCard>(find.byType(NoteCard))) card.note.id: card};
    expect(identical(before['0'], after['0']), isTrue);
    // An ID without a row means the cursor and the screen diverged: read everything again.
    store.forgetNext = true;
    await changed(tester); await tester.pump(const Duration(milliseconds: 130)); await tester.pumpAndSettle();
    expect(store.tokens.sublist(store.tokens.length - 2), ['2', null]);
    expect(find.byType(NoteCard), findsNWidgets(2));
    expect(tester.takeException(), isNull);
  });
  testWidgets('cards show previews; editor and search use the full note', (tester) async {
    phone(tester);
    final store = DeltaStore();
    final tail = 'needle at the very end';
    store.full['long'] = '${'word ' * 400}$tail';
    store.put(Note(id: 'long', title: 'Long', content: 'word ' * 160, isPreview: true,
      createdAt: DateTime(2026), updatedAt: DateTime(2026)));
    store.put(Note(id: 'short', title: 'Short', content: 'small', createdAt: DateTime(2026), updatedAt: DateTime(2025)));
    await tester.pumpWidget(MonoKeepApp(store: store)); await tester.pumpAndSettle();
    expect(find.textContaining('…'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('search')), 'NEEDLE');
    await tester.pump(const Duration(milliseconds: 310)); await tester.pumpAndSettle();
    expect(store.queries, ['NEEDLE']);
    expect(find.byType(NoteCard), findsOneWidget);
    await tester.tap(find.text('Long')); await tester.pumpAndSettle();
    final editor = tester.widget<TextField>(find.byKey(const Key('editor-content')));
    expect(editor.controller!.text, endsWith(tail));
    expect(tester.takeException(), isNull);
  });
  testWidgets('wide layouts keep columns lazy', (tester) async {
    tester.view.physicalSize = const Size(1280, 900); tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
    final store = SnapshotStore()..rows = List.generate(1000, row);
    await tester.pumpWidget(MonoKeepApp(store: store)); await tester.pumpAndSettle();
    expect(find.byType(NoteCard).evaluate().length, lessThan(40));
    await tester.scrollUntilVisible(find.text('Note 999'), 6000,
      scrollable: find.byType(Scrollable).last, maxScrolls: 150);
    expect(find.byType(NoteCard).evaluate().length, lessThan(40));
    expect(tester.takeException(), isNull);
  });
  test('column split keeps reading order and balances estimated heights', () {
    final notes = List.generate(30, (i) => Note(id: '$i', title: 'Note $i', content: 'Line\n' * (i % 7 + 1),
      createdAt: DateTime(2026), updatedAt: DateTime(2026)));
    final lanes = splitColumns(notes, 3, 300);
    expect(lanes.expand((lane) => lane).toList(), notes);
    final heights = [for (final lane in lanes) lane.fold(0.0, (sum, note) => sum + estimateCardHeight(note, 300) + 16)];
    final tallest = heights.reduce((a, b) => a > b ? a : b);
    expect(heights.every((height) => tallest - height < 400), isTrue);
    expect(splitColumns(notes.take(2).toList(), 2, 300).map((lane) => lane.length), [1, 1]);
  });
}
