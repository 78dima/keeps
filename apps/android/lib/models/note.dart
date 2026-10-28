import 'dart:convert';

enum NoteView { active, archive, trash }

const noteColors = <String>[
  '#ffffff', '#f28b82', '#fbbc04', '#fff475', '#ccff90', '#a7ffeb',
  '#cbf0f8', '#aecbfa', '#d7aefb', '#fdcfe8', '#e6c9a8', '#e8eaed',
];

class Note {
  const Note({
    required this.id,
    required this.title,
    required this.content,
    required this.createdAt,
    required this.updatedAt,
    this.color,
    this.tags = const [],
    this.isPinned = false,
    this.isArchived = false,
    this.isDeleted = false,
    this.isReminderSent = false,
    this.reminderEnabled = true,
    this.isPreview = false,
    this.sortAt,
    this.reminderDate,
  });

  final String id, title, content;
  final String? color;
  final List<String> tags;
  final bool isPinned, isArchived, isDeleted, isReminderSent, reminderEnabled;
  /// List rows carry only the start of long content; the editor loads the full note.
  final bool isPreview;
  final DateTime createdAt, updatedAt;
  final DateTime? reminderDate, sortAt;

  factory Note.fromMap(Map<dynamic, dynamic> data) => Note(
    id: data['id'] as String,
    title: data['title'] as String? ?? '',
    content: data['content'] as String? ?? '',
    color: data['color'] as String?,
    tags: List<String>.from(data['tags'] as List? ?? []),
    createdAt: DateTime.fromMillisecondsSinceEpoch((data['createdAt'] as num).toInt()),
    updatedAt: DateTime.fromMillisecondsSinceEpoch((data['updatedAt'] as num).toInt()),
    reminderDate: data['reminderDate'] == null ? null : DateTime.fromMillisecondsSinceEpoch((data['reminderDate'] as num).toInt()),
    isPinned: data['isPinned'] == true,
    isArchived: data['isArchived'] == true,
    isDeleted: data['isDeleted'] == true,
    isReminderSent: data['isReminderSent'] == true,
    reminderEnabled: data['reminderEnabled'] != false,
    isPreview: data['isPreview'] == true,
    sortAt: data['sortAt'] == null ? null : DateTime.fromMillisecondsSinceEpoch((data['sortAt'] as num).toInt()),
  );

  Map<String, Object?> toMap() => {
    'id': id, 'title': title, 'content': content, 'color': color, 'tags': tags,
    'createdAt': createdAt.millisecondsSinceEpoch,
    'updatedAt': updatedAt.millisecondsSinceEpoch,
    'reminderDate': reminderDate?.millisecondsSinceEpoch,
    'isPinned': isPinned, 'isArchived': isArchived, 'isDeleted': isDeleted,
    'isReminderSent': isReminderSent,
    'reminderEnabled': reminderEnabled,
    if (isPreview) 'isPreview': true,
    'sortAt': sortAt?.millisecondsSinceEpoch,
  };

  // Compare every persisted field: reminder delivery can change without updatedAt.
  bool sameValue(Note other) => id == other.id && title == other.title &&
    content == other.content && color == other.color && createdAt == other.createdAt &&
    updatedAt == other.updatedAt && reminderDate == other.reminderDate && sortAt == other.sortAt &&
    isPinned == other.isPinned && isArchived == other.isArchived && isDeleted == other.isDeleted &&
    isReminderSent == other.isReminderSent && reminderEnabled == other.reminderEnabled && isPreview == other.isPreview &&
    tags.length == other.tags.length && Iterable<int>.generate(tags.length).every((i) => tags[i] == other.tags[i]);

  bool matches(String query) {
    final needle = query.toLowerCase();
    return title.toLowerCase().contains(needle) ||
        content.toLowerCase().contains(needle) ||
        tags.any((tag) => tag.toLowerCase().contains(needle));
  }

  bool inView(NoteView view) => switch (view) {
    NoteView.trash => isDeleted,
    NoteView.archive => !isDeleted && isArchived,
    NoteView.active => !isDeleted && !isArchived,
  };

  // Same priority and stable tie-breaker as useNotesStore.ts.
  static int compare(Note a, Note b) {
    if (a.isPinned != b.isPinned) return a.isPinned ? -1 : 1;
    final date = (b.sortAt ?? b.updatedAt).compareTo(a.sortAt ?? a.updatedAt);
    return date != 0 ? date : a.id.compareTo(b.id);
  }
}

class ImportBatch {
  const ImportBatch(this.notes, this.errors);
  final List<Map<String, Object?>> notes;
  final List<String> errors;

  static ImportBatch parse(List<Map<String, dynamic>> files, {DateTime? now}) {
    final notes = <Map<String, Object?>>[];
    final errors = <String>[];
    final timestamp = (now ?? DateTime.now()).millisecondsSinceEpoch;
    for (final file in files) {
      final name = file['name'] ?? 'JSON';
      try {
        if (file['error'] != null) throw FormatException(file['error'].toString());
        final decoded = jsonDecode(file['text'] as String);
        final Object? source = decoded is Map && decoded['notes'] is List ? decoded['notes'] : decoded;
        final rows = source is List ? source : [source];
        for (var i = 0; i < rows.length; i++) {
          try {
            final row = rows[i];
            if (row is! Map || !['title', 'content', 'textContent', 'listContent'].any(row.containsKey)) {
              throw const FormatException('Not a note');
            }
            if (row['syncDeleted'] == true) continue;
            final content = row['content'] ?? row['textContent'] ??
                (row['listContent'] is List ? (row['listContent'] as List).map((item) =>
                  '${item['isChecked'] == true ? '☑' : '☐'} ${item['text'] ?? ''}').join('\n') : '');
            final rawTags = row['tags'] ?? row['labels'] ?? [];
            final tags = <String>{};
            if (rawTags is List) {
              for (final tag in rawTags) {
                final value = (tag is Map ? tag['name'] : tag)?.toString().trim() ?? '';
                if (value.isNotEmpty) tags.add(value);
              }
            }
            final color = _normalizeColor(row['color']);
            notes.add({
              if (row['id'] is String && (row['id'] as String).isNotEmpty) 'id': row['id'],
              // Native SHA-256 gives repeat imports a stable identity, without overwriting edits.
              'importKey': jsonEncode(row),
              'title': row['title']?.toString().isNotEmpty == true ? row['title'].toString() : 'Untitled',
              'content': content.toString(), 'tags': tags.toList(), 'color': color,
              'isPinned': row['isPinned'] == true, 'isArchived': row['isArchived'] == true,
              'isDeleted': row['isDeleted'] == true || row['isTrashed'] == true,
              'isReminderSent': row['isReminderSent'] == true,
              'reminderEnabled': row['reminderEnabled'] != false,
              'sortAt': _timestamp(row['sortAt'], null),
              'createdAt': _timestamp(row['createdAt'], row['createdTimestampUsec']) ?? timestamp,
              'updatedAt': _timestamp(row['updatedAt'], row['userEditedTimestampUsec']) ?? timestamp,
              'reminderDate': _timestamp(row['reminderDate'], null),
            });
          } catch (e) {
            errors.add('$name, note ${i + 1}: $e');
          }
        }
      } catch (e) {
        errors.add('$name: $e');
      }
    }
    return ImportBatch(notes, errors);
  }

  static int? _timestamp(dynamic value, dynamic micros) {
    if (micros is num) return (micros / 1000).round();
    if (value is num) return value.toInt();
    if (value is String) return DateTime.tryParse(value)?.millisecondsSinceEpoch;
    return null;
  }

  static String? _normalizeColor(dynamic value) {
    const colors = {
      'DEFAULT': '#ffffff', 'RED': '#f28b82', 'ORANGE': '#fbbc04',
      'YELLOW': '#fff475', 'GREEN': '#ccff90', 'TEAL': '#a7ffeb',
      'BLUE': '#cbf0f8', 'DARK_BLUE': '#aecbfa', 'PURPLE': '#d7aefb',
      'PINK': '#fdcfe8', 'BROWN': '#e6c9a8', 'GRAY': '#e8eaed',
    };
    if (value is! String) return null;
    return colors[value.toUpperCase()] ??
        (RegExp(r'^#[0-9a-fA-F]{6}$').hasMatch(value) ? value.toLowerCase() : null);
  }
}
