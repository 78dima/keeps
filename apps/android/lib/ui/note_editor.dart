import 'dart:async';
import 'package:flutter/material.dart';
import '../platform/native_store.dart';
import '../models/note.dart';
import 'keep_icon.dart';
import 'style.dart';
import 'tag_field.dart';

class NoteEditor extends StatefulWidget {
  const NoteEditor({super.key, required this.store, this.note, this.resetReminder = false, this.sharedTitle, this.sharedContent});
  final NativeStore store;
  final Note? note;
  final bool resetReminder;
  final String? sharedTitle, sharedContent;
  @override
  State<NoteEditor> createState() => _NoteEditorState();
}

class _NoteEditorState extends State<NoteEditor> with WidgetsBindingObserver {
  late final _title = TextEditingController(text: widget.note?.title ?? widget.sharedTitle);
  late final _content = TextEditingController(text: widget.note?.content ?? widget.sharedContent);
  final _tag = TextEditingController();
  late List<String> _tags = [...?widget.note?.tags];
  late String? _color = widget.note?.color;
  late DateTime? _reminder = widget.resetReminder ? null : widget.note?.reminderDate;
  Map<String, dynamic>? _permissions;
  bool _saving = false;
  bool _notifyTouched = false;
  late bool _notifyEnabled = (widget.note?.reminderEnabled ?? true) && !(widget.note?.isReminderSent ?? false);
  String? _error;

  @override
  void initState() { super.initState(); WidgetsBinding.instance.addObserver(this); unawaited(_loadPermissions()); }
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) { if (state == AppLifecycleState.resumed) unawaited(_loadPermissions()); }
  Future<void> _loadPermissions() async {
    try {
      final status = await widget.store.notificationStatus();
      if (mounted) setState(() => _permissions = status);
    } catch (_) { /* Saving still reports any native failure. */ }
  }
  @override
  void dispose() { WidgetsBinding.instance.removeObserver(this); _title.dispose(); _content.dispose(); _tag.dispose(); super.dispose(); }

  Future<void> _pickReminder() async {
    try {
      final date = await widget.store.pickReminder(_reminder);
      if (!mounted || date == null) return;
      if (!date.isAfter(DateTime.now())) { setState(() => _error = 'Choose a future time.'); return; }
      setState(() { _reminder = date; _error = null; _notifyEnabled = true; _notifyTouched = true; });
      final status = await widget.store.requestNotifications();
      if (mounted) setState(() => _permissions = status);
    } catch (e) { if (mounted) setState(() => _error = 'Could not set reminder: $e'); }
  }

  Future<void> _settings(String kind) async {
    try { await widget.store.openSettings(kind); }
    catch (e) { if (mounted) setState(() => _error = e.toString()); }
  }

  Future<void> _save({bool? archive}) async {
    if (_saving) return;
    if (_title.text.trim().isEmpty && _content.text.trim().isEmpty) {
      setState(() => _error = 'Add a title or a note.'); return;
    }
    if (_reminder != null && _reminder != widget.note?.reminderDate && !_reminder!.isAfter(DateTime.now())) {
      setState(() => _error = 'Choose a future reminder time.'); return;
    }
    setState(() { _saving = true; _error = null; });
    try {
      final pendingTag = _tag.text.trim();
      final tags = <String>{..._tags, if (pendingTag.isNotEmpty) pendingTag}.toList();
      // Send edited fields only, so background notification/pin changes are retained.
      final patch = <String, Object?>{
        if (widget.note != null) 'id': widget.note!.id,
        'title': _title.text, 'content': _content.text, 'tags': tags, 'color': _color,
        'reminderDate': _reminder?.millisecondsSinceEpoch,
        if (_notifyTouched) 'reminderEnabled': _notifyEnabled,
        if (archive != null) 'isArchived': archive,
      };
      await widget.store.save(patch);
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (mounted) setState(() { _saving = false; _error = 'Could not save. Your text is still here.\n$e'; });
    }
  }

  @override
  Widget build(BuildContext context) {
    final available = MediaQuery.sizeOf(context).height - MediaQuery.viewInsetsOf(context).bottom;
    return PopScope(
      canPop: !_saving,
      child: Dialog(
        backgroundColor: noteColor(_color).withValues(alpha: 0.97),
        surfaceTintColor: Colors.transparent,
        insetPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 24),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(32)),
        clipBehavior: Clip.antiAlias,
        child: ConstrainedBox(constraints: BoxConstraints(maxWidth: 700, maxHeight: (available * 0.9).clamp(180.0, 1000.0).toDouble()),
          child: Stack(children: [
            Column(mainAxisSize: MainAxisSize.min, children: [
              Flexible(child: SingleChildScrollView(padding: const EdgeInsets.fromLTRB(28, 40, 28, 8), child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Padding(padding: const EdgeInsets.only(right: 20), child: TextField(
                    key: const Key('editor-title'), controller: _title, enabled: !_saving,
                    style: heading.copyWith(fontSize: 30), maxLines: null,
                    textCapitalization: TextCapitalization.sentences,
                    decoration: const InputDecoration(hintText: 'Title'),
                  )),
                  const SizedBox(height: 16),
                  TextField(key: const Key('editor-content'), controller: _content, enabled: !_saving,
                    minLines: 6, maxLines: null, style: const TextStyle(fontSize: 18, height: 1.6, color: Color(0xcc1c1c1e)),
                    textCapitalization: TextCapitalization.sentences,
                    decoration: const InputDecoration(hintText: 'Note')),
                  const SizedBox(height: 24),
                  TagField(tags: _tags, controller: _tag, enabled: !_saving, onChanged: (tags) => setState(() => _tags = tags)),
                  const SizedBox(height: 28),
                  Wrap(crossAxisAlignment: WrapCrossAlignment.center, spacing: 8, children: [
                    const KeepIcon(KeepGlyph.calendar, size: 14),
                    const Text('REMINDER', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 1.5, color: muted)),
                    TextButton(onPressed: _saving ? null : _pickReminder,
                      style: TextButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 8)),
                      child: Text(_reminder == null ? 'Set date & time' : reminderLabel(_reminder!), style: const TextStyle(fontSize: 12))),
                    if (_reminder != null) IconButton(
                      tooltip: _notifyEnabled ? 'Уведомление будет отправлено' : 'Уведомление отключено — нажмите чтобы включить',
                      icon: Icon(_notifyEnabled ? Icons.notifications_outlined : Icons.notifications_off_outlined, size: 18),
                      color: _notifyEnabled ? const Color(0xffb45309) : muted,
                      onPressed: _saving ? null : () => setState(() { _notifyEnabled = !_notifyEnabled; _notifyTouched = true; }),
                    ),
                    if (_reminder != null) IconAction(glyph: KeepGlyph.close, label: 'Clear reminder', size: 32,
                      onPressed: _saving ? null : () => setState(() => _reminder = null)),
                  ]),
                  if (_reminder != null && _permissions?['notifications'] == false)
                    TextButton(onPressed: () => _settings('notifications'), child: const Text('Enable notifications in Android settings', style: TextStyle(fontSize: 12))),
                  if (_reminder != null && _permissions?['exactAlarms'] == false)
                    TextButton(onPressed: () => _settings('exact'), child: const Text('Allow precise reminders in Android settings', style: TextStyle(fontSize: 12))),
                  const SizedBox(height: 12),
                  SizedBox(height: 56, child: ListView.separated(scrollDirection: Axis.horizontal,
                    itemCount: noteColors.length, separatorBuilder: (_, _) => const SizedBox(width: 10),
                    itemBuilder: (context, index) {
                      final value = noteColors[index];
                      final selected = (_color ?? '#ffffff') == value;
                      return Center(child: Semantics(button: true, selected: selected, label: 'Select color $value',
                        child: InkWell(onTap: _saving ? null : () => setState(() => _color = value), customBorder: const CircleBorder(),
                          child: Container(width: 38, height: 38,
                            decoration: BoxDecoration(color: noteColor(value), shape: BoxShape.circle,
                              border: Border.all(color: selected ? const Color(0x55000000) : const Color(0x80ffffff), width: 2),
                              boxShadow: const [BoxShadow(color: Color(0x10000000), blurRadius: 3, offset: Offset(0, 1))]),
                            child: selected ? const Center(child: KeepIcon(KeepGlyph.check, size: 18, color: foreground)) : null,
                          ),
                        ),
                      ));
                    })),
                  if (_error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(_error!, style: const TextStyle(color: Colors.red))),
                ],
              ))),
              Container(padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
                decoration: const BoxDecoration(gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter,
                  colors: [Colors.transparent, Color(0x08000000)])),
                child: Wrap(alignment: WrapAlignment.end, spacing: 4, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
                  if (widget.note != null) IconAction(glyph: KeepGlyph.share, label: 'Share note', onPressed: _saving ? null : () async {
                    try { await widget.store.share(widget.note!); }
                    catch (e) { if (mounted) setState(() => _error = e.toString()); }
                  }),
                  if (widget.note != null) IconAction(glyph: widget.note!.isArchived ? KeepGlyph.restore : KeepGlyph.archive,
                    label: widget.note!.isArchived ? 'Unarchive' : 'Archive',
                    onPressed: _saving ? null : () => _save(archive: !widget.note!.isArchived)),
                  TextButton(onPressed: _saving ? null : () => Navigator.of(context).pop(false), child: const Text('Cancel')),
                  FilledButton(key: const Key('editor-save'), onPressed: _saving ? null : _save, child: Text(_saving ? 'Saving...' : 'Save')),
                ])),
            ]),
            Positioned(top: 12, right: 12, child: IconAction(glyph: KeepGlyph.close, label: 'Close',
              onPressed: _saving ? null : () => Navigator.of(context).pop(false))),
          ]),
        ),
      ),
    );
  }
}
