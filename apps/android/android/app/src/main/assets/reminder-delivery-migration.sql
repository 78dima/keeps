ALTER TABLE notes ADD COLUMN remote_sent INTEGER NOT NULL DEFAULT 0 CHECK (remote_sent IN (0, 1));
UPDATE sync_state SET revision = '0';
