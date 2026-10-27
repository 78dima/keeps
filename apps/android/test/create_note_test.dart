import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:monokeep/main.dart';
import 'package:monokeep/models/note.dart';
import 'package:monokeep/platform/native_store.dart';
import 'package:monokeep/ui/note_card.dart';

class DraftStore extends NativeStore {
  final rows = <Note>[];
  final requests = <Map<String, Object?>>[];
  bool loseNextReply = false;
  Completer<void>? saveGate;
  Completer<DateTime?>? picker;
  @override Future<List<Note>> list() async => [...rows];
  @override Future<void> reschedule() async {}
  @override Future<Map<String, dynamic>?> initialIntent() async => null;
  @override Future<Map<String, dynamic>> notificationStatus() async => {'notifications': true, 'exactAlarms': true};
  @override Future<Map<String, dynamic>> requestNotifications() => notificationStatus();
  @override Future<DateTime?> pickReminder(DateTime? initial) => picker!.future;
  @override Future<Note> save(Map<String, Object?> patch) async {
    requests.add(Map.of(patch));
    await saveGate?.future;
    final id = (patch['id'] ?? patch['creationId'] ?? 'note-${rows.length}') as String;
    final existing = rows.where((row) => row.id == id).firstOrNull;
    if (patch['creationId'] != null && existing != null) return existing;
    final note = Note.fromMap({
      'createdAt': 1, 'updatedAt': 1, ...?existing?.toMap(), ...patch, 'id': id,
    });
    rows.removeWhere((row) => row.id == id);
    rows.add(note);
    if (loseNextReply) {
      loseNextReply = false;
      throw Exception('Saved, but reply was lost');
    }
    return note;
  }
}

Future<void> openDraft(WidgetTester tester, DraftStore store) async {
  tester.view.physicalSize = const Size(390, 844);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  addTearDown(tester.view.resetViewInsets);
  await tester.pumpWidget(MonoKeepApp(store: store));
  await tester.pumpAndSettle();
  await tester.tap(find.text('Take a note...'));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('touching Title with empty body and keyboard open keeps one draft', (tester) async {
    final store = DraftStore();
    await openDraft(tester, store);
    tester.view.viewInsets = const FakeViewPadding(bottom: 280);
    await tester.pumpAndSettle();
    final title = find.byKey(const Key('create-title'));
    await tester.ensureVisible(title);
    await tester.tap(title);
    await tester.pumpAndSettle();
    expect(title, findsOneWidget);
    expect(store.rows, isEmpty);
    await tester.enterText(title, 'Title only');
    tester.view.resetViewInsets();
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Create'));
    await tester.tap(find.text('Create'));
    await tester.pumpAndSettle();
    expect(store.rows, hasLength(1));
    await tester.tap(find.text('Take a note...'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('create-title')));
    await tester.pumpAndSettle();
    expect(store.rows, hasLength(1));
    expect(tester.takeException(), isNull);
  });

  testWidgets('scroll gesture outside the form does not create a note', (tester) async {
    final store = DraftStore();
    await openDraft(tester, store);
    await tester.enterText(find.byKey(const Key('create-title')), 'Still editing');
    await tester.pump();
    final gesture = await tester.startGesture(const Offset(382, 300));
    await gesture.moveBy(const Offset(0, -80));
    await gesture.up();
    await tester.pumpAndSettle();
    expect(store.rows, isEmpty);
    expect(find.byKey(const Key('create-title')), findsOneWidget);
  });

  testWidgets('retry after a lost save reply does not create a second note', (tester) async {
    final store = DraftStore()..loseNextReply = true;
    await openDraft(tester, store);
    await tester.enterText(find.byKey(const Key('create-content')), 'Keep this draft');
    await tester.pump();
    await tester.ensureVisible(find.text('Create'));
    await tester.tap(find.text('Create'));
    await tester.pumpAndSettle();
    expect(store.rows, hasLength(1));
    expect(find.textContaining('Could not create note'), findsOneWidget);
    await tester.tap(find.text('Create'));
    await tester.pumpAndSettle();
    expect(store.rows, hasLength(1));
    expect(store.rows.single.content, 'Keep this draft');
  });

  testWidgets('edited retry preserves new text on the original saved note', (tester) async {
    final store = DraftStore()..loseNextReply = true;
    await openDraft(tester, store);
    await tester.enterText(find.byKey(const Key('create-content')), 'First version');
    await tester.pump();
    await tester.ensureVisible(find.text('Create'));
    await tester.tap(find.text('Create')); await tester.pumpAndSettle();
    final id = store.rows.single.id;
    await tester.enterText(find.byKey(const Key('create-title')), 'Added after failure');
    await tester.pump();
    await tester.enterText(find.byKey(const Key('create-content')), 'Second version');
    await tester.pump();
    await tester.ensureVisible(find.text('Create'));
    await tester.tap(find.text('Create')); await tester.pumpAndSettle();
    expect(store.rows, hasLength(1));
    expect(store.rows.single.id, id);
    expect(store.rows.single.title, 'Added after failure');
    expect(store.rows.single.content, 'Second version');
  });

  testWidgets('empty or whitespace-only draft cannot be created', (tester) async {
    final store = DraftStore();
    await openDraft(tester, store);
    final save = find.byKey(const Key('create-save'));
    expect(tester.widget<FilledButton>(save).onPressed, isNull);
    await tester.enterText(find.byKey(const Key('create-title')), '  ');
    await tester.pump();
    await tester.enterText(find.byKey(const Key('create-content')), '\n  ');
    await tester.pump();
    expect(tester.widget<FilledButton>(save).onPressed, isNull);
    await tester.ensureVisible(save); await tester.tap(save);
    await tester.pumpAndSettle();
    expect(store.requests, isEmpty);
  });

  testWidgets('color, native reminder and unsubmitted tag belong to the created note', (tester) async {
    final store = DraftStore()..picker = Completer<DateTime?>();
    await openDraft(tester, store);
    tester.view.physicalSize = const Size(320, 844);
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('create-title')), 'With reminder');
    await tester.pump();
    await tester.enterText(find.widgetWithText(TextField, 'Add tag...'), 'work');
    final color = find.byKey(const Key('create-color-#f28b82'));
    await tester.ensureVisible(color); await tester.tap(color); await tester.pumpAndSettle();
    final reminder = find.byKey(const Key('create-reminder'));
    await tester.ensureVisible(reminder); await tester.tap(reminder); await tester.pump();
    await tester.tapAt(const Offset(315, 100)); await tester.pump();
    expect(store.requests, isEmpty, reason: 'Native dialogs must not autosave the draft.');
    final when = DateTime.now().add(const Duration(days: 2));
    store.picker!.complete(when); await tester.pumpAndSettle();
    expect(find.byKey(const Key('create-title')), findsOneWidget);
    await tester.ensureVisible(find.text('Create')); await tester.tap(find.text('Create'));
    await tester.pumpAndSettle();
    expect(store.rows.single.color, '#f28b82');
    expect(store.rows.single.reminderDate!.millisecondsSinceEpoch, when.millisecondsSinceEpoch);
    expect(store.rows.single.tags, ['work']);
    expect(tester.takeException(), isNull);
  });

  testWidgets('cancelled reminder and closed draft do not leak into the next note', (tester) async {
    final store = DraftStore()..picker = Completer<DateTime?>();
    await openDraft(tester, store);
    await tester.enterText(find.byKey(const Key('create-title')), 'Discard this');
    await tester.pump();
    await tester.tap(find.byKey(const Key('create-color-#f28b82')));
    await tester.tap(find.byKey(const Key('create-reminder'))); await tester.pump();
    store.picker!.complete(null); await tester.pumpAndSettle();
    expect(find.text('Set date & time'), findsOneWidget);
    await tester.ensureVisible(find.text('Close')); await tester.tap(find.text('Close')); await tester.pumpAndSettle();
    expect(store.rows, isEmpty);
    await tester.tap(find.text('Take a note...')); await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('create-title')), 'New draft');
    await tester.pump();
    await tester.ensureVisible(find.text('Create')); await tester.tap(find.text('Create')); await tester.pumpAndSettle();
    expect(store.rows.single.color, isNull);
    expect(store.rows.single.reminderDate, isNull);
  });

  testWidgets('repeated outside taps and Create during a slow save commit once', (tester) async {
    final store = DraftStore()..saveGate = Completer<void>();
    await openDraft(tester, store);
    await tester.enterText(find.byKey(const Key('create-title')), 'One note');
    await tester.pump();
    await tester.tapAt(const Offset(382, 300)); await tester.pump();
    expect(store.requests, hasLength(1));
    await tester.tapAt(const Offset(382, 300)); await tester.pump();
    await tester.ensureVisible(find.byKey(const Key('create-save')));
    await tester.tap(find.byKey(const Key('create-save'))); await tester.pump();
    expect(store.requests, hasLength(1));
    store.saveGate!.complete(); await tester.pumpAndSettle();
    expect(store.rows, hasLength(1));
    expect(find.byType(NoteCard), findsOneWidget);
  });

  testWidgets('card displays every line of a long title', (tester) async {
    final store = DraftStore();
    const title = 'First line\nSecond line\nThird line\nFourth line\nFifth line\nSixth line';
    await store.save({'title': title});
    await tester.pumpWidget(MonoKeepApp(store: store)); await tester.pumpAndSettle();
    final text = tester.widget<Text>(find.text(title));
    expect(text.maxLines, isNull);
    expect(text.overflow, isNot(TextOverflow.ellipsis));
    expect(tester.takeException(), isNull);
  });
}
