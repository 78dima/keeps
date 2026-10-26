package com.monokeep.app;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import org.json.JSONArray;
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
        super(context, name, null, 1);
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
    }

    @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        // Never destroy user notes to migrate a schema.
        throw new IllegalStateException("Unsupported database migration: " + oldVersion + " → " + newVersion);
    }

    public List<Map<String, Object>> list() {
        List<Map<String, Object>> result = new ArrayList<>();
        try (Cursor cursor = getReadableDatabase().query("notes", null, null, null, null, null,
                "reminder_sent DESC, updated_at DESC, id ASC")) {
            while (cursor.moveToNext()) result.add(read(cursor));
        }
        return result;
    }

    public Map<String, Object> find(String id) {
        try (Cursor cursor = getReadableDatabase().query("notes", null, "id = ?", new String[]{id}, null, null, null)) {
            return cursor.moveToFirst() ? read(cursor) : null;
        }
    }

    public Map<String, Object> save(Map<String, Object> patch) {
        String id = patch.get("id") instanceof String ? (String) patch.get("id") : UUID.randomUUID().toString();
        Map<String, Object> existing = find(id);
        if (patch.containsKey("id") && existing == null) throw new IllegalArgumentException("This note no longer exists");
        long now = System.currentTimeMillis();
        Map<String, Object> row = existing == null ? new HashMap<>() : new HashMap<>(existing);
        row.putAll(patch);
        row.put("id", id);
        row.put("createdAt", existing == null ? now : existing.get("createdAt"));
        row.put("updatedAt", now);
        // Updating content or pin status cannot undo a reminder delivered while the editor was open.
        if (existing != null) row.put("isReminderSent", existing.get("isReminderSent"));
        if (patch.containsKey("reminderDate") &&
                (existing == null || !Objects.equals(existing.get("reminderDate"), patch.get("reminderDate")))) {
            row.put("isReminderSent", false);
        }
        if (row.get("reminderDate") == null) row.put("isReminderSent", false);
        ContentValues values = values(row);
        if (existing == null) getWritableDatabase().insertOrThrow("notes", null, values);
        else getWritableDatabase().update("notes", values, "id = ?", new String[]{id});
        return find(id);
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
                if (find((String) row.get("id")) != null) continue;
                db.insertOrThrow("notes", null, values(row));
                imported++;
            }
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
        return imported;
    }

    public void deleteForever(String id) {
        // Permanent deletion is only valid from trash.
        getWritableDatabase().delete("notes", "id = ? AND is_deleted = 1", new String[]{id});
    }

    public void markReminderSent(String id, long expectedDate) {
        ContentValues values = new ContentValues();
        values.put("reminder_sent", 1);
        getWritableDatabase().update("notes", values,
                "id = ? AND reminder_at = ? AND is_deleted = 0", new String[]{id, Long.toString(expectedDate)});
    }

    private static ContentValues values(Map<String, Object> row) {
        ContentValues values = new ContentValues();
        values.put("id", Objects.toString(row.get("id"), ""));
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
}
