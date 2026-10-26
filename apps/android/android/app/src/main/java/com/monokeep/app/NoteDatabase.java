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
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** The Activity and both receivers share this database and one serial work queue. */
public final class NoteDatabase extends SQLiteOpenHelper {
    public static final ExecutorService IO = Executors.newSingleThreadExecutor();
    private static NoteDatabase instance;
    private final Context context;

    public static synchronized NoteDatabase get(Context context) {
        if (instance == null) instance = new NoteDatabase(context.getApplicationContext(), "monokeep.db");
        return instance;
    }

    // A different file name lets instrumentation tests exercise real SQLite in isolation.
    NoteDatabase(Context context, String name) {
        super(context, name, null, 2);
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
    }

    @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        if (oldVersion < 2) migrateSync(db);
    }

    private void migrateSync(SQLiteDatabase db) {
        try (InputStream input = context.getAssets().open("sync-migration.sql")) {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096]; int count;
            while ((count = input.read(buffer)) != -1) bytes.write(buffer, 0, count);
            for (String statement : bytes.toString("UTF-8").split(";"))
                if (!statement.trim().isEmpty()) db.execSQL(statement);
        } catch (Exception e) { throw new IllegalStateException("Cannot migrate sync storage", e); }
    }

    public List<Map<String, Object>> list() {
        List<Map<String, Object>> result = new ArrayList<>();
        try (Cursor cursor = getReadableDatabase().query("notes", null, "owner_id = ? AND sync_deleted = 0", new String[]{SyncSession.owner(context)}, null, null,
                "reminder_sent DESC, updated_at DESC, id ASC")) {
            while (cursor.moveToNext()) result.add(read(cursor));
        }
        return result;
    }

    public Map<String, Object> find(String id) {
        try (Cursor cursor = getReadableDatabase().query("notes", null, "id = ? AND owner_id = ? AND sync_deleted = 0", new String[]{id, SyncSession.owner(context)}, null, null, null)) {
            return cursor.moveToFirst() ? read(cursor) : null;
        }
    }

    public Map<String, Object> save(Map<String, Object> patch) {
        String id = patch.get("id") instanceof String ? (String) patch.get("id") : UUID.randomUUID().toString();
        Map<String, Object> existing = find(id);
        if (patch.containsKey("id") && existing == null) throw new IllegalArgumentException("This note no longer exists");
        long now = SyncClock.now(context, existing == null ? 0 : number(existing.get("updatedAt"), 0));
        Map<String, Object> row = existing == null ? new HashMap<>() : new HashMap<>(existing);
        row.putAll(patch);
        row.put("id", id);
        row.put("createdAt", existing == null ? now : existing.get("createdAt"));
        row.put("updatedAt", now);
        row.put("editId", UUID.randomUUID().toString());
        row.put("ownerId", SyncSession.owner(context));
        // Updating content or pin status cannot undo a reminder delivered while the editor was open.
        if (existing != null) row.put("isReminderSent", existing.get("isReminderSent"));
        if (patch.containsKey("reminderDate") &&
                (existing == null || !Objects.equals(existing.get("reminderDate"), patch.get("reminderDate")))) {
            row.put("isReminderSent", false);
        }
        if (row.get("reminderDate") == null) row.put("isReminderSent", false);
        ContentValues values = values(row);
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            if (existing == null) db.insertOrThrow("notes", null, values);
            else db.update("notes", values, "id = ? AND owner_id = ?", new String[]{id, SyncSession.owner(context)});
            enqueue(db, row);
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
        if ("monokeep.db".equals(getDatabaseName())) SyncEngine.request(context);
        return Boolean.TRUE.equals(row.get("syncDeleted")) ? row : find(id);
    }

    public int importNotes(List<Map<String, Object>> notes) throws Exception {
        SQLiteDatabase db = getWritableDatabase();
        int imported = 0;
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
                row.put("updatedAt", SyncClock.now(context, 0));
                db.insertOrThrow("notes", null, values(row));
                enqueue(db, row);
                imported++;
            }
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
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
        getWritableDatabase().update("notes", values,
                "id = ? AND reminder_at = ? AND is_deleted = 0 AND sync_deleted = 0 AND owner_id = ?", new String[]{id, Long.toString(expectedDate), SyncSession.owner(context)});
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
        int reminder = cursor.getColumnIndexOrThrow("reminder_at");
        row.put("reminderDate", cursor.isNull(reminder) ? null : cursor.getLong(reminder));
        String[] flags = {"isPinned", "isArchived", "isDeleted", "isReminderSent"};
        String[] columns = {"is_pinned", "is_archived", "is_deleted", "reminder_sent"};
        for (int i = 0; i < flags.length; i++) row.put(flags[i], cursor.getInt(cursor.getColumnIndexOrThrow(columns[i])) == 1);
        List<String> tags = new ArrayList<>();
        try {
            JSONArray array = new JSONArray(cursor.getString(cursor.getColumnIndexOrThrow("tags")));
            for (int i = 0; i < array.length(); i++) tags.add(array.getString(i));
        } catch (Exception error) {
            throw new IllegalStateException("Invalid tags in database", error);
        }
        row.put("tags", tags);
        return row;
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
        try (Cursor cursor = db.query("notes", null, "owner_id = ''", null, null, null, null)) {
            while (cursor.moveToNext()) {
                Map<String, Object> row = read(cursor);
                String oldId = (String) row.get("id");
                row.put("id", syncId(oldId)); row.put("ownerId", owner);
                row.put("editId", UUID.randomUUID().toString());
                db.update("notes", values(row), "id = ? AND owner_id = ''", new String[]{oldId});
                enqueue(db, row);
            }
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
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
                // Reminder delivery belongs to this device, not the cloud's delivery channel.
                if (local != null && Objects.equals(local.get("reminderDate"), next.get("reminderDate")))
                    next.put("isReminderSent", local.get("isReminderSent"));
                db.insertWithOnConflict("notes", null, values(next), SQLiteDatabase.CONFLICT_REPLACE);
                if (Boolean.TRUE.equals(next.get("syncDeleted")) && owner.equals(SyncSession.owner(context)))
                    ReminderScheduler.cancel(context, id);
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
        row.put("createdAt", Instant.parse(source.getString("created_at")).toEpochMilli());
        row.put("updatedAt", Instant.parse(source.getString("updated_at")).toEpochMilli());
        row.put("reminderDate", source.isNull("reminder_date") ? null : Instant.parse(source.getString("reminder_date")).toEpochMilli());
        row.put("isPinned", source.optBoolean("is_pinned")); row.put("isArchived", source.optBoolean("is_archived"));
        row.put("isDeleted", source.optBoolean("is_deleted")); row.put("syncDeleted", source.optBoolean("sync_deleted"));
        row.put("isReminderSent", false);
        List<String> tags = new ArrayList<>(); JSONArray array = source.optJSONArray("tags");
        if (array != null) for (int i=0; i<array.length(); i++) tags.add(array.getJSONObject(i).getString("name"));
        row.put("tags", tags); return row;
    }

}
