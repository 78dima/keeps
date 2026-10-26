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
}
