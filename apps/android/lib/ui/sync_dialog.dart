import 'dart:async';
import 'package:flutter/material.dart';
import '../platform/native_store.dart';

class SyncDialog extends StatefulWidget {
  const SyncDialog({super.key, required this.store});
  final NativeStore store;
  @override State<SyncDialog> createState() => _SyncDialogState();
}
class _SyncDialogState extends State<SyncDialog> {
  final _email = TextEditingController(), _password = TextEditingController();
  Map<String, dynamic> _status = {};
  String? _error;
  bool _busy = false;
  Timer? _timer;
  @override void initState() {
    super.initState();
    unawaited(_refresh());
    _timer = Timer.periodic(const Duration(seconds: 2), (_) { if (!_busy) unawaited(_refresh()); });
  }
  @override void dispose() { _timer?.cancel(); _email.dispose(); _password.dispose(); super.dispose(); }
  Future<void> _refresh() async {
    try {
      final status = await widget.store.syncStatus();
      if (mounted) setState(() => _status = status);
    } catch (e) { if (mounted) setState(() => _error = e.toString()); }
  }
  Future<void> _action(Future<void> Function() action) async {
    setState(() { _busy = true; _error = null; });
    try { await action(); await _refresh(); }
    catch (e) { if (mounted) setState(() => _error = e.toString()); }
    finally { if (mounted) setState(() => _busy = false); }
  }
  @override Widget build(BuildContext context) {
    final signedIn = _status['signedIn'] == true;
    final pending = _status['pending'] as int? ?? 0;
    final serverError = _status['error'] as String? ?? '';
    return AlertDialog(
      title: const Text('Синхронизация'),
      content: SizedBox(width: 380, child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        if (signedIn) ...[
          Text(_status['email'] as String? ?? '', style: const TextStyle(fontWeight: FontWeight.w600)),
          const SizedBox(height: 16),
          Text(_status['running'] == true ? 'Синхронизация…' : pending > 0 ? 'Ожидают отправки: $pending' : 'Все локальные изменения отправлены'),
          const SizedBox(height: 12),
          const Text('Без интернета заметки сохраняются на телефоне. При подключении изменения отправятся автоматически.'),
          const SizedBox(height: 16),
          FilledButton(onPressed: _busy ? null : () => _action(widget.store.syncNow), child: const Text('Синхронизировать сейчас')),
          TextButton(onPressed: _busy ? null : () async {
            final confirmed = await showDialog<bool>(context: context, builder: (context) => AlertDialog(
              title: const Text('Выйти из аккаунта?'),
              content: Text(pending > 0 ? 'На телефоне есть $pending неотправленных изменений. Они сохранятся здесь и отправятся после повторного входа в этот аккаунт.' : 'Заметки останутся на телефоне и станут доступны после повторного входа в этот аккаунт.'),
              actions: [TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Отмена')), TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Выйти'))],
            ));
            if (confirmed == true && mounted) await _action(widget.store.signOut);
          }, child: const Text('Выйти')),
        ] else ...[
          const Text('Войди в тот же аккаунт, что и в веб-версии MonoKeep. Локальные заметки этого устройства будут добавлены в аккаунт.'),
          const SizedBox(height: 16),
          TextField(controller: _email, enabled: !_busy, keyboardType: TextInputType.emailAddress,
            autofillHints: const [AutofillHints.email], decoration: const InputDecoration(labelText: 'Email')),
          const SizedBox(height: 12),
          TextField(controller: _password, enabled: !_busy, obscureText: true,
            autofillHints: const [AutofillHints.password], decoration: const InputDecoration(labelText: 'Пароль')),
          const SizedBox(height: 20),
          FilledButton(onPressed: _busy ? null : () => _action(() async {
            await widget.store.signIn(_email.text.trim(), _password.text);
            _password.clear();
          }), child: Text(_busy ? 'Вход…' : 'Войти')),
        ],
        if (_error != null || serverError.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 12), child: Text(_error ?? serverError, style: const TextStyle(color: Colors.red))),
      ]))),
      actions: [TextButton(onPressed: _busy ? null : () => Navigator.pop(context), child: const Text('Закрыть'))],
    );
  }
}
