package com.monokeep.app;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import org.json.JSONArray;
import org.json.JSONObject;
import java.time.Instant;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** The Activity and both receivers share this database and one serial work queue. */
public final class NoteDatabase extends SQLiteOpenHelper {
    public static final ExecutorService IO = Executors.newSingleThreadExecutor();
    private static NoteDatabase instance;
    /** Cards show at most ten lines; the editor reads the full text with find(). */
    static final int PREVIEW = 800;
    private final Context context;
    // A token from another process or database instance forces a full read.
    private final String epoch = UUID.randomUUID().toString();
    // Displayed-field changes since process start. Reminder arming is not displayed.
    private final Map<String, Long> touched = new HashMap<>();
    private long version, resetVersion;

    public static synchronized NoteDatabase get(Context context) {
        if (instance == null) instance = new NoteDatabase(context.getApplicationContext(), "monokeep.db");
        return instance;
    }

    // A different file name lets instrumentation tests exercise real SQLite in isolation.
    NoteDatabase(Context context, String name) {
        super(context, name, null, 4);
        this.context = context;
        setWriteAheadLoggingEnabled(true);
    }

    @Override public void onConfigure(SQLiteDatabase db) {
        db.setForeignKeyConstraintsEnabled(true);
    }

    @Override public void onCreate(SQLiteDatabase db) {
        try (InputStream input = context.getAssets().open("schema.sql")) {
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096];
            int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            for (String statement : output.toString("UTF-8").split(";")) {
                if (!statement.trim().isEmpty()) db.execSQL(statement.trim());
            }
        } catch (Exception error) {
            throw new IllegalStateException("Cannot initialize notes", error);
        }
        migrateSync(db);
        migrateReminders(db);
        migrateAsset(db, "reminder-arming-migration.sql");
    }

    @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        if (oldVersion < 2) migrateSync(db);
        if (oldVersion < 3) migrateReminders(db);
        // Existing overdue rows have no proof of a current device alarm. Future
        // reminders are armed again by rescheduleAll after upgrade/open/boot.
        if (oldVersion < 4) migrateAsset(db, "reminder-arming-migration.sql");
    }

    private void migrateSync(SQLiteDatabase db) { migrateAsset(db, "sync-migration.sql"); }
    private void migrateReminders(SQLiteDatabase db) {
        migrateAsset(db, "reminder-migration.sql");
        try (Cursor rows = db.rawQuery("SELECT notes.* FROM notes INNER JOIN sync_outbox ON notes.id = sync_outbox.note_id", null)) {
            while (rows.moveToNext()) enqueue(db, read(rows));
        }
    }
    private void migrateAsset(SQLiteDatabase db, String file) {
        try (InputStream input = context.getAssets().open(file)) {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096]; int count;
            while ((count = input.read(buffer)) != -1) bytes.write(buffer, 0, count);
            for (String statement : bytes.toString("UTF-8").split(";"))
                if (!statement.trim().isEmpty()) db.execSQL(statement);
        } catch (Exception e) { throw new IllegalStateException("Cannot migrate sync storage", e); }
    }

    public List<Map<String, Object>> list() {
        adoptGuestNotesIfSignedIn();
        List<Map<String, Object>> result = new ArrayList<>();
        try (Cursor cursor = getReadableDatabase().query("notes", null, "owner_id = ? AND sync_deleted = 0", new String[]{SyncSession.owner(context)}, null, null,
                "is_pinned DESC, sort_at DESC, id ASC")) {
            while (cursor.moveToNext()) result.add(read(cursor));
        }
        return result;
    }

    private void adoptGuestNotesIfSignedIn() {
        String owner = SyncSession.owner(context);
        if (owner.isEmpty()) return;
        try (Cursor guest = getReadableDatabase().rawQuery("SELECT 1 FROM notes WHERE owner_id = '' LIMIT 1", null)) {
            if (guest.moveToFirst()) adoptGuestNotes(owner);
        }
    }

    /** Only notes that can hold an alarm or a delivered notification need reconciliation. */
    List<Map<String, Object>> reminderCandidates() {
        adoptGuestNotesIfSignedIn();
        List<Map<String, Object>> result = new ArrayList<>();
        try (Cursor cursor = getReadableDatabase().query("notes", null,
                "owner_id = ? AND sync_deleted = 0 AND (reminder_at IS NOT NULL OR reminder_armed = 1)",
                new String[]{SyncSession.owner(context)}, null, null, null)) {
            while (cursor.moveToNext()) result.add(read(cursor));
        }
        return result;
    }

    private synchronized void touch(String id) { touched.put(id, ++version); }
    private synchronized void reset() { touched.clear(); resetVersion = ++version; }

    /**
     * Card previews changed since token. Unchanged: {token, unchanged}. Full: {token, rows}.
     * Delta: {token, ids, rows}, where ids lists every visible note and rows only changed ones.
     */
    public Map<String, Object> changes(String token) {
        adoptGuestNotesIfSignedIn();
        String owner = SyncSession.owner(context);
        long current;
        Set<String> changed = null;
        synchronized (this) {
            current = version;
            String[] parts = token == null ? new String[0] : token.split("/", 3);
            long since = -1;
            if (parts.length == 3 && epoch.equals(parts[0]) && owner.equals(parts[2])) {
                try { since = Long.parseLong(parts[1]); } catch (NumberFormatException ignored) { }
            }
            if (since >= resetVersion && since <= current) {
                changed = new HashSet<>();
                for (Map.Entry<String, Long> entry : touched.entrySet()) if (entry.getValue() > since) changed.add(entry.getKey());
            }
        }
        Map<String, Object> result = new HashMap<>();
        result.put("token", epoch + "/" + current + "/" + owner);
        if (changed != null && changed.isEmpty()) {
            result.put("unchanged", true);
            return result;
        }
        String visible = "owner_id = ? AND sync_deleted = 0";
        if (changed == null) {
            result.put("rows", previews(visible, new String[]{owner}));
            return result;
        }
        List<String> ids = new ArrayList<>();
        try (Cursor cursor = getReadableDatabase().query("notes", new String[]{"id"}, visible, new String[]{owner}, null, null, null)) {
            while (cursor.moveToNext()) ids.add(cursor.getString(0));
        }
        List<Map<String, Object>> rows = new ArrayList<>();
        List<String> pending = new ArrayList<>(changed);
        // Stay below SQLite's bound-parameter limit on older Android versions.
        for (int start = 0; start < pending.size(); start += 500) {
            List<String> chunk = pending.subList(start, Math.min(pending.size(), start + 500));
            String[] args = new String[chunk.size() + 1];
            args[0] = owner;
            for (int i = 0; i < chunk.size(); i++) args[i + 1] = chunk.get(i);
            StringBuilder marks = new StringBuilder("?");
            for (int i = 1; i < chunk.size(); i++) marks.append(",?");
            rows.addAll(previews(visible + " AND id IN (" + marks + ")", args));
        }
        result.put("ids", ids);
        result.put("rows", rows);
        return result;
    }

    private List<Map<String, Object>> previews(String where, String[] args) {
        String[] columns = {"id", "title", "substr(content, 1, " + PREVIEW + ")", "length(content) > " + PREVIEW, "color", "tags",
            "created_at", "updated_at", "sort_at", "reminder_at", "reminder_enabled", "is_pinned", "is_archived", "is_deleted", "reminder_sent"};
        List<Map<String, Object>> result = new ArrayList<>();
        try (Cursor cursor = getReadableDatabase().query("notes", columns, where, args, null, null, null)) {
            while (cursor.moveToNext()) {
                Map<String, Object> row = new HashMap<>();
                row.put("id", cursor.getString(0));
                row.put("title", cursor.getString(1));
                row.put("content", cursor.getString(2));
                row.put("isPreview", cursor.getInt(3) == 1);
                row.put("color", cursor.getString(4));
                row.put("tags", tags(cursor.getString(5)));
                row.put("createdAt", cursor.getLong(6));
                row.put("updatedAt", cursor.getLong(7));
                row.put("sortAt", cursor.getLong(8));
                row.put("reminderDate", cursor.isNull(9) ? null : cursor.getLong(9));
                row.put("reminderEnabled", cursor.getInt(10) == 1);
                row.put("isPinned", cursor.getInt(11) == 1);
                row.put("isArchived", cursor.getInt(12) == 1);
                row.put("isDeleted", cursor.getInt(13) == 1);
                row.put("isReminderSent", cursor.getInt(14) == 1);
                result.add(row);
            }
        }
        return result;
    }

    /** IDs of visible notes whose title, full text or a tag contains query, ignoring case. */
    public List<String> search(String query) {
        String needle = query.toLowerCase(Locale.ROOT);
        List<String> result = new ArrayList<>();
        try (Cursor cursor = getReadableDatabase().query("notes", new String[]{"id", "title", "content", "tags"},
                "owner_id = ? AND sync_deleted = 0", new String[]{SyncSession.owner(context)}, null, null, null)) {
            while (cursor.moveToNext()) {
                boolean found = cursor.getString(1).toLowerCase(Locale.ROOT).contains(needle)
                    || cursor.getString(2).toLowerCase(Locale.ROOT).contains(needle);
                if (!found) for (String tag : tags(cursor.getString(3))) {
                    if (tag.toLowerCase(Locale.ROOT).contains(needle)) { found = true; break; }
                }
                if (found) result.add(cursor.getString(0));
            }
        }
        return result;
    }

    public Map<String, Object> find(String id) {
        try (Cursor cursor = getReadableDatabase().query("notes", null, "id = ? AND owner_id = ? AND sync_deleted = 0", new String[]{id, SyncSession.owner(context)}, null, null, null)) {
            return cursor.moveToFirst() ? read(cursor) : null;
        }
    }

    public Map<String, Object> save(Map<String, Object> patch) {
        String creationId = patch.get("creationId") instanceof String ? UUID.fromString((String) patch.get("creationId")).toString() : null;
        if (creationId != null && patch.containsKey("id")) throw new IllegalArgumentException("Create and update must be separate requests");
        String id = patch.get("id") instanceof String ? (String) patch.get("id") : creationId != null ? creationId : UUID.randomUUID().toString();
        if (creationId != null) {
            // The first commit may have succeeded before its reply was lost. A retry
            // acknowledges that same row without overwriting newer edits or tombstones.
            try (Cursor cursor = getReadableDatabase().query("notes", null, "id = ?", new String[]{id}, null, null, null)) {
                if (cursor.moveToFirst()) {
                    Map<String, Object> committed = read(cursor);
                    if (!SyncSession.owner(context).equals(committed.get("ownerId"))) throw new SecurityException("Note belongs to another account");
                    return committed;
                }
            }
        }
        Map<String, Object> existing = find(id);
        if (patch.containsKey("id") && existing == null) throw new IllegalArgumentException("This note no longer exists");
        if (existing == null && Objects.toString(patch.get("title"), "").trim().isEmpty()
                && Objects.toString(patch.get("content"), "").trim().isEmpty())
            throw new IllegalArgumentException("Add a title or a note");
        long now = SyncClock.now(context, existing == null ? 0 : number(existing.get("updatedAt"), 0));
        Map<String, Object> row = existing == null ? new HashMap<>() : new HashMap<>(existing);
        row.putAll(patch);
        row.put("id", id);
        row.put("createdAt", existing == null ? now : existing.get("createdAt"));
        row.put("updatedAt", now);
        row.put("editId", UUID.randomUUID().toString());
        row.put("ownerId", SyncSession.owner(context));
        boolean pinChanged = existing != null && patch.containsKey("isPinned") && !Objects.equals(existing.get("isPinned"), patch.get("isPinned"));
        row.put("sortAt", existing == null || pinChanged ? now : existing.get("sortAt"));
        boolean dateChanged = patch.containsKey("reminderDate") && (existing == null || !Objects.equals(existing.get("reminderDate"), patch.get("reminderDate")));
        boolean intentChanged = dateChanged || patch.containsKey("reminderEnabled");
        boolean enabled = patch.containsKey("reminderEnabled") ? Boolean.TRUE.equals(patch.get("reminderEnabled"))
            : dateChanged || existing == null || !Boolean.FALSE.equals(existing.get("reminderEnabled"));
        row.put("reminderEnabled", enabled);
        row.put("reminderVersion", intentChanged || existing == null ? row.get("editId") : existing.get("reminderVersion"));
        row.put("isReminderSent", intentChanged ? false : existing != null && Boolean.TRUE.equals(existing.get("isReminderSent")));
        if (row.get("reminderDate") == null) row.put("isReminderSent", false);
        row.put("reminderArmed", sameReminder(existing, row) && Boolean.TRUE.equals(existing.get("reminderArmed")));
        ContentValues values = values(row);
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            if (existing == null) db.insertOrThrow("notes", null, values);
            else db.update("notes", values, "id = ? AND owner_id = ?", new String[]{id, SyncSession.owner(context)});
            enqueue(db, row);
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
        touch(id);
        if ("monokeep.db".equals(getDatabaseName())) SyncEngine.request(context);
        return Boolean.TRUE.equals(row.get("syncDeleted")) ? row : find(id);
    }

    public int importNotes(List<Map<String, Object>> notes) throws Exception {
        SQLiteDatabase db = getWritableDatabase();
        int imported = 0;
        List<String> inserted = new ArrayList<>();
        db.beginTransaction();
        try {
            for (Map<String, Object> source : notes) {
                Map<String, Object> row = new HashMap<>(source);
                if (!(row.get("id") instanceof String) || ((String) row.get("id")).isEmpty()) {
                    byte[] digest = MessageDigest.getInstance("SHA-256").digest(
                        Objects.toString(row.get("importKey"), "").getBytes(StandardCharsets.UTF_8));
                    StringBuilder id = new StringBuilder("import-");
                    for (byte value : digest) id.append(String.format(java.util.Locale.ROOT, "%02x", value & 255));
                    row.put("id", id.toString());
                }
                row.put("id", syncId((String) row.get("id")));
                try (Cursor duplicate = db.rawQuery("SELECT id FROM notes WHERE id = ?", new String[]{(String) row.get("id")})) {
                    if (duplicate.moveToFirst()) continue;
                }
                row.put("ownerId", SyncSession.owner(context));
                row.put("editId", UUID.randomUUID().toString());
                row.put("sortAt", number(row.get("sortAt"), number(row.get("updatedAt"), System.currentTimeMillis())));
                row.put("updatedAt", SyncClock.now(context, 0));
                row.put("reminderVersion", row.get("editId"));
                // A backup never transfers another device's scheduled alarms.
                row.put("reminderArmed", false);
                db.insertOrThrow("notes", null, values(row));
                enqueue(db, row);
                inserted.add((String) row.get("id"));
                imported++;
            }
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
        for (String id : inserted) touch(id);
        if ("monokeep.db".equals(getDatabaseName())) SyncEngine.request(context);
        return imported;
    }

    public void deleteForever(String id) {
        Map<String, Object> row = find(id);
        if (row == null || !Boolean.TRUE.equals(row.get("isDeleted"))) return;
        row.put("syncDeleted", true);
        save(row);
    }

    public void markReminderSent(String id, long expectedDate) {
        ContentValues values = new ContentValues();
        values.put("reminder_sent", 1);
        values.put("reminder_armed", 0);
        values.put("sort_at", SyncClock.now(context, 0));
        if (getWritableDatabase().update("notes", values,
                "id = ? AND reminder_at = ? AND is_deleted = 0 AND sync_deleted = 0 AND reminder_enabled = 1 AND owner_id = ?", new String[]{id, Long.toString(expectedDate), SyncSession.owner(context)}) > 0)
            touch(id);
    }

    /** This device may deliver late only if it scheduled this version while future. */
    boolean armReminder(Map<String, Object> note) {
        ContentValues values = new ContentValues(); values.put("reminder_armed", 1);
        return getWritableDatabase().update("notes", values,
            "id = ? AND owner_id = ? AND reminder_at = ? AND reminder_version = ? AND reminder_at > ? " +
            "AND is_deleted = 0 AND sync_deleted = 0 AND reminder_enabled = 1 AND reminder_sent = 0",
            new String[]{(String)note.get("id"), SyncSession.owner(context), Objects.toString(note.get("reminderDate")),
                (String)note.get("reminderVersion"), Long.toString(System.currentTimeMillis())}) == 1;
    }

    void disarmReminder(String id) {
        ContentValues values = new ContentValues(); values.put("reminder_armed", 0);
        getWritableDatabase().update("notes", values, "id = ? AND owner_id = ? AND reminder_armed = 1", new String[]{id, SyncSession.owner(context)});
    }

    void disarmReminders() {
        ContentValues values = new ContentValues(); values.put("reminder_armed", 0);
        getWritableDatabase().update("notes", values, "owner_id = ?", new String[]{SyncSession.owner(context)});
    }

    private static boolean sameReminder(Map<String, Object> before, Map<String, Object> after) {
        return before != null && !Boolean.TRUE.equals(before.get("isDeleted")) && !Boolean.TRUE.equals(before.get("syncDeleted"))
            && !Boolean.FALSE.equals(before.get("reminderEnabled")) && !Boolean.TRUE.equals(after.get("isDeleted"))
            && !Boolean.TRUE.equals(after.get("syncDeleted")) && !Boolean.FALSE.equals(after.get("reminderEnabled"))
            && after.get("reminderDate") != null && Objects.equals(before.get("reminderDate"), after.get("reminderDate"))
            && Objects.equals(before.get("reminderVersion"), after.get("reminderVersion"));
    }

    private static ContentValues values(Map<String, Object> row) {
        ContentValues values = new ContentValues();
        values.put("id", Objects.toString(row.get("id"), ""));
        values.put("owner_id", Objects.toString(row.get("ownerId"), ""));
        values.put("edit_id", Objects.toString(row.get("editId"), "00000000-0000-0000-0000-000000000000"));
        values.put("sync_deleted", Boolean.TRUE.equals(row.get("syncDeleted")) ? 1 : 0);
        String title = Objects.toString(row.get("title"), "");
        values.put("title", title.isEmpty() ? "Untitled" : title);
        values.put("content", Objects.toString(row.get("content"), ""));
        Object color = row.get("color");
        if (color instanceof String && ((String) color).matches("#[0-9a-fA-F]{6}")) values.put("color", (String) color);
        else values.putNull("color");
        LinkedHashSet<String> tags = new LinkedHashSet<>();
        if (row.get("tags") instanceof List<?>) {
            for (Object tag : (List<?>) row.get("tags")) {
                if (tag instanceof String && !((String) tag).trim().isEmpty()) tags.add(((String) tag).trim());
            }
        }
        values.put("tags", new JSONArray(tags).toString());
        values.put("created_at", number(row.get("createdAt"), System.currentTimeMillis()));
        values.put("updated_at", number(row.get("updatedAt"), System.currentTimeMillis()));
        values.put("sort_at", number(row.get("sortAt"), number(row.get("updatedAt"), System.currentTimeMillis())));
        values.put("reminder_enabled", Boolean.FALSE.equals(row.get("reminderEnabled")) ? 0 : 1);
        values.put("reminder_version", Objects.toString(row.get("reminderVersion"), "00000000-0000-0000-0000-000000000000"));
        values.put("reminder_armed", Boolean.TRUE.equals(row.get("reminderArmed")) ? 1 : 0);
        if (row.get("reminderDate") instanceof Number) values.put("reminder_at", ((Number) row.get("reminderDate")).longValue());
        else values.putNull("reminder_at");
        String[] flags = {"isPinned", "isArchived", "isDeleted", "isReminderSent"};
        String[] columns = {"is_pinned", "is_archived", "is_deleted", "reminder_sent"};
        for (int i = 0; i < flags.length; i++) values.put(columns[i], Boolean.TRUE.equals(row.get(flags[i])) ? 1 : 0);
        return values;
    }

    private static long number(Object value, long fallback) { return value instanceof Number ? ((Number) value).longValue() : fallback; }

    private static Map<String, Object> read(Cursor cursor) {
        Map<String, Object> row = new HashMap<>();
        for (String column : Arrays.asList("id", "title", "content", "color")) {
            row.put(column, cursor.getString(cursor.getColumnIndexOrThrow(column)));
        }
        row.put("ownerId", cursor.getString(cursor.getColumnIndexOrThrow("owner_id")));
        row.put("editId", cursor.getString(cursor.getColumnIndexOrThrow("edit_id")));
        row.put("syncDeleted", cursor.getInt(cursor.getColumnIndexOrThrow("sync_deleted")) == 1);
        row.put("createdAt", cursor.getLong(cursor.getColumnIndexOrThrow("created_at")));
        row.put("updatedAt", cursor.getLong(cursor.getColumnIndexOrThrow("updated_at")));
        row.put("sortAt", cursor.getLong(cursor.getColumnIndexOrThrow("sort_at")));
        row.put("reminderEnabled", cursor.getInt(cursor.getColumnIndexOrThrow("reminder_enabled")) == 1);
        row.put("reminderVersion", cursor.getString(cursor.getColumnIndexOrThrow("reminder_version")));
        // v2 -> v3 outbox reconstruction runs before the v4 column is added.
        int armed = cursor.getColumnIndex("reminder_armed");
        row.put("reminderArmed", armed >= 0 && cursor.getInt(armed) == 1);
        int reminder = cursor.getColumnIndexOrThrow("reminder_at");
        row.put("reminderDate", cursor.isNull(reminder) ? null : cursor.getLong(reminder));
        String[] flags = {"isPinned", "isArchived", "isDeleted", "isReminderSent"};
        String[] columns = {"is_pinned", "is_archived", "is_deleted", "reminder_sent"};
        for (int i = 0; i < flags.length; i++) row.put(flags[i], cursor.getInt(cursor.getColumnIndexOrThrow(columns[i])) == 1);
        row.put("tags", tags(cursor.getString(cursor.getColumnIndexOrThrow("tags"))));
        return row;
    }
    private static List<String> tags(String json) {
        List<String> tags = new ArrayList<>();
        try {
            JSONArray array = new JSONArray(json);
            for (int i = 0; i < array.length(); i++) tags.add(array.getString(i));
        } catch (Exception error) {
            throw new IllegalStateException("Invalid tags in database", error);
        }
        return tags;
    }
    static String syncId(String id) {
        try { return UUID.fromString(id).toString(); }
        catch (Exception ignored) { return UUID.nameUUIDFromBytes(("monokeep:" + id).getBytes(StandardCharsets.UTF_8)).toString(); }
    }

    private void enqueue(SQLiteDatabase db, Map<String, Object> row) {
        String owner = Objects.toString(row.get("ownerId"), "");
        if (owner.isEmpty()) return;
        ContentValues entry = new ContentValues();
        entry.put("note_id", (String) row.get("id")); entry.put("owner_id", owner);
        entry.put("edit_id", (String) row.get("editId"));
        entry.put("payload", toServer(row).toString());
        db.insertWithOnConflict("sync_outbox", null, entry, SQLiteDatabase.CONFLICT_REPLACE);
    }

    /** Called once on sign-in; never reassigns another account's notes. */
    void adoptGuestNotes(String owner) {
        SQLiteDatabase db = getWritableDatabase(); db.beginTransaction();
        boolean adopted = false;
        try (Cursor cursor = db.query("notes", null, "owner_id = ''", null, null, null, null)) {
            while (cursor.moveToNext()) {
                adopted = true;
                Map<String, Object> row = read(cursor);
                String oldId = (String) row.get("id");
                row.put("id", syncId(oldId)); row.put("ownerId", owner);
                row.put("editId", UUID.randomUUID().toString());
                db.update("notes", values(row), "id = ? AND owner_id = ''", new String[]{oldId});
                enqueue(db, row);
            }
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
        // IDs change, so every reader takes a full snapshot.
        if (adopted) reset();
    }

    JSONArray pending(String owner) throws Exception {
        JSONArray result = new JSONArray();
        try (Cursor c = getReadableDatabase().rawQuery("SELECT payload FROM sync_outbox WHERE owner_id = ? LIMIT 50", new String[]{owner})) {
            while (c.moveToNext()) result.put(new JSONObject(c.getString(0)));
        }
        return result;
    }
    String checkpoint(String owner) {
        try (Cursor c = getReadableDatabase().rawQuery("SELECT revision FROM sync_state WHERE owner_id = ?", new String[]{owner})) {
            return c.moveToFirst() ? c.getString(0) : "0";
        }
    }
    int pendingCount(String owner) {
        try (Cursor c = getReadableDatabase().rawQuery("SELECT count(*) FROM sync_outbox WHERE owner_id = ?", new String[]{owner})) {
            c.moveToFirst(); return c.getInt(0);
        }
    }
    /** Both page application and its checkpoint commit together. ACK never removes a later edit. */
    void accept(String owner, JSONArray rows, String revision) throws Exception {
        SQLiteDatabase db = getWritableDatabase(); db.beginTransaction();
        List<String> applied = new ArrayList<>(), dropped = new ArrayList<>();
        try {
            for (int i = 0; i < rows.length(); i++) {
                JSONObject remote = rows.getJSONObject(i);
                if (!owner.equals(remote.getString("user_id"))) throw new SecurityException("Wrong sync owner");
                Map<String, Object> next = fromServer(remote);
                String id = remote.getString("id"); Map<String, Object> local = null;
                try (Cursor c = db.query("notes", null, "id = ?", new String[]{id}, null, null, null)) {
                    if (c.moveToFirst()) local = read(c);
                }
                if (local != null && !owner.equals(local.get("ownerId"))) throw new SecurityException("Note belongs to another account");
                if (local != null && compare(local, next) > 0) continue;
                // Preserve an already scheduled device alarm through a simultaneous
                // web delivery. Historical downloads must respect the cloud flag
                // and can never acquire permission to deliver an overdue reminder.
                boolean same = sameReminder(local, next);
                boolean armed = same && Boolean.TRUE.equals(local.get("reminderArmed"));
                next.put("reminderArmed", armed);
                if (same) next.put("isReminderSent", Boolean.TRUE.equals(local.get("isReminderSent"))
                    || (!armed && Boolean.TRUE.equals(next.get("isReminderSent"))));
                // A losing pin edit must not retain its display position after the server wins.
                // Only identical edit versions can retain device-local delivery ordering.
                if (local != null && compare(local, next) == 0)
                    next.put("sortAt", Math.max(number(local.get("sortAt"),0), number(next.get("sortAt"),0)));
                db.insertWithOnConflict("notes", null, values(next), SQLiteDatabase.CONFLICT_REPLACE);
                applied.add(id);
                // rescheduleAll skips notes without a date, so a cleared or replaced date cancels here.
                if (Boolean.TRUE.equals(next.get("syncDeleted")) || (local != null && local.get("reminderDate") != null && !same))
                    dropped.add(id);
                // A newer winning server edit supersedes an older pending local snapshot too.
                if (local != null) db.delete("sync_outbox", "note_id = ? AND owner_id = ? AND edit_id = ?",
                    new String[]{id, owner, (String) local.get("editId")});
            }
            if (revision != null) {
                ContentValues state = new ContentValues(); state.put("owner_id", owner); state.put("revision", revision);
                state.put("last_sync", System.currentTimeMillis());
                db.insertWithOnConflict("sync_state", null, state, SQLiteDatabase.CONFLICT_REPLACE);
            }
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
        for (String id : applied) touch(id);
        // Only a committed page may cancel; a rolled-back page keeps its armed alarm.
        if (owner.equals(SyncSession.owner(context))) for (String id : dropped) ReminderScheduler.cancel(context, id);
    }
    static int compare(Map<String, Object> a, Map<String, Object> b) {
        int time = Long.compare(number(a.get("updatedAt"), 0), number(b.get("updatedAt"), 0));
        return time != 0 ? time : Objects.toString(a.get("editId"), "").compareTo(Objects.toString(b.get("editId"), ""));
    }
    static JSONObject toServer(Map<String, Object> row) {
        try {
            JSONObject result = new JSONObject();
            String[][] fields = {{"id","id"},{"ownerId","user_id"},{"editId","edit_id"},{"title","title"},{"content","content"},
                {"color","color"},{"isPinned","is_pinned"},{"isArchived","is_archived"},{"isDeleted","is_deleted"},{"syncDeleted","sync_deleted"}};
            for (String[] field : fields) result.put(field[1], row.get(field[0]) == null ? JSONObject.NULL : row.get(field[0]));
            result.put("created_at", Instant.ofEpochMilli(number(row.get("createdAt"), 0)).toString());
            result.put("updated_at", Instant.ofEpochMilli(number(row.get("updatedAt"), 0)).toString());
            result.put("sort_at", Instant.ofEpochMilli(number(row.get("sortAt"), number(row.get("updatedAt"), 0))).toString());
            result.put("reminder_enabled", !Boolean.FALSE.equals(row.get("reminderEnabled")));
            result.put("reminder_version", Objects.toString(row.get("reminderVersion"), "00000000-0000-0000-0000-000000000000"));
            result.put("reminder_date", row.get("reminderDate") instanceof Number ? Instant.ofEpochMilli(number(row.get("reminderDate"), 0)).toString() : JSONObject.NULL);
            JSONArray tags = new JSONArray();
            if (row.get("tags") instanceof List<?>) for (Object tag : (List<?>) row.get("tags")) {
                String name = tag.toString();
                tags.put(new JSONObject().put("id", syncId("tag:" + row.get("ownerId") + ":" + name)).put("name", name));
            }
            return result.put("tags", tags);
        } catch (Exception e) { throw new IllegalStateException(e); }
    }
    static Map<String, Object> fromServer(JSONObject source) throws Exception {
        Map<String, Object> row = new HashMap<>();
        String[][] fields = {{"id","id"},{"ownerId","user_id"},{"editId","edit_id"},{"title","title"},{"content","content"},{"color","color"}};
        for (String[] f : fields) row.put(f[0], source.isNull(f[1]) ? null : source.getString(f[1]));
        row.put("createdAt", SyncTimestamp.millis(source.getString("created_at")));
        row.put("updatedAt", SyncTimestamp.millis(source.getString("updated_at")));
        row.put("reminderDate", source.isNull("reminder_date") ? null : SyncTimestamp.millis(source.getString("reminder_date")));
        row.put("isPinned", source.optBoolean("is_pinned")); row.put("isArchived", source.optBoolean("is_archived"));
        row.put("isDeleted", source.optBoolean("is_deleted")); row.put("syncDeleted", source.optBoolean("sync_deleted"));
        row.put("isReminderSent", source.optBoolean("is_reminder_sent"));
        row.put("sortAt", source.isNull("sort_at") ? row.get("updatedAt") : SyncTimestamp.millis(source.getString("sort_at")));
        row.put("reminderEnabled", source.optBoolean("reminder_enabled", true));
        row.put("reminderVersion", source.optString("reminder_version", "00000000-0000-0000-0000-000000000000"));
        List<String> tags = new ArrayList<>(); JSONArray array = source.optJSONArray("tags");
        if (array != null) for (int i=0; i<array.length(); i++) tags.add(array.getJSONObject(i).getString("name"));
        row.put("tags", tags); return row;
    }

}
