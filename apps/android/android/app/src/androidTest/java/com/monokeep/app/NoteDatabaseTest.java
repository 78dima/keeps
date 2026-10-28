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
import java.util.HashSet;
import java.util.List;
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
    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> rows(Map<String, Object> changes) { return (List<Map<String, Object>>) changes.get("rows"); }
    @SuppressWarnings("unchecked")
    @Test public void changesSendPreviewsOnceThenOnlyChangedRows() {
        StringBuilder text = new StringBuilder();
        for (int i = 0; i < 300; i++) text.append("слово ");
        Map<String, Object> longNote = db.save(row("title", "Long", "content", text + "КОНЕЦ", "tags", Arrays.asList("Работа")));
        Map<String, Object> shortNote = db.save(row("title", "Short", "content", "small", "reminderDate", 4000000000000L));
        Map<String, Object> full = db.changes(null);
        assertNull(full.get("ids"));
        assertEquals(2, rows(full).size());
        for (Map<String, Object> preview : rows(full)) {
            assertFalse(preview.containsKey("editId"));
            if (preview.get("id").equals(longNote.get("id"))) {
                assertEquals(true, preview.get("isPreview"));
                assertEquals(NoteDatabase.PREVIEW, ((String) preview.get("content")).length());
            } else {
                assertEquals(false, preview.get("isPreview"));
                assertEquals("small", preview.get("content"));
            }
        }
        String token = (String) full.get("token");
        assertEquals(true, db.changes(token).get("unchanged"));
        // Arming is not displayed and must not resend the list.
        assertTrue(db.armReminder(db.find((String) shortNote.get("id"))));
        assertEquals(true, db.changes(token).get("unchanged"));

        db.save(row("id", shortNote.get("id"), "title", "Edited"));
        Map<String, Object> delta = db.changes(token);
        assertEquals(new HashSet<>(Arrays.asList(longNote.get("id"), shortNote.get("id"))), new HashSet<>((List<String>) delta.get("ids")));
        assertEquals(1, rows(delta).size());
        assertEquals("Edited", rows(delta).get(0).get("title"));

        token = (String) delta.get("token");
        db.save(row("id", shortNote.get("id"), "isDeleted", true));
        db.deleteForever((String) shortNote.get("id"));
        delta = db.changes(token);
        assertEquals(Arrays.asList(longNote.get("id")), delta.get("ids"));
        assertTrue(rows(delta).isEmpty());

        // A cursor from another database instance or process is never trusted.
        NoteDatabase other = new NoteDatabase(context, "test-notes.db");
        try { assertNull(other.changes((String) delta.get("token")).get("ids")); }
        finally { other.close(); }
        assertNull(db.changes("garbage").get("ids"));
    }
    @Test public void searchReadsFullContentAndTagsIgnoringCase() {
        StringBuilder text = new StringBuilder();
        for (int i = 0; i < 300; i++) text.append("слово ");
        Map<String, Object> longNote = db.save(row("title", "Long", "content", text + "КОНЕЦ"));
        Map<String, Object> tagged = db.save(row("title", "Tagged", "tags", Arrays.asList("Работа")));
        assertEquals(Arrays.asList(longNote.get("id")), db.search("конец"));
        assertEquals(Arrays.asList(tagged.get("id")), db.search("РАБ"));
        assertTrue(db.search("missing").isEmpty());
    }
    @Test public void onlyNotesWithRemindersNeedRescheduling() {
        Map<String, Object> reminder = db.save(row("title", "Reminder", "reminderDate", 4000000000000L));
        db.save(row("title", "Plain"));
        List<Map<String, Object>> candidates = db.reminderCandidates();
        assertEquals(1, candidates.size());
        assertEquals(reminder.get("id"), candidates.get(0).get("id"));
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
