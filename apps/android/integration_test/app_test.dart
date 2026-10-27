import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:monokeep/platform/native_store.dart';
import 'package:monokeep/main.dart';
import 'package:monokeep/models/note.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('real Android SQLite CRUD and backup-compatible import', (tester) async {
    final store = NativeStore();
    final created = await store.save({'title': 'Integration ${DateTime.now().microsecondsSinceEpoch}', 'content': 'Offline\nЗаметка', 'tags': ['Android'], 'color': '#aecbfa'});
    addTearDown(() async {
      await store.save({'id': created.id, 'isDeleted': true});
      await store.deleteForever(created.id);
    });
    await tester.pumpWidget(MonoKeepApp(store: store)); await tester.pumpAndSettle();
    expect(find.text(created.title), findsOneWidget);
    // Recreate the Dart repository: data must come from native SQLite, not widget memory.
    final reopened = await NativeStore().list();
    expect(reopened.singleWhere((n) => n.id == created.id).content, 'Offline\nЗаметка');
    await store.save({'id': created.id, 'isPinned': true});
    expect((await store.list()).singleWhere((n) => n.id == created.id).isPinned, true);
    final duplicate = await store.importNotes([created.toMap()]);
    expect(duplicate['imported'], 0);
    expect((await store.list()).singleWhere((n) => n.id == created.id).isPinned, true);
    await store.save({'id': created.id, 'isDeleted': true});
    expect((await store.list()).singleWhere((n) => n.id == created.id).inView(NoteView.trash), true);
    await store.save({'id': created.id, 'isDeleted': false, 'isArchived': false});
    expect((await store.list()).singleWhere((n) => n.id == created.id).inView(NoteView.active), true);
  });

  testWidgets('Android keyboard, Title tap and repeated creation keep one SQLite note', (tester) async {
    final store = NativeStore();
    final before = (await store.list()).map((note) => note.id).toSet();
    addTearDown(() async {
      for (final note in await store.list()) {
        if (!before.contains(note.id)) {
          await store.save({'id': note.id, 'isDeleted': true});
          await store.deleteForever(note.id);
        }
      }
    });
    await tester.pumpWidget(MonoKeepApp(store: store)); await tester.pumpAndSettle();
    await tester.tap(find.text('Take a note...')); await tester.pumpAndSettle();
    // Allow the real Android keyboard's resize animation to complete.
    await tester.pump(const Duration(seconds: 1));
    final title = find.byKey(const Key('create-title'));
    await tester.ensureVisible(title); await tester.tap(title); await tester.pumpAndSettle();
    expect(title, findsOneWidget);
    expect((await store.list()).length, before.length);
    await tester.enterText(title, 'Title-only Android regression');
    FocusManager.instance.primaryFocus?.unfocus(); await tester.pumpAndSettle();
    final color = find.byKey(const Key('create-color-#f28b82'));
    await tester.ensureVisible(color); await tester.tap(color); await tester.pumpAndSettle();
    final save = find.byKey(const Key('create-save'));
    await tester.ensureVisible(save); await tester.tap(save); await tester.pumpAndSettle();
    final after = (await NativeStore().list()).where((note) => !before.contains(note.id)).toList();
    expect(after, hasLength(1));
    expect(after.single.title, 'Title-only Android regression');
    expect(after.single.color, '#f28b82');
    for (var attempt = 0; attempt < 2; attempt++) {
      await tester.tap(find.text('Take a note...')); await tester.pumpAndSettle();
      await tester.ensureVisible(title); await tester.tap(title); await tester.pumpAndSettle();
      expect(title, findsOneWidget);
      FocusManager.instance.primaryFocus?.unfocus(); await tester.pumpAndSettle();
      await tester.ensureVisible(find.byKey(const Key('create-close')));
      await tester.tap(find.byKey(const Key('create-close'))); await tester.pumpAndSettle();
    }
    expect((await NativeStore().list()).where((note) => !before.contains(note.id)), hasLength(1));
    expect(tester.takeException(), isNull);
  });
}
