package com.monokeep.app;
import android.content.Context;
import android.database.sqlite.SQLiteDatabase;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.*;
import org.junit.runner.RunWith;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.time.Instant;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class SyncDatabaseTest {
    private Context context; private NoteDatabase db;
    private static final String OWNER="81219b1c-cd19-490a-ab00-000000000001";
    @Before public void setup() {
        context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        context.deleteDatabase("test-sync.db");
        context.getSharedPreferences("sync-session",0).edit().putString("owner",OWNER).commit();
        db=new NoteDatabase(context,"test-sync.db");
    }
    @After public void cleanup() {
        db.close(); context.deleteDatabase("test-sync.db");
        context.getSharedPreferences("sync-session",0).edit().clear().commit();
    }
    private Map<String,Object> row(Object... pairs) {
        Map<String,Object> row=new HashMap<>();
        for(int i=0;i<pairs.length;i+=2) row.put((String)pairs[i],pairs[i+1]);
        return row;
    }
    @Test public void editDuringUploadSurvivesOlderAcknowledgementAndProcessRestart() throws Exception {
        Map<String,Object> original=db.save(row("title","first"));
        JSONObject sent=db.pending(OWNER).getJSONObject(0);
        String id=(String)original.get("id");
        Map<String,Object> newer=db.save(row("id",id,"title","second"));
        db.accept(OWNER,new JSONArray().put(sent),null);
        assertEquals("second",db.find(id).get("title"));
        assertEquals(1,db.pendingCount(OWNER));
        assertEquals(newer.get("editId"),db.pending(OWNER).getJSONObject(0).getString("edit_id"));
        db.close(); db=new NoteDatabase(context,"test-sync.db");
        assertEquals(1,db.pendingCount(OWNER));
        db.accept(OWNER,db.pending(OWNER),null);
        assertEquals(0,db.pendingCount(OWNER));
    }
    @Test public void newerServerEditWinsAndPageCheckpointCommitsWithNotes() throws Exception {
        Map<String,Object> local=db.save(row("title","phone"));
        JSONObject remote=db.pending(OWNER).getJSONObject(0).put("title","web")
            .put("updated_at",Instant.ofEpochMilli((Long)local.get("updatedAt")+1000).toString()).put("edit_id",UUID.randomUUID().toString());
        db.accept(OWNER,new JSONArray().put(remote),"42");
        assertEquals("web",db.find((String)local.get("id")).get("title"));
        assertEquals("42",db.checkpoint(OWNER)); assertEquals(0,db.pendingCount(OWNER));
        JSONObject wrong=new JSONObject(remote.toString()).put("user_id",UUID.randomUUID().toString());
        try { db.accept(OWNER,new JSONArray().put(remote.put("title","rolled back")).put(wrong),"43"); fail(); }
        catch(SecurityException expected) { /* Whole page and checkpoint roll back. */ }
        assertEquals("42",db.checkpoint(OWNER));
        assertEquals("web",db.find((String)local.get("id")).get("title"));
    }
    @Test public void tombstoneSurvivesStalePullAndAccountSwitchDoesNotRelabelIt() throws Exception {
        String id=(String)db.save(row("title","trash","isDeleted",true)).get("id");
        JSONObject old=db.pending(OWNER).getJSONObject(0);
        db.deleteForever(id); assertNull(db.find(id));
        assertTrue(db.pending(OWNER).getJSONObject(0).getBoolean("sync_deleted"));
        db.accept(OWNER,new JSONArray().put(old),"9"); assertNull(db.find(id));
        context.getSharedPreferences("sync-session",0).edit().putString("owner",UUID.randomUUID().toString()).commit();
        assertTrue(db.list().isEmpty()); assertEquals(1,db.pendingCount(OWNER));
    }
    @Test public void webDeliveryDoesNotSuppressDeviceReminderAndDoesNotRearmDeliveredReminder() throws Exception {
        Map<String,Object> local=db.save(row("title","reminder","reminderDate",1000L));
        String id=(String)local.get("id");
        JSONObject remote=db.pending(OWNER).getJSONObject(0).put("is_reminder_sent",true);
        db.accept(OWNER,new JSONArray().put(remote),"1");
        assertEquals(false,db.find(id).get("isReminderSent"));
        db.markReminderSent(id,1000L);
        db.accept(OWNER,new JSONArray().put(remote),"2");
        assertEquals(true,db.find(id).get("isReminderSent"));
        assertEquals(local.get("updatedAt"),db.find(id).get("updatedAt"));
    }
    @Test public void migrateVersionOneAndAdoptGuestNotesWithoutLosingText() throws Exception {
        db.close(); context.deleteDatabase("test-sync.db");
        try(SQLiteDatabase old=context.openOrCreateDatabase("test-sync.db",0,null)) {
            java.io.InputStream stream=context.getAssets().open("schema.sql");
            java.io.ByteArrayOutputStream out=new java.io.ByteArrayOutputStream();
            byte[] buffer=new byte[4096]; int count; while((count=stream.read(buffer))!=-1)out.write(buffer,0,count); stream.close();
            for(String statement:out.toString("UTF-8").split(";")) if(!statement.trim().isEmpty())old.execSQL(statement);
            old.execSQL("INSERT INTO notes(id,title,content,created_at,updated_at) VALUES('import-old','Привет','offline',1,2)");
            old.setVersion(1);
        }
        db=new NoteDatabase(context,"test-sync.db");
        db.adoptGuestNotes(OWNER);
        Map<String,Object> migrated=db.list().get(0);
        assertEquals("Привет",migrated.get("title"));
        assertEquals(2L,migrated.get("updatedAt"));
        UUID.fromString((String)migrated.get("id"));
        assertEquals(1,db.pendingCount(OWNER));
        db.adoptGuestNotes(UUID.randomUUID().toString());
        assertEquals(1,db.list().size());
    }
}
