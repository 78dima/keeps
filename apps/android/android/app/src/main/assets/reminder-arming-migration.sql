ALTER TABLE notes ADD COLUMN reminder_armed INTEGER NOT NULL DEFAULT 0 CHECK (reminder_armed IN (0, 1));
