import 'dart:async';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'platform/native_store.dart';
import 'models/note.dart';
import 'ui/balanced_columns.dart';
import 'ui/create_note.dart';
import 'ui/keep_icon.dart';
import 'ui/native_dialogs.dart';
import 'ui/note_card.dart';
import 'ui/note_editor.dart';
import 'ui/style.dart';
import 'ui/sync_dialog.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
    statusBarColor: Colors.transparent, statusBarIconBrightness: Brightness.dark,
    systemNavigationBarColor: background, systemNavigationBarIconBrightness: Brightness.dark,
  ));
  runApp(MonoKeepApp());
}

class MonoKeepApp extends StatelessWidget {
  MonoKeepApp({super.key, NativeStore? store}) : store = store ?? NativeStore();
  final NativeStore store;
  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'MonoKeep', debugShowCheckedModeBanner: false,
    theme: monoTheme(), themeMode: ThemeMode.light, home: NotesScreen(store: store),
  );
}

class NotesScreen extends StatefulWidget {
  const NotesScreen({super.key, required this.store});
  final NativeStore store;
  @override
  State<NotesScreen> createState() => _NotesScreenState();
}

class _NotesScreenState extends State<NotesScreen> with WidgetsBindingObserver {
  final _scaffold = GlobalKey<ScaffoldState>();
  final _search = TextEditingController();
  List<Note> _notes = [];
  final _busy = <String>{};
  NoteView _view = NoteView.active;
  String _query = '';
  String _tierFilter = 'all';
  String? _colorFilter;
  String? _error;
  bool _loading = true, _editing = false, _exporting = false;
  Map<String, dynamic>? _queuedIntent;
  Timer? _debounce;
  Timer? _reloadTimer;
  Future<void>? _reloadFuture;
  bool _reloadAgain = false;
  final _cardCache = <String, (Note, bool, Widget)>{};

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    NativeStore.channel.setMethodCallHandler((call) async {
      if (call.method == 'notesChanged') _queueReload();
      if (call.method == 'openIntent') await _openIntent(Map<String, dynamic>.from(call.arguments as Map));
    });
    unawaited(_start());
  }
  Future<void> _start() async {
    await _resume();
    try {
      final intent = await widget.store.initialIntent();
      if (intent != null && mounted) await _openIntent(intent);
    } catch (e) { _toast('Could not open note: $e'); }
  }
  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    NativeStore.channel.setMethodCallHandler(null);
    _search.dispose(); _debounce?.cancel(); _reloadTimer?.cancel(); super.dispose();
  }
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) unawaited(_resume());
  }
  Future<void> _resume() async {
    try { await widget.store.reschedule(); }
    catch (e) { _toast('Could not restore reminders: $e'); }
    await _reload();
  }
  void _queueReload() {
    if (!mounted) return;
    if (_reloadFuture != null) { _reloadAgain = true; return; }
    _reloadTimer?.cancel();
    _reloadTimer = Timer(const Duration(milliseconds: 120), () => unawaited(_reload()));
  }
  Future<void> _reload() {
    _reloadTimer?.cancel();
    _reloadAgain = true;
    return _reloadFuture ??= _drainReloads().whenComplete(() { _reloadFuture = null; });
  }
  Future<void> _drainReloads() async {
    while (mounted && _reloadAgain) {
      _reloadAgain = false;
      try {
        final rows = await widget.store.list();
        if (!mounted || _reloadAgain) continue;
        final previous = {for (final note in _notes) note.id: note};
        final notes = [for (final row in rows)
          if (previous[row.id]?.sameValue(row) == true) previous[row.id]! else row]
          ..sort(Note.compare);
        final changed = notes.length != _notes.length ||
          Iterable<int>.generate(notes.length).any((i) => !identical(notes[i], _notes[i]));
        if (changed || _loading || _error != null) {
          final ids = notes.map((note) => note.id).toSet();
          _cardCache.removeWhere((id, _) => !ids.contains(id));
          setState(() { _notes = notes; _loading = false; _error = null; });
        }
      } catch (e) {
        if (mounted && !_reloadAgain) setState(() { _error = 'Could not load notes: $e'; _loading = false; });
      }
    }
  }
  void _toast(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }
  Future<void> _openIntent(Map<String, dynamic> intent) async {
    if (_editing) { _queuedIntent = intent; return; }
    if (intent['noteId'] != null) {
      await _reload();
      final matches = _notes.where((note) => note.id == intent['noteId'] && !note.isDeleted);
      if (matches.isNotEmpty && mounted) await _edit(matches.first);
      else _toast('This note is no longer available.');
    } else if (mounted) {
      await _edit(null, sharedTitle: intent['title'] as String?, sharedContent: intent['content'] as String?);
    }
  }
  Future<void> _edit(Note? note, {bool resetReminder = false, String? sharedTitle, String? sharedContent}) async {
    if (_editing) return;
    _editing = true;
    await showDialog<bool>(context: context, barrierDismissible: false,
      builder: (_) => NoteEditor(store: widget.store, note: note, resetReminder: resetReminder,
        sharedTitle: sharedTitle, sharedContent: sharedContent));
    _editing = false;
    await _reload();
    if (_queuedIntent != null && mounted) {
      final intent = _queuedIntent!; _queuedIntent = null; await _openIntent(intent);
    }
  }
  Future<void> _change(Note note, Map<String, Object?> patch, String? message) async {
    if (_busy.contains(note.id)) return;
    setState(() => _busy.add(note.id));
    try {
      await widget.store.save({'id': note.id, ...patch});
      await _reload();
      if (message != null) _toast(message);
    } catch (e) { _toast('Could not update note: $e'); }
    finally { if (mounted) setState(() => _busy.remove(note.id)); }
  }
  Future<void> _delete(Note note) async {
    if (!note.isDeleted) { await _change(note, {'isDeleted': true}, 'Note moved to trash'); return; }
    final confirmed = await showDialog<bool>(context: context, builder: (context) => AlertDialog(
      title: const Text('Delete forever?'),
      content: const Text('Are you sure you want to permanently delete this note? This action cannot be undone.'),
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Cancel')),
        TextButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Delete Forever', style: TextStyle(color: Colors.red))),
      ],
    ));
    if (confirmed != true || !mounted || _busy.contains(note.id)) return;
    setState(() => _busy.add(note.id));
    try { await widget.store.deleteForever(note.id); await _reload(); _toast('Note deleted forever'); }
    catch (e) { _toast('Could not delete note: $e'); }
    finally { if (mounted) setState(() => _busy.remove(note.id)); }
  }
  Future<void> _import() async {
    _closeDrawer();
    await showDialog<void>(context: context, barrierDismissible: false, builder: (_) => ImportNotesDialog(store: widget.store));
    await _reload();
  }
  Future<void> _export() async {
    _closeDrawer();
    if (_exporting) return;
    setState(() => _exporting = true);
    try { if (await widget.store.exportNotes()) _toast('Backup saved'); }
    catch (e) { _toast('Could not export notes: $e'); }
    finally { if (mounted) setState(() => _exporting = false); }
  }
  Future<void> _sync() async {
    _closeDrawer();
    await showDialog<void>(context: context, barrierDismissible: false, builder: (_) => SyncDialog(store: widget.store));
    await _reload();
  }
  Future<void> _settings() async {
    _closeDrawer();
    await showDialog<void>(context: context, builder: (_) => NotificationSettings(store: widget.store));
    await _resume();
  }
  void _closeDrawer() { if (_scaffold.currentState?.isDrawerOpen ?? false) _scaffold.currentState!.closeDrawer(); }
  void _setView(NoteView view) { _closeDrawer(); setState(() => _view = view); }

  Widget _sidebar(bool mobile) {
    final pinned = _notes.where((n) => n.isPinned && n.inView(NoteView.active)).toList()
      ..sort(Note.compare);
    Widget link(String text, KeepGlyph icon, VoidCallback action, {bool active = false}) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Material(color: active ? const Color(0x0d000000) : Colors.transparent, borderRadius: BorderRadius.circular(32),
        child: InkWell(borderRadius: BorderRadius.circular(32), onTap: action,
          child: Padding(padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            child: Row(children: [KeepIcon(icon, color: active ? foreground : muted), const SizedBox(width: 12),
              Flexible(child: Text(text, style: TextStyle(fontSize: 14, fontWeight: active ? FontWeight.w600 : FontWeight.w500, color: active ? foreground : muted)))])))),
    );
    return Glass(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      SizedBox(height: 60, child: Padding(padding: const EdgeInsets.only(left: 24, right: 8), child: Row(children: [
        Expanded(child: GestureDetector(onTap: () => _setView(NoteView.active),
          child: Text('MonoKeep', maxLines: 1, overflow: TextOverflow.ellipsis, style: heading.copyWith(fontSize: 20)))),
        const SizedBox(width: 8),
        Container(padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3), decoration: BoxDecoration(color: const Color(0x0d000000), borderRadius: BorderRadius.circular(20)), child: const Text('Pro', style: TextStyle(fontSize: 12, color: muted))),
        if (mobile) ...[const SizedBox(width: 8), IconAction(glyph: KeepGlyph.close, label: 'Close sidebar', onPressed: _closeDrawer)],
      ]))),
      Expanded(child: ListView.builder(
        padding: const EdgeInsets.fromLTRB(12, 24, 12, 16),
        itemCount: 3 + (pinned.isEmpty ? 0 : pinned.length + 1),
        itemBuilder: (context, index) {
          if (index == 0) return link('Notes', KeepGlyph.bulb, () => _setView(NoteView.active), active: _view == NoteView.active);
          if (index == 1) return link('Archive', KeepGlyph.archive, () => _setView(NoteView.archive), active: _view == NoteView.archive);
          if (index == 2) return link('Trash', KeepGlyph.trash, () => _setView(NoteView.trash), active: _view == NoteView.trash);
          if (index == 3) return const Padding(padding: EdgeInsets.fromLTRB(12, 36, 12, 8), child: Text('PINNED', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: muted, letterSpacing: 1.2)));
          final note = pinned[index - 4];
          return ListTile(key: ValueKey(note.id), dense: true, minLeadingWidth: 12, horizontalTitleGap: 8,
            leading: const KeepIcon(KeepGlyph.pin, size: 14),
            title: Text(note.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 14)),
            onTap: () { _closeDrawer(); unawaited(_edit(note)); });
        },
      )),
      Container(padding: const EdgeInsets.all(12), decoration: const BoxDecoration(border: Border(top: BorderSide(color: Color(0x0d000000)))),
        child: Column(children: [
          link('Import from Keep', KeepGlyph.upload, _import),
          link(_exporting ? 'Exporting...' : 'Export backup', KeepGlyph.download, _export),
          link('Синхронизация и аккаунт', KeepGlyph.checks, _sync),
          link('Уведомления Android', KeepGlyph.bell, _settings),
        ])),
    ]));
  }

  Widget _header(bool mobile) => Glass(opacity: 0.5, blur: false, child: SizedBox(height: 64,
    child: Padding(padding: const EdgeInsets.symmetric(horizontal: 16), child: Row(children: [
      if (mobile) ...[IconAction(glyph: KeepGlyph.menu, label: 'Open menu', onPressed: () => _scaffold.currentState?.openDrawer()), const SizedBox(width: 8)],
      Flexible(child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 400), child: Container(
        height: 40, padding: const EdgeInsets.symmetric(horizontal: 12),
        decoration: BoxDecoration(color: const Color(0x0d000000), borderRadius: BorderRadius.circular(30)),
        child: Row(children: [const KeepIcon(KeepGlyph.search, size: 16), const SizedBox(width: 12),
          Expanded(child: TextField(key: const Key('search'), controller: _search,
            style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500),
            decoration: const InputDecoration(hintText: 'Search notes...', isDense: true),
            onChanged: (value) { _debounce?.cancel(); _debounce = Timer(const Duration(milliseconds: 300), () { if (mounted) setState(() => _query = value); }); })),
        ]),
      ))),
      const SizedBox(width: 8),
      IconAction(glyph: KeepGlyph.bell, label: 'Notification settings', onPressed: _settings),
    ])),
  ));

  Widget _card(Note note) {
    final busy = _busy.contains(note.id);
    final cached = _cardCache.remove(note.id);
    if (cached != null && identical(cached.$1, note) && cached.$2 == busy) {
      _cardCache[note.id] = cached;
      return cached.$3;
    }
    final card = RepaintBoundary(key: ValueKey(note.id), child: NoteCard(
      note: note, busy: busy,
      onEdit: () => _edit(note), onResetReminder: () => _edit(note, resetReminder: true),
      onPin: () => _change(note, {'isPinned': !note.isPinned}, null),
      onDelete: () => _delete(note), onRestore: () => _change(note, {'isDeleted': false, 'isArchived': false}, 'Note restored')));
    _cardCache[note.id] = (note, busy, card);
    // Retain recent widgets, without retaining offscreen render objects or an unbounded cache.
    if (_cardCache.length > 128) _cardCache.remove(_cardCache.keys.first);
    return card;
  }

  Widget _cardsSliver(List<Note> notes, int columns) {
    if (columns > 1) return SliverToBoxAdapter(child: BalancedColumns(
      columns: columns, children: [for (final note in notes) _card(note)]));
    final indices = {for (var i = 0; i < notes.length; i++) notes[i].id: i};
    return SliverList(delegate: SliverChildBuilderDelegate(
      (context, index) => Padding(key: ValueKey(notes[index].id),
        padding: EdgeInsets.only(bottom: index == notes.length - 1 ? 0 : 16),
        child: _card(notes[index])),
      childCount: notes.length,
      findChildIndexCallback: (key) => key is ValueKey<String> ? indices[key.value] : null,
    ));
  }

  Widget _content(double viewport) {
    final available = _notes.where((note) => note.inView(_view) && note.matches(_query)).toList();
    final filtered = available.where((note) => _view != NoteView.active || _colorFilter == null || note.color == _colorFilter).toList();
    final colors = available.map((note) => note.color).whereType<String>().where((color) => color != '#ffffff').toSet();
    final pinned = filtered.where((note) => note.isPinned).toList();
    final others = filtered.where((note) => !note.isPinned).toList();
    final alarm = others.where((note) => note.reminderDate != null && note.reminderEnabled && note.isReminderSent).toList();
    final scheduled = others.where((note) => note.reminderDate != null && note.reminderEnabled && !note.isReminderSent).toList();
    final displayed = _view != NoteView.active || _tierFilter == 'all' ? others : _tierFilter == 'alarm' ? alarm : scheduled;
    final columns = viewport >= 1024 ? 3 : viewport >= 640 ? 2 : 1;
    const section = TextStyle(fontSize: 12, fontWeight: FontWeight.w700, letterSpacing: 1.2, color: muted);
    return LayoutBuilder(builder: (context, box) {
      final padding = viewport >= 1024 ? 32.0 : 16.0;
      final gutter = math.max(0.0, (box.maxWidth - 2 * padding - 1024) / 2);
      return RefreshIndicator(onRefresh: _resume, child: CustomScrollView(
      key: PageStorageKey(_view), physics: const AlwaysScrollableScrollPhysics(),
      slivers: [SliverPadding(
        padding: EdgeInsets.symmetric(vertical: padding, horizontal: padding + gutter),
          sliver: SliverMainAxisGroup(slivers: [
          SliverToBoxAdapter(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const SizedBox(height: 16),
          if (_view == NoteView.active) CreateNote(store: widget.store, onCreated: _reload)
          else Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 24), child: Text(_view == NoteView.trash ? 'Trash' : 'Archive', style: heading.copyWith(fontSize: 24))),
          if (_view == NoteView.active && available.isNotEmpty) ...[
            Wrap(spacing: 8, runSpacing: 8, children: [
              for (final item in [('all', 'All', filtered.length), ('alarm', '🔥 Alarm', alarm.length), ('scheduled', '⏰ Scheduled', scheduled.length)])
                ChoiceChip(key: Key('tier-${item.$1}'), label: Text('${item.$2}${item.$3 > 0 ? '  ${item.$3}' : ''}'), showCheckmark: false,
                  selected: _tierFilter == item.$1, selectedColor: foreground,
                  labelStyle: TextStyle(color: _tierFilter == item.$1 ? Colors.white : muted, fontSize: 14),
                  shape: const StadiumBorder(side: BorderSide.none), side: BorderSide.none,
                  onSelected: (_) => setState(() => _tierFilter = item.$1)),
            ]),
            if (colors.isNotEmpty || _colorFilter != null) ...[
              const SizedBox(height: 16),
              Wrap(spacing: 8, runSpacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
                ChoiceChip(label: const Text('All colors'), showCheckmark: false,
                  selected: _colorFilter == null, onSelected: (_) => setState(() => _colorFilter = null)),
                for (final color in colors) Semantics(key: Key('filter-color-$color'), button: true, selected: _colorFilter == color, label: 'Filter color $color',
                  child: InkWell(onTap: () => setState(() => _colorFilter = _colorFilter == color ? null : color),
                    customBorder: const CircleBorder(), child: Container(width: 26, height: 26,
                      decoration: BoxDecoration(color: noteColor(color), shape: BoxShape.circle,
                        border: Border.all(width: _colorFilter == color ? 3 : 1, color: _colorFilter == color ? foreground : const Color(0x1a000000)))))),
              ]),
            ],
            const SizedBox(height: 32),
          ],
          if (_error != null) Padding(padding: const EdgeInsets.all(24), child: Column(children: [Text(_error!), TextButton(onPressed: _reload, child: const Text('Retry'))])),
          if (_loading) const Padding(padding: EdgeInsets.all(60), child: Center(child: CircularProgressIndicator()))
          else if (filtered.isEmpty && _error == null) Padding(padding: const EdgeInsets.only(top: 80),
            child: Text(_query.isNotEmpty || _view == NoteView.active ? 'No notes found' : _view == NoteView.trash ? 'Trash is empty' : 'Archive is empty',
              textAlign: TextAlign.center, style: const TextStyle(color: muted)))
          ])),
          if (!_loading && filtered.isNotEmpty) ...[
          if (_view == NoteView.trash) _cardsSliver(filtered, columns)
          else ...[
            if (pinned.isNotEmpty) ...[
              const SliverToBoxAdapter(child: Padding(padding: EdgeInsets.only(left: 4, bottom: 16), child: Text('📌 PINNED', style: section))),
              _cardsSliver(pinned, columns),
            ],
            if (displayed.isNotEmpty) ...[
              SliverToBoxAdapter(child: Padding(padding: EdgeInsets.only(top: pinned.isNotEmpty ? 32 : 0, left: 4, bottom: 16), child: Text(_tierFilter == 'alarm' ? '🔥 ALARM' : _tierFilter == 'scheduled' ? '⏰ SCHEDULED' : '📄 NOTES', style: section))),
              _cardsSliver(displayed, columns),
            ],
          ],
          ],
          const SliverToBoxAdapter(child: SizedBox(height: 32)),
          ]),
      )],
    ));
    });
  }

  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;
    final mobile = width < 768;
    return Scaffold(key: _scaffold, resizeToAvoidBottomInset: true,
      drawer: mobile ? Drawer(width: math.min(256.0, width * 0.9), shape: const RoundedRectangleBorder(),
        backgroundColor: background, child: SafeArea(child: _sidebar(true))) : null,
      body: SafeArea(child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        if (!mobile) SizedBox(width: 256, child: _sidebar(false)),
        Expanded(child: Column(children: [_header(mobile), Expanded(child: _content(width))])),
      ])),
    );
  }
}
