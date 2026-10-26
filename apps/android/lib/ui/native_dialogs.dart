import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import '../platform/native_store.dart';
import '../models/note.dart';
import 'keep_icon.dart';
import 'style.dart';

class ImportNotesDialog extends StatefulWidget {
  const ImportNotesDialog({super.key, required this.store});
  final NativeStore store;
  @override
  State<ImportNotesDialog> createState() => _ImportNotesDialogState();
}

class _ImportNotesDialogState extends State<ImportNotesDialog> {
  bool _busy = false;
  String? _message;
  List<String> _errors = [];
  Future<void> _import() async {
    setState(() { _busy = true; _message = null; _errors = []; });
    try {
      final files = await widget.store.pickFiles();
      if (files.isEmpty) return;
      // JSON decoding can be large; keep it off the UI isolate.
      final batch = await compute(_parseFiles, files);
      if (batch.notes.isEmpty) {
        if (mounted) setState(() { _message = 'No valid notes found'; _errors = batch.errors; });
        return;
      }
      final counts = await widget.store.importNotes(batch.notes);
      if (mounted) setState(() {
        _message = 'Imported ${counts['imported']} notes. Skipped ${counts['skipped']} duplicates.';
        _errors = batch.errors;
      });
    } catch (e) { if (mounted) setState(() => _message = 'Import failed: $e'); }
    finally { if (mounted) setState(() => _busy = false); }
  }
  @override
  Widget build(BuildContext context) => PopScope(canPop: !_busy, child: AlertDialog(
    title: Text('Import from Google Keep', style: heading.copyWith(fontSize: 22)),
    content: SizedBox(width: 380, child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
      const Text('Select your Google Keep JSON files (exported via Google Takeout). You can select multiple files at once. MonoKeep backups are also supported.'),
      const SizedBox(height: 24),
      OutlinedButton(onPressed: _busy ? null : _import,
        style: OutlinedButton.styleFrom(minimumSize: const Size(double.infinity, 128), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12))),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          if (_busy) const SizedBox.square(dimension: 28, child: CircularProgressIndicator(strokeWidth: 2)) else const KeepIcon(KeepGlyph.upload, size: 28),
          const SizedBox(height: 12), Text(_busy ? 'Importing...' : 'Choose JSON files'),
        ])),
      if (_message != null) Padding(padding: const EdgeInsets.only(top: 16), child: Text(_message!)),
      if (_errors.isNotEmpty) ...[
        const SizedBox(height: 12),
        Text('${_errors.length} files or notes could not be imported.', style: const TextStyle(color: Colors.red)),
        for (final error in _errors.take(5)) Padding(padding: const EdgeInsets.only(top: 4), child: Text(error, style: const TextStyle(fontSize: 12, color: muted))),
      ],
    ]))),
    actions: [TextButton(onPressed: _busy ? null : () => Navigator.of(context).pop(), child: Text(_message == null ? 'Cancel' : 'Close'))],
  ));
}

ImportBatch _parseFiles(List<Map<String, dynamic>> files) => ImportBatch.parse(files);

class NotificationSettings extends StatefulWidget {
  const NotificationSettings({super.key, required this.store});
  final NativeStore store;
  @override
  State<NotificationSettings> createState() => _NotificationSettingsState();
}

class _NotificationSettingsState extends State<NotificationSettings> with WidgetsBindingObserver {
  Map<String, dynamic>? _status;
  String? _error;
  @override
  void initState() { super.initState(); WidgetsBinding.instance.addObserver(this); unawaited(_refresh()); }
  @override
  void dispose() { WidgetsBinding.instance.removeObserver(this); super.dispose(); }
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) { if (state == AppLifecycleState.resumed) unawaited(_refresh()); }
  Future<void> _refresh() async {
    try { final status = await widget.store.notificationStatus(); if (mounted) setState(() => _status = status); }
    catch (e) { if (mounted) setState(() => _error = e.toString()); }
  }
  Future<void> _enable(String kind) async {
    try {
      if (kind == 'notifications') {
        final status = await widget.store.requestNotifications();
        if (status['notifications'] == true) { await _refresh(); return; }
      }
      await widget.store.openSettings(kind);
    } catch (e) { if (mounted) setState(() => _error = e.toString()); }
  }
  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text('Настройка уведомлений', style: heading.copyWith(fontSize: 22)),
    content: SizedBox(width: 380, child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
      const Text('Напоминания приходят на этот телефон, даже когда приложение закрыто. Подключение к интернету не требуется.'),
      const SizedBox(height: 20),
      ListTile(contentPadding: EdgeInsets.zero, leading: const KeepIcon(KeepGlyph.bell),
        title: const Text('Уведомления'), subtitle: Text(_status == null ? 'Проверка…' : _status!['notifications'] == true ? 'Разрешены' : 'Выключены'),
        trailing: TextButton(onPressed: () => _enable('notifications'), child: const Text('Настроить'))),
      ListTile(contentPadding: EdgeInsets.zero, leading: const KeepIcon(KeepGlyph.calendar),
        title: const Text('Точное время'), subtitle: Text(_status == null ? 'Проверка…' : _status!['exactAlarms'] == true ? 'Разрешено' : 'Android может задерживать напоминания'),
        trailing: TextButton(onPressed: () => _enable('exact'), child: const Text('Настроить'))),
      const SizedBox(height: 12),
      const Text('После принудительной остановки приложения в настройках Android откройте MonoKeep снова, чтобы восстановить напоминания.', style: TextStyle(fontSize: 12, color: muted)),
      if (_error != null) Text(_error!, style: const TextStyle(color: Colors.red)),
    ]))),
    actions: [TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Закрыть'))],
  );
}
