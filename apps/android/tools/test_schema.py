#!/usr/bin/env python3
"""Offline checks of the real shipped SQLite schema and platform wiring.

These checks do NOT compile Dart/Java or replace Android instrumentation tests.
"""
import pathlib
import re
import sqlite3
import tempfile
import unittest
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCHEMA = ROOT / 'android/app/src/main/assets/schema.sql'
ANDROID = '{http://schemas.android.com/apk/res/android}'


class StorageContract(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.executescript(SCHEMA.read_text())
        self.db.executescript((SCHEMA.parent / 'sync-migration.sql').read_text())
        self.db.executescript((SCHEMA.parent / 'reminder-migration.sql').read_text())
        self.db.executescript((SCHEMA.parent / 'reminder-arming-migration.sql').read_text())

    def tearDown(self):
        self.db.close()

    def insert(self, note_id, **fields):
        row = {'id': note_id, 'created_at': 1, 'updated_at': 1, **fields}
        self.db.execute(f"INSERT INTO notes ({','.join(row)}) VALUES ({','.join('?' for _ in row)})", list(row.values()))

    def test_required_fields_defaults_and_null_reminder(self):
        self.insert('minimal')
        self.assertEqual(self.db.execute('SELECT title,content,tags,reminder_at,is_deleted FROM notes').fetchone(), ('', '', '[]', None, 0))

    def test_boolean_constraints_reject_invalid_flags(self):
        for flag in ('is_deleted', 'is_archived', 'is_pinned', 'reminder_sent', 'reminder_armed'):
            with self.assertRaises(sqlite3.IntegrityError):
                self.insert(flag, **{flag: 2})

    def test_duplicate_ids_are_rejected(self):
        self.insert('same')
        with self.assertRaises(sqlite3.IntegrityError):
            self.insert('same')

    def test_native_sort_keeps_pins_first_and_uses_display_order(self):
        self.insert('b', updated_at=5, sort_at=5, is_pinned=1)
        self.insert('a', updated_at=5, sort_at=5, is_pinned=1)
        self.insert('new', updated_at=999, sort_at=999)
        source = (ROOT / 'android/app/src/main/java/com/monokeep/app/NoteDatabase.java').read_text()
        order = re.search(r'"(is_pinned DESC, sort_at DESC, id ASC)"', source).group(1)
        self.assertEqual([r[0] for r in self.db.execute(f'SELECT id FROM notes ORDER BY {order}')], ['a', 'b', 'new'])

    def test_unicode_and_linebreaks_survive_a_real_reopen(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / 'test.db'
            db = sqlite3.connect(path)
            db.executescript(SCHEMA.read_text())
            db.execute('INSERT INTO notes(id,title,content,created_at,updated_at) VALUES(?,?,?,?,?)', ('u', 'Привет', '台北\nMilk 🥛', 1, 1))
            db.commit(); db.close()
            db = sqlite3.connect(path)
            self.assertEqual(db.execute('SELECT title,content FROM notes').fetchone(), ('Привет', '台北\nMilk 🥛'))
            db.close()


class PlatformContract(unittest.TestCase):
    def test_dart_channel_methods_have_native_handlers(self):
        dart = (ROOT / 'lib/platform/native_store.dart').read_text()
        native = (ROOT / 'android/app/src/main/java/com/monokeep/app/MainActivity.java').read_text()
        methods = set(re.findall(r"invoke(?:ListMethod|MapMethod|Method)(?:<[^>]+>)?\('([^']+)'", dart))
        self.assertGreaterEqual(len(methods), 12)
        cases = set(re.findall(r'case "([^"]+)":', native))
        self.assertFalse(methods - cases, methods - cases)

    def test_manifest_components_exist_and_sync_has_network_permission(self):
        manifest = ET.parse(ROOT / 'android/app/src/main/AndroidManifest.xml').getroot()
        permissions = {p.get(ANDROID + 'name') for p in manifest.findall('uses-permission')}
        self.assertIn('android.permission.INTERNET', permissions)
        self.assertIn('android.permission.RECEIVE_BOOT_COMPLETED', permissions)
        for node in manifest.findall('./application/activity') + manifest.findall('./application/receiver'):
            path = ROOT / 'android/app/src/main/java/com/monokeep/app' / (node.get(ANDROID + 'name').lstrip('.') + '.java')
            self.assertTrue(path.exists(), path)
        for path in (ROOT / 'android/app/src').rglob('*.xml'):
            ET.parse(path)

    def test_launcher_icons_are_the_original_assets(self):
        for bucket, size in [('mdpi', 48), ('hdpi', 72), ('xhdpi', 96), ('xxhdpi', 144), ('xxxhdpi', 192)]:
            icon = ROOT / f'android/app/src/main/res/mipmap-{bucket}/ic_launcher.png'
            original = ROOT.parent / f'web/public/icons/icon-{size}x{size}.png'
            self.assertEqual(icon.read_bytes(), original.read_bytes())


if __name__ == '__main__':
    unittest.main(verbosity=2)
