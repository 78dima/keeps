import 'dart:async';
import 'package:flutter/material.dart';
import '../models/note.dart';
import '../platform/native_store.dart';
import '../platform/note_draft.dart';
import 'keep_icon.dart';
import 'style.dart';
import 'tag_field.dart';

class CreateNote extends StatefulWidget {
  const CreateNote({super.key, required this.store, required this.onCreated});
  final NativeStore store;
  final Future<void> Function() onCreated;
  @override
  State<CreateNote> createState() => _CreateNoteState();
}

class _CreateNoteState extends State<CreateNote> {
  final _title = TextEditingController(), _content = TextEditingController(), _tag = TextEditingController();
  final _bounds = GlobalKey(), _tapGroup = Object();
  final _focus = FocusScopeNode();
  NoteDraft _draft = NoteDraft();
  List<String> _tags = [];
  String? _color, _error;
  DateTime? _reminder;
  Map<String, dynamic>? _permissions;
  bool _expanded = false, _saving = false, _selecting = false;
  PointerDownEvent? _outsideDown;
  bool get _busy => _saving || _selecting;
  bool get _hasText => _title.text.trim().isNotEmpty || _content.text.trim().isNotEmpty;

  @override
  void dispose() {
    _focus.dispose(); _title.dispose(); _content.dispose(); _tag.dispose();
    super.dispose();
  }

  void _clear() {
    if (_focus.hasFocus) _focus.unfocus();
    _title.clear(); _content.clear(); _tag.clear();
    setState(() {
      _tags = []; _color = null; _reminder = null; _permissions = null;
      _expanded = false; _error = null; _outsideDown = null; _draft = NoteDraft();
    });
  }

  bool _isOutside(Offset position) {
    final box = _bounds.currentContext?.findRenderObject();
    return box is RenderBox && box.hasSize &&
        !(Offset.zero & box.size).contains(box.globalToLocal(position));
  }

  void _outsideStart(PointerDownEvent event) {
    _outsideDown = _expanded && !_busy && _isOutside(event.position) ? event : null;
  }

  void _outsideEnd(PointerUpEvent event) {
    final start = _outsideDown;
    _outsideDown = null;
    if (start == null || start.pointer != event.pointer ||
        (event.position - start.position).distance > 18 ||
        event.timeStamp - start.timeStamp > const Duration(milliseconds: 600)) return;
    final draft = _draft;
    // Finish the pointer event first. A field tap, scroll, dialog or keyboard
    // transition must not collapse the form or save into the next draft.
    scheduleMicrotask(() {
      if (!mounted || !_expanded || _busy || draft != _draft ||
          ModalRoute.of(context)?.isCurrent != true || !_isOutside(event.position)) return;
      if (_hasText) { unawaited(_save()); } else { _clear(); }
    });
  }

  Future<void> _save() async {
    if (_busy || !_hasText) return;
    if (_reminder != null && !_reminder!.isAfter(DateTime.now())) {
      setState(() => _error = 'Choose a future reminder time.'); return;
    }
    setState(() { _saving = true; _error = null; _outsideDown = null; });
    try {
      await _draft.save(widget.store, {
        'title': _title.text, 'content': _content.text,
        'tags': {..._tags, if (_tag.text.trim().isNotEmpty) _tag.text.trim()}.toList(),
        'color': _color, 'reminderDate': _reminder?.millisecondsSinceEpoch,
      });
      if (mounted) _clear();
      await widget.onCreated();
    } catch (e) {
      if (mounted) setState(() => _error = 'Could not create note: $e');
    } finally { if (mounted) setState(() => _saving = false); }
  }

  Future<void> _pickReminder() async {
    if (_busy) return;
    setState(() { _selecting = true; _outsideDown = null; });
    _focus.unfocus();
    try {
      final date = await widget.store.pickReminder(_reminder);
      if (!mounted || date == null) return;
      if (!date.isAfter(DateTime.now())) { setState(() => _error = 'Choose a future time.'); return; }
      setState(() { _reminder = date; _error = null; });
      final status = await widget.store.requestNotifications();
      if (mounted) setState(() => _permissions = status);
    } catch (e) {
      if (mounted) setState(() => _error = 'Could not set reminder: $e');
    } finally { if (mounted) setState(() => _selecting = false); }
  }

  Future<void> _settings(String kind) async {
    if (_busy) return;
    setState(() { _selecting = true; _outsideDown = null; });
    _focus.unfocus();
    try { await widget.store.openSettings(kind); }
    catch (e) { if (mounted) setState(() => _error = e.toString()); }
    finally { if (mounted) setState(() => _selecting = false); }
  }

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(16, 0, 16, 32),
    child: Center(child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 600),
      child: TapRegion(
        groupId: _tapGroup, behavior: HitTestBehavior.opaque,
        onTapOutside: _outsideStart, onTapUpOutside: _outsideEnd,
        child: FocusScope(node: _focus, child: Surface(
          key: _bounds, radius: _expanded ? 32 : 40,
          color: _color == null ? Colors.white : noteColor(_color).withValues(alpha: 0.94),
          child: _expanded
            ? Padding(padding: const EdgeInsets.all(24), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                TextField(key: const Key('create-title'), groupId: _tapGroup, controller: _title, enabled: !_busy,
                  onChanged: (_) => setState(() {}),
                  style: heading.copyWith(fontSize: 20), textCapitalization: TextCapitalization.sentences,
                  decoration: const InputDecoration(hintText: 'Title', contentPadding: EdgeInsets.symmetric(vertical: 8))),
                TextField(key: const Key('create-content'), groupId: _tapGroup, controller: _content, enabled: !_busy, autofocus: true,
                  onChanged: (_) => setState(() {}),
                  minLines: 4, maxLines: null, style: const TextStyle(fontSize: 16, height: 1.6),
                  textCapitalization: TextCapitalization.sentences,
                  decoration: const InputDecoration(hintText: 'Take a note...')),
                const SizedBox(height: 12),
                TagField(tags: _tags, groupId: _tapGroup, controller: _tag, placeholder: 'Add tag...', enabled: !_busy,
                  onChanged: (tags) => setState(() => _tags = tags)),
                const SizedBox(height: 16),
                const Divider(height: 1, color: Color(0x0d000000)),
                const SizedBox(height: 12),
                Wrap(crossAxisAlignment: WrapCrossAlignment.center, spacing: 8, children: [
                  const KeepIcon(KeepGlyph.calendar, size: 14),
                  const Text('REMINDER', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 1.5, color: muted)),
                  TextButton(key: const Key('create-reminder'), onPressed: _busy ? null : _pickReminder,
                    style: TextButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 8)),
                    child: Text(_reminder == null ? 'Set date & time' : reminderLabel(_reminder!), style: const TextStyle(fontSize: 12))),
                  if (_reminder != null) ...[
                    const Tooltip(message: 'Уведомление будет отправлено', child: Icon(Icons.notifications_outlined, size: 18, color: Color(0xffb45309))),
                    IconAction(glyph: KeepGlyph.close, label: 'Clear reminder', size: 32,
                      onPressed: _busy ? null : () => setState(() => _reminder = null)),
                  ],
                ]),
                if (_reminder != null && _permissions?['notifications'] == false)
                  TextButton(onPressed: _busy ? null : () => _settings('notifications'), child: const Text('Enable notifications in Android settings', style: TextStyle(fontSize: 12))),
                if (_reminder != null && _permissions?['exactAlarms'] == false)
                  TextButton(onPressed: _busy ? null : () => _settings('exact'), child: const Text('Allow precise reminders in Android settings', style: TextStyle(fontSize: 12))),
                SizedBox(height: 44, child: ListView.separated(scrollDirection: Axis.horizontal,
                  itemCount: noteColors.length, separatorBuilder: (_, _) => const SizedBox(width: 10),
                  itemBuilder: (context, index) {
                    final color = noteColors[index], selected = (_color ?? '#ffffff') == color;
                    return Center(child: Semantics(button: true, selected: selected, label: 'Select color $color',
                      child: InkWell(key: Key('create-color-$color'), customBorder: const CircleBorder(),
                        onTap: _busy ? null : () => setState(() => _color = color == '#ffffff' ? null : color),
                        child: Container(width: 28, height: 28, decoration: BoxDecoration(
                          color: noteColor(color), shape: BoxShape.circle,
                          border: Border.all(color: selected ? const Color(0x55000000) : const Color(0x80ffffff), width: 2),
                          boxShadow: const [BoxShadow(color: Color(0x10000000), blurRadius: 3, offset: Offset(0, 1))]),
                        ),
                      ),
                    ));
                  })),
                if (_error != null) Text(_error!, style: const TextStyle(color: Colors.red)),
                const SizedBox(height: 24),
                Align(alignment: Alignment.centerRight, child: Wrap(alignment: WrapAlignment.end, spacing: 8, runSpacing: 8, children: [
                  TextButton(key: const Key('create-close'), onPressed: _busy ? null : () { _clear(); unawaited(widget.onCreated()); }, child: const Text('Close')),
                  FilledButton(key: const Key('create-save'), onPressed: _busy || !_hasText ? null : _save,
                    child: Text(_saving ? 'Creating...' : 'Create')),
                ])),
              ]))
            : Material(color: Colors.transparent, child: InkWell(
                borderRadius: BorderRadius.circular(40), onTap: () => setState(() => _expanded = true),
                child: const SizedBox(height: 56, child: Padding(padding: EdgeInsets.only(left: 24, right: 16),
                  child: Row(children: [Expanded(child: Text('Take a note...', style: TextStyle(fontSize: 16, color: Color(0x9971717a), fontWeight: FontWeight.w500))), KeepIcon(KeepGlyph.plus)]))),
              )),
        )),
      ),
    )),
  );
}
