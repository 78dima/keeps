package com.monokeep.app;

import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class NoteDatabaseTest {
    private Context context;
    private NoteDatabase db;
    @Before public void setup() {
        context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        context.deleteDatabase("test-notes.db");
        db = new NoteDatabase(context, "test-notes.db");
    }
    @After public void cleanup() { db.close(); context.deleteDatabase("test-notes.db"); }
    private Map<String, Object> row(Object... pairs) {
        Map<String, Object> row = new HashMap<>();
        for (int i = 0; i < pairs.length; i += 2) row.put((String) pairs[i], pairs[i + 1]);
        return row;
    }
    @Test public void dataSurvivesDatabaseReopen() {
        Map<String, Object> note = db.save(row("title", "Привет", "content", "One\nTwo", "tags", Arrays.asList("a", "a")));
        db.close(); db = new NoteDatabase(context, "test-notes.db");
        Map<String, Object> loaded = db.find((String) note.get("id"));
        assertEquals("Привет", loaded.get("title"));
        assertEquals("One\nTwo", loaded.get("content"));
        assertEquals(Arrays.asList("a"), loaded.get("tags"));
    }
    @Test public void creationRetryAfterReopenKeepsOneRowAndDoesNotOverwriteNewerEdits() {
        String key = java.util.UUID.randomUUID().toString();
        Map<String,Object> request = row("creationId",key,"title","original","color","#f28b82","reminderDate",2000000000000L);
        Map<String,Object> first = db.save(request);
        assertEquals(key,first.get("id"));
        db.close(); db = new NoteDatabase(context,"test-notes.db");
        Map<String,Object> retry = db.save(request);
        assertEquals(first.get("editId"),retry.get("editId"));
        assertEquals(first.get("updatedAt"),retry.get("updatedAt"));
        assertEquals(1,db.list().size());
        db.save(row("id",key,"title","newer edit"));
        assertEquals("newer edit",db.save(request).get("title"));
        db.save(row("id",key,"isDeleted",true)); db.deleteForever(key);
        assertEquals(true,db.save(request).get("syncDeleted"));
        assertNull(db.find(key));
    }
    @Test public void creationKeyCannotReadAnotherAccountOrCreateAnEmptyNote() {
        String key = java.util.UUID.randomUUID().toString();
        db.save(row("creationId",key,"title","private"));
        db.getWritableDatabase().execSQL("UPDATE notes SET owner_id = 'another-owner' WHERE id = ?",new Object[]{key});
        try { db.save(row("creationId",key,"title","overwrite")); fail("Must reject another owner"); }
        catch (SecurityException expected) { /* No cross-account acknowledgement. */ }
        try { db.save(row("creationId",java.util.UUID.randomUUID().toString(),"title","  ","content","\n")); fail("Must reject empty creation"); }
        catch (IllegalArgumentException expected) { /* No blank notes. */ }
        try { db.save(row("id",java.util.UUID.randomUUID().toString(),"title","stale")); fail("Must not turn a missing update into a creation"); }
        catch (IllegalArgumentException expected) { /* Existing update contract is retained. */ }
    }
    @Test public void editorSaveDoesNotUndoNotificationDeliveredInBackground() {
        long time = 1000L;
        String id = (String) db.save(row("title", "Reminder", "reminderDate", time)).get("id");
        db.markReminderSent(id, time);
        assertEquals(true, db.save(row("id", id, "title", "Edited", "reminderDate", time, "isReminderSent", false)).get("isReminderSent"));
        assertEquals(false, db.save(row("id", id, "reminderDate", 2000L)).get("isReminderSent"));
        db.markReminderSent(id, time); // A stale alarm may not mark a new reminder as sent.
        assertEquals(false, db.find(id).get("isReminderSent"));
        assertNull(db.save(row("id", id, "reminderDate", null)).get("reminderDate"));
    }
    @Test public void permanentDeleteRequiresTrashAndCannotResurrectMissingNote() {
        String id = (String) db.save(row("title", "Keep me")).get("id");
        db.deleteForever(id); assertNotNull(db.find(id));
        db.save(row("id", id, "isDeleted", true)); db.deleteForever(id); assertNull(db.find(id));
        try { db.save(row("id", id, "title", "Stale editor")); fail("Should reject missing note"); }
        catch (IllegalArgumentException expected) { /* required */ }
    }
    @Test public void repeatedImportPreservesLocalEditsAndIsAtomic() throws Exception {
        Map<String, Object> source = row("title", "Original", "importKey", "unique import");
        assertEquals(1, db.importNotes(Arrays.asList(source)));
        String id = (String) db.list().get(0).get("id");
        db.save(row("id", id, "title", "Local edit"));
        assertEquals(0, db.importNotes(Arrays.asList(source)));
        assertEquals("Local edit", db.find(id).get("title"));
        try { db.importNotes(Arrays.asList(row("id", "rollback", "title", "Rollback"), null)); fail("Expected invalid batch"); }
        catch (NullPointerException expected) { /* Transaction must roll back. */ }
        assertNull(db.find("rollback"));
    }
    @Test public void collidingStringHashesDoNotCollideInAndroidAlarms() {
        assertEquals("Aa".hashCode(), "BB".hashCode());
        assertNotEquals(ReminderScheduler.alarmIntent(context, "Aa"), ReminderScheduler.alarmIntent(context, "BB"));
        ReminderScheduler.cancel(context, "Aa"); ReminderScheduler.cancel(context, "BB");
    }
}
