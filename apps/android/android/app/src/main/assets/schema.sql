CREATE TABLE notes (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    color TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    reminder_at INTEGER,
    is_pinned INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0, 1)),
    is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
    is_deleted INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0, 1)),
    reminder_sent INTEGER NOT NULL DEFAULT 0 CHECK (reminder_sent IN (0, 1))
);
CREATE INDEX notes_view_sort ON notes(is_deleted, is_archived, reminder_sent DESC, updated_at DESC, id);
CREATE INDEX notes_reminders ON notes(reminder_sent, is_deleted, reminder_at);
