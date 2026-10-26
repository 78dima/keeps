import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'keep_icon.dart';

class TagField extends StatefulWidget {
  const TagField({super.key, required this.tags, required this.onChanged, this.enabled = true, this.controller, this.placeholder = '+ Add tag'});
  final List<String> tags;
  final ValueChanged<List<String>> onChanged;
  final bool enabled;
  final TextEditingController? controller;
  final String placeholder;
  @override
  State<TagField> createState() => _TagFieldState();
}

class _TagFieldState extends State<TagField> {
  late final TextEditingController _controller = widget.controller ?? TextEditingController();
  final _focus = FocusNode();
  @override
  void initState() { super.initState(); _focus.addListener(_onFocus); }
  void _onFocus() { if (!_focus.hasFocus) _add(); }
  void _add() {
    final value = _controller.text.trim();
    if (!widget.enabled || value.isEmpty) return;
    if (!widget.tags.contains(value)) widget.onChanged([...widget.tags, value]);
    _controller.clear();
  }
  @override
  void dispose() { _focus.removeListener(_onFocus); _focus.dispose(); if (widget.controller == null) _controller.dispose(); super.dispose(); }
  @override
  Widget build(BuildContext context) => Wrap(spacing: 8, runSpacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
    for (final tag in widget.tags) Container(
      padding: const EdgeInsets.only(left: 8),
      decoration: BoxDecoration(color: const Color(0xfff3f4f6), borderRadius: BorderRadius.circular(20)),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Flexible(child: Text(tag, style: const TextStyle(fontSize: 12))),
        IconAction(glyph: KeepGlyph.close, label: 'Remove $tag', size: 32,
          onPressed: widget.enabled ? () => widget.onChanged(widget.tags.where((t) => t != tag).toList()) : null),
      ]),
    ),
    SizedBox(width: 140, child: Focus(onKeyEvent: (_, event) {
      if (widget.enabled && event is KeyDownEvent && event.logicalKey == LogicalKeyboardKey.backspace && _controller.text.isEmpty && widget.tags.isNotEmpty) {
        widget.onChanged(widget.tags.sublist(0, widget.tags.length - 1));
        return KeyEventResult.handled;
      }
      return KeyEventResult.ignored;
    }, child: TextField(
      controller: _controller, focusNode: _focus, enabled: widget.enabled,
      style: const TextStyle(fontSize: 14), textInputAction: TextInputAction.done,
      decoration: InputDecoration(hintText: widget.tags.isEmpty ? widget.placeholder : '', isDense: true, contentPadding: const EdgeInsets.symmetric(vertical: 8)),
      onSubmitted: (_) { _add(); _focus.requestFocus(); },
    ))),
  ]);
}
