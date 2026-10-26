import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:monokeep/models/note.dart';

Note note(String id, {bool sent = false, int updated = 1, bool pinned = false, bool deleted = false, bool archived = false}) => Note(
  id: id, title: 'Купить молоко [1]', content: 'hello WORLD', tags: const ['Продукты', '100%'],
  createdAt: DateTime.fromMillisecondsSinceEpoch(0), updatedAt: DateTime.fromMillisecondsSinceEpoch(updated),
  isReminderSent: sent, isPinned: pinned, isDeleted: deleted, isArchived: archived,
);

void main() {
  test('sent reminders outrank newer notes, dates descend, ties use ID', () {
    final notes = [note('z', updated: 1000), note('b', sent: true, updated: 2), note('a', sent: true, updated: 2), note('c', sent: true, updated: 5)];
    notes.sort(Note.compare);
    expect(notes.map((n) => n.id), ['c', 'a', 'b', 'z']);
  });
  test('pin grouping does not change reminder/date ordering within groups', () {
    final notes = [note('p', pinned: true), note('p-sent', pinned: true, sent: true), note('other', updated: 100)]..sort(Note.compare);
    expect(notes.where((n) => n.isPinned).map((n) => n.id), ['p-sent', 'p']);
  });
  test('search is literal, case-insensitive and includes Cyrillic tags', () {
    final n = note('1');
    for (final query in ['КУПИТЬ', 'world', 'ПРОДУКТЫ', '[1]', '100%', '']) { expect(n.matches(query), isTrue, reason: query); }
    for (final query in ['.*', '[12]', 'missing']) { expect(n.matches(query), isFalse, reason: query); }
  });
  test('trash takes precedence over archive; archived notes stay out of active view', () {
    final trashed = note('t', deleted: true, archived: true);
    expect(trashed.inView(NoteView.trash), true);
    expect(trashed.inView(NoteView.archive), false);
    expect(trashed.inView(NoteView.active), false);
    expect(note('a', archived: true).inView(NoteView.archive), true);
    expect(note('a', archived: true).inView(NoteView.active), false);
  });
  test('SQLite codec map preserves all user data', () {
    final original = Note(id: 'n', title: 'Title', content: 'One\nTwo', tags: const ['Work'], color: '#aecbfa',
      createdAt: DateTime.utc(2025), updatedAt: DateTime.utc(2026), reminderDate: DateTime.utc(2027),
      isArchived: true, isDeleted: true, isPinned: true, isReminderSent: true);
    expect(Note.fromMap(original.toMap()).toMap(), original.toMap());
  });
  test('Google Takeout timestamps, labels, colors and checklists are retained', () {
    final batch = ImportBatch.parse([{'name': 'keep.json', 'text': jsonEncode({
      'title': 'Shopping', 'color': 'DARK_BLUE', 'createdTimestampUsec': 1700000000000000,
      'userEditedTimestampUsec': 1700001000000000, 'isTrashed': true, 'isPinned': true, 'isArchived': true,
      'labels': [{'name': ' groceries '}, {'name': 'groceries'}],
      'listContent': [{'text': 'Milk', 'isChecked': true}, {'text': 'Bread', 'isChecked': false}],
    })}]);
    expect(batch.errors, isEmpty);
    final n = batch.notes.single;
    expect(n['color'], '#aecbfa'); expect(n['createdAt'], 1700000000000);
    expect(n['updatedAt'], 1700001000000); expect(n['tags'], ['groceries']);
    expect(n['content'], '☑ Milk\n☐ Bread'); expect(n['isDeleted'], true);
    expect(n['isPinned'], true); expect(n['isArchived'], true);
  });
  test('mixed invalid files and invalid rows do not hide valid notes', () {
    final batch = ImportBatch.parse([
      {'name': 'invalid.json', 'text': '{'},
      {'name': 'denied.json', 'error': 'Permission denied'},
      {'name': 'notes.json', 'text': '[{"title":"Good"},42,{}, {"title":"Gone","syncDeleted":true}]'},
    ]);
    expect(batch.notes.single['title'], 'Good'); expect(batch.errors.length, 4);
  });
  test('native backup imports without loss and keeps IDs for deduplication', () {
    final original = note('persistent', pinned: true, sent: true);
    final batch = ImportBatch.parse([{'name': 'backup.json', 'text': jsonEncode({'format': 'monokeep', 'version': 1, 'notes': [original.toMap()]})}]);
    final imported = {...batch.notes.single}..remove('importKey');
    expect(imported, original.toMap());
  });
  test('ISO reminder timestamps preserve the UTC instant across offsets', () {
    final batch = ImportBatch.parse([{'name': 'note.json', 'text': '{"title":"Time","reminderDate":"2026-10-27T10:30:00+08:00"}'}]);
    expect(batch.notes.single['reminderDate'], DateTime.utc(2026, 10, 27, 2, 30).millisecondsSinceEpoch);
  });
}
