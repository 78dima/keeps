import 'dart:convert';
import 'dart:math';
import '../models/note.dart';
import 'native_store.dart';

/// One creation identity survives retries, including a lost native save reply.
class NoteDraft {
  final String creationId = _uuid();
  Map<String, Object?>? _firstAttempt;
  String? _savedId;

  Future<Note> save(NativeStore store, Map<String, Object?> fields) async {
    final snapshot = Map<String, Object?>.from(jsonDecode(jsonEncode(fields)) as Map);
    if (_savedId != null) return store.save({...snapshot, 'id': _savedId});
    _firstAttempt ??= snapshot;
    final created = await store.save({..._firstAttempt!, 'creationId': creationId});
    _savedId = created.id;
    // The user may have edited the draft after an uncertain first attempt.
    // Resolve that original creation first, then save the newer text to its ID.
    if (jsonEncode(snapshot) != jsonEncode(_firstAttempt)) {
      return store.save({...snapshot, 'id': _savedId});
    }
    return created;
  }

  static String _uuid() {
    final random = Random.secure();
    final bytes = List<int>.generate(16, (_) => random.nextInt(256));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    final hex = bytes.map((value) => value.toRadixString(16).padLeft(2, '0')).join();
    return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
  }
}
