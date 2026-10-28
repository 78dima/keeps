import 'package:flutter/material.dart';
import '../models/note.dart';
import 'keep_icon.dart';
import 'style.dart';

class NoteCard extends StatelessWidget {
  const NoteCard({super.key, required this.note, required this.onEdit, required this.onPin,
    required this.onDelete, required this.onRestore, required this.onResetReminder, this.busy = false});
  final Note note;
  final VoidCallback onEdit, onPin, onDelete, onRestore, onResetReminder;
  final bool busy;

  @override
  Widget build(BuildContext context) => Surface(
    color: note.color != null ? noteColor(note.color) : note.isPinned ? const Color(0xfff7faff) : Colors.white,
    pinned: note.isPinned,
    child: Material(color: Colors.transparent, child: InkWell(
      borderRadius: BorderRadius.circular(32), onTap: note.isDeleted ? null : onEdit,
      child: Stack(children: [
        Padding(padding: const EdgeInsets.all(20), child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(padding: const EdgeInsets.only(right: 64), child: Text(note.title,
              style: heading.copyWith(fontSize: 18, height: 1.2))),
            if (note.content.isNotEmpty) ...[
              const SizedBox(height: 16),
              Text(note.isPreview ? '${note.content.trimRight()}…' : note.content, maxLines: 10, overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 15, height: 1.625, color: Color(0xb31c1c1e))),
            ],
            if (note.reminderDate != null || note.isReminderSent || note.tags.isNotEmpty) ...[
              const SizedBox(height: 16),
              Wrap(spacing: 8, runSpacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
                if (note.isReminderSent && note.reminderEnabled) Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                  decoration: BoxDecoration(color: const Color(0xfffff0bf), border: Border.all(color: const Color(0xfffde68a)), borderRadius: BorderRadius.circular(20)),
                  child: Row(mainAxisSize: MainAxisSize.min, children: [
                    const KeepIcon(KeepGlyph.checks, size: 12, color: Color(0xffb45309)), const SizedBox(width: 6),
                    Flexible(child: Text(note.reminderDate == null ? 'Отправлено' : reminderLabel(note.reminderDate!), style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w600, color: Color(0xffb45309)))),
                  ]),
                ) else if (note.reminderDate != null) Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
                  decoration: BoxDecoration(color: const Color(0x0d000000), borderRadius: BorderRadius.circular(2)),
                  child: Text('${note.reminderEnabled ? '⏰' : '🔕'} ${reminderLabel(note.reminderDate!)}', style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: muted)),
                ),
                for (final tag in note.tags) Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                  decoration: BoxDecoration(color: const Color(0x08000000), borderRadius: BorderRadius.circular(20)),
                  child: Text('#$tag', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w500)),
                ),
              ]),
            ],
          ],
        )),
        Positioned(top: 8, right: 8, child: Row(children: [
          IconAction(glyph: note.isDeleted ? KeepGlyph.restore : KeepGlyph.pin,
            label: note.isDeleted ? 'Restore' : note.isPinned ? 'Unpin' : 'Pin',
            onPressed: busy ? null : note.isDeleted ? onRestore : onPin,
            color: note.isPinned && !note.isDeleted ? accent : muted, filled: note.isPinned, size: 36, tooltip: false),
          IconAction(glyph: KeepGlyph.trash, label: note.isDeleted ? 'Delete Forever' : 'Move to Trash',
            onPressed: busy ? null : onDelete, size: 36, tooltip: false),
        ])),
      ]),
    )),
  );
}
