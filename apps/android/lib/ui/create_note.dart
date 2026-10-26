import 'dart:async';
import 'package:flutter/material.dart';
import '../platform/native_store.dart';
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
  List<String> _tags = [];
  bool _expanded = false, _saving = false;
  String? _error;
  @override
  void dispose() { _title.dispose(); _content.dispose(); _tag.dispose(); super.dispose(); }
  void _clear() {
    _title.clear(); _content.clear(); _tag.clear();
    setState(() { _tags = []; _expanded = false; _error = null; });
  }
  Future<void> _save() async {
    if (_saving) return;
    if (_title.text.trim().isEmpty && _content.text.trim().isEmpty) { _clear(); return; }
    setState(() { _saving = true; _error = null; });
    try {
      await widget.store.save({
        'title': _title.text, 'content': _content.text,
        'tags': {..._tags, if (_tag.text.trim().isNotEmpty) _tag.text.trim()}.toList(),
      });
      if (mounted) _clear();
      await widget.onCreated();
    } catch (e) {
      if (mounted) setState(() => _error = 'Could not create note: $e');
    } finally { if (mounted) setState(() => _saving = false); }
  }

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(16, 0, 16, 32),
    child: Center(child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 600),
      child: TapRegion(
        onTapOutside: (_) { if (_expanded && !_saving) unawaited(_save()); },
        child: Surface(radius: _expanded ? 32 : 40, child: _expanded
          ? Padding(padding: const EdgeInsets.all(24), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              TextField(key: const Key('create-title'), controller: _title, enabled: !_saving,
                style: heading.copyWith(fontSize: 20), textCapitalization: TextCapitalization.sentences,
                decoration: const InputDecoration(hintText: 'Title', contentPadding: EdgeInsets.symmetric(vertical: 8))),
              TextField(key: const Key('create-content'), controller: _content, enabled: !_saving, autofocus: true,
                minLines: 4, maxLines: null, style: const TextStyle(fontSize: 16, height: 1.6),
                textCapitalization: TextCapitalization.sentences,
                decoration: const InputDecoration(hintText: 'Take a note...')),
              const SizedBox(height: 12),
              TagField(tags: _tags, controller: _tag, placeholder: 'Add tag...', enabled: !_saving, onChanged: (tags) => setState(() => _tags = tags)),
              if (_error != null) Text(_error!, style: const TextStyle(color: Colors.red)),
              const SizedBox(height: 24),
              Row(mainAxisAlignment: MainAxisAlignment.end, children: [
                TextButton(onPressed: _saving ? null : _clear, child: const Text('Close')),
                const SizedBox(width: 8),
                FilledButton(onPressed: _saving ? null : _save, child: Text(_saving ? 'Creating...' : 'Create')),
              ]),
            ]))
          : Material(color: Colors.transparent, child: InkWell(
              borderRadius: BorderRadius.circular(40), onTap: () => setState(() => _expanded = true),
              child: const SizedBox(height: 56, child: Padding(padding: EdgeInsets.only(left: 24, right: 16),
                child: Row(children: [Expanded(child: Text('Take a note...', style: TextStyle(fontSize: 16, color: Color(0x9971717a), fontWeight: FontWeight.w500))), KeepIcon(KeepGlyph.plus)]))),
            )),
        ),
      ),
    )),
  );
}
