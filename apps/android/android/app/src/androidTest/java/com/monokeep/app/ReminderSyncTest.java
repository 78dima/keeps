package com.monokeep.app;

import android.Manifest;
import android.app.NotificationManager;
import android.content.Context;
import android.database.sqlite.SQLiteDatabase;
import android.os.Build;
import android.service.notification.StatusBarNotification;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.*;
import org.junit.runner.RunWith;
import java.time.Instant;
import java.util.*;
import static org.junit.Assert.*;

/** Real SQLite and NotificationManager; all fixtures stay in this test database. */
@RunWith(AndroidJUnit4.class)
public class ReminderSyncTest {
    private static final String OWNER = "81219b1c-cd19-490a-ab00-000000000001";
    private Context context;
    private NoteDatabase db;
    private final Set<String> ids = new HashSet<>();

    @Before public void setup() {
        context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        context.getSharedPreferences("sync-session",0).edit().putString("owner",OWNER).commit();
        context.deleteDatabase("test-reminders.db");
        db = new NoteDatabase(context,"test-reminders.db");
        if (Build.VERSION.SDK_INT >= 33) InstrumentationRegistry.getInstrumentation().getUiAutomation()
            .grantRuntimePermission(context.getPackageName(), Manifest.permission.POST_NOTIFICATIONS);
        assertTrue("Notification assertions require permission", ReminderScheduler.allowed(context));
    }
    @After public void cleanup() {
        for (String id : ids) ReminderScheduler.cancel(context,id);
        db.close(); context.deleteDatabase("test-reminders.db");
        context.getSharedPreferences("sync-session",0).edit().clear().commit();
    }
    private JSONObject remote(long date, boolean sent) throws Exception {
        String id = UUID.randomUUID().toString(); ids.add(id);
        String now = Instant.now().toString();
        return new JSONObject().put("id",id).put("user_id",OWNER).put("title","Reminder regression")
            .put("content","test only").put("created_at",now).put("updated_at",now).put("sort_at",now)
            .put("edit_id",UUID.randomUUID().toString()).put("reminder_version",UUID.randomUUID().toString())
            .put("reminder_date",Instant.ofEpochMilli(date).toString()).put("reminder_enabled",true)
            .put("is_reminder_sent",sent).put("tags",new JSONArray());
    }
    private void accept(JSONObject note) throws Exception { db.accept(OWNER,new JSONArray().put(note),"1"); }
    private Map<String,Object> note(JSONObject json) throws Exception { return db.find(json.getString("id")); }
    private void reconcileAll() {
        for (Map<String,Object> note : db.list()) ReminderScheduler.reconcile(context,db,note);
    }
    private boolean notified(String id) {
        for (StatusBarNotification n : context.getSystemService(NotificationManager.class).getActiveNotifications())
            if (id.equals(n.getTag())) return true;
        return false;
    }
    private void waitForNotification(String id) throws Exception {
        long deadline = System.currentTimeMillis()+3000;
        while (!notified(id) && System.currentTimeMillis()<deadline) Thread.sleep(30);
        assertTrue("Expected scheduled reminder notification",notified(id));
    }
    /** Android 13+ reports POST_NOTIFICATIONS as denied through this context. */
    private Context blocked() {
        Assume.assumeTrue(Build.VERSION.SDK_INT >= 33);
        return new android.content.ContextWrapper(context) {
            @Override public int checkSelfPermission(String permission) {
                return Manifest.permission.POST_NOTIFICATIONS.equals(permission)
                    ? android.content.pm.PackageManager.PERMISSION_DENIED : super.checkSelfPermission(permission);
            }
        };
    }
    private void openVersion(int version, String... files) throws Exception {
        db.close(); context.deleteDatabase("test-reminders.db");
        try(SQLiteDatabase old=context.openOrCreateDatabase("test-reminders.db",0,null)) {
            for(String file:files) {
                try(java.io.InputStream in=context.getAssets().open(file)) {
                    java.io.ByteArrayOutputStream out=new java.io.ByteArrayOutputStream();
                    byte[] buffer=new byte[4096]; int count;
                    while((count=in.read(buffer))!=-1)out.write(buffer,0,count);
                    for(String statement:out.toString("UTF-8").split(";"))if(!statement.trim().isEmpty())old.execSQL(statement);
                }
            }
            old.setVersion(version);
        }
    }
    private void expire(JSONObject source) throws Exception {
        // Advance this fixture's deadline instead of sleeping for an alarm.
        // Keep its version and durable armed bit, as when time simply elapses.
        long past = System.currentTimeMillis()-1000;
        source.put("reminder_date",Instant.ofEpochMilli(past).toString());
        db.getWritableDatabase().execSQL("UPDATE notes SET reminder_at = ? WHERE id = ?",new Object[]{past,source.getString("id")});
    }

    @Test public void firstDownloadOfPastRemindersIsSilentEvenWhenUnsentOrReceiverRuns() throws Exception {
        JSONArray rows = new JSONArray();
        for (int i=0;i<12;i++) rows.put(remote(System.currentTimeMillis()-86400000L,i%2==0));
        db.accept(OWNER,rows,"12");
        reconcileAll();
        for (int i=0;i<rows.length();i++) {
            JSONObject r = rows.getJSONObject(i); String id=r.getString("id");
            ReminderScheduler.deliver(context,db,id); // A leftover alarm cannot bypass eligibility.
            assertFalse(notified(id)); assertEquals(false,note(r).get("reminderArmed"));
            assertEquals(r.getBoolean("is_reminder_sent"),note(r).get("isReminderSent"));
        }
        db.close(); db=new NoteDatabase(context,"test-reminders.db");
        db.accept(OWNER,rows,"12"); reconcileAll();
        for(String id:ids) assertFalse(notified(id));
        assertEquals(0,db.pendingCount(OWNER));
    }

    @Test public void futureAlarmSurvivesReopenWebDeliveryAndDelayedReceiverExactlyOnce() throws Exception {
        JSONObject r=remote(System.currentTimeMillis()+3600000L,false); accept(r);
        String id=r.getString("id"); reconcileAll();
        assertEquals(true,note(r).get("reminderArmed")); assertFalse(notified(id));
        db.close(); db=new NoteDatabase(context,"test-reminders.db");
        expire(r);
        r.put("is_reminder_sent",true); accept(r);
        assertEquals(false,note(r).get("isReminderSent"));
        reconcileAll();
        assertFalse("Sync/open itself must not deliver an overdue reminder",notified(id));
        assertEquals(true,note(r).get("reminderArmed"));
        ReminderScheduler.deliver(context,db,id); waitForNotification(id);
        assertEquals(true,note(r).get("isReminderSent")); assertEquals(false,note(r).get("reminderArmed"));
        Object sort=note(r).get("sortAt"), edit=note(r).get("editId");
        ReminderScheduler.cancel(context,id);
        long cancelDeadline=System.currentTimeMillis()+3000;
        while(notified(id) && System.currentTimeMillis()<cancelDeadline) Thread.sleep(30);
        assertFalse(notified(id));
        accept(r); reconcileAll(); ReminderScheduler.deliver(context,db,id);
        assertFalse(notified(id)); assertEquals(sort,note(r).get("sortAt")); assertEquals(edit,note(r).get("editId"));
        assertEquals(0,db.pendingCount(OWNER));
    }

    @Test public void changingReminderVersionOrDeletingNeverInheritsOldAlarmEligibility() throws Exception {
        JSONObject r=remote(System.currentTimeMillis()+3600000L,false); accept(r); reconcileAll();
        r.put("reminder_date",Instant.ofEpochMilli(System.currentTimeMillis()-86400000L).toString())
            .put("reminder_version",UUID.randomUUID().toString()).put("edit_id",UUID.randomUUID().toString())
            .put("updated_at",Instant.now().plusSeconds(1).toString());
        accept(r); reconcileAll(); ReminderScheduler.deliver(context,db,r.getString("id"));
        assertEquals(false,note(r).get("reminderArmed")); assertFalse(notified(r.getString("id")));
        r.put("reminder_date",Instant.now().plusSeconds(3600).toString())
            .put("reminder_version",UUID.randomUUID().toString()).put("is_deleted",true);
        accept(r); reconcileAll(); assertEquals(false,note(r).get("reminderArmed"));
        assertFalse(notified(r.getString("id")));
    }

    @Test public void returningToAccountDoesNotReplayExpiredAlarmsAndKeepsFutureOnes() throws Exception {
        JSONObject past=remote(System.currentTimeMillis()+3600000L,false), future=remote(System.currentTimeMillis()+7200000L,false);
        accept(past); accept(future); reconcileAll();
        db.disarmReminders(); // The same operation used when leaving/entering an account.
        expire(past);
        context.getSharedPreferences("sync-session",0).edit().putString("owner",UUID.randomUUID().toString()).commit();
        assertTrue(db.list().isEmpty()); ReminderScheduler.deliver(context,db,past.getString("id"));
        context.getSharedPreferences("sync-session",0).edit().putString("owner",OWNER).commit();
        reconcileAll();
        assertFalse(notified(past.getString("id"))); assertEquals(false,note(past).get("reminderArmed"));
        assertEquals(true,note(future).get("reminderArmed"));
    }

    @Test public void importedBackupCannotRestoreAnotherDevicesArmedFlag() throws Exception {
        JSONObject past=remote(System.currentTimeMillis()-86400000L,false);
        Map<String,Object> imported=NoteDatabase.fromServer(past); imported.put("reminderArmed",true);
        assertEquals(1,db.importNotes(Collections.singletonList(imported))); reconcileAll();
        assertEquals(false,note(past).get("reminderArmed")); assertFalse(notified(past.getString("id")));
        assertFalse(db.pending(OWNER).getJSONObject(0).has("reminderArmed"));
        assertFalse(db.pending(OWNER).getJSONObject(0).has("reminder_armed"));
    }

    @Test public void serverSentFlagIsHonoredAndOnlyNewFutureReminderCanRearm() throws Exception {
        JSONObject r=remote(System.currentTimeMillis()+3600000L,true); accept(r); reconcileAll();
        String id=r.getString("id");
        assertEquals(false,note(r).get("reminderArmed"));
        Map<String,Object> patch=new HashMap<>(); patch.put("id",id);
        patch.put("reminderDate",System.currentTimeMillis()+7200000L);
        db.save(patch); reconcileAll(); assertEquals(true,note(r).get("reminderArmed"));
        patch.remove("reminderDate"); patch.put("title","Text edit keeps scheduled reminder");
        db.save(patch); assertEquals(true,note(r).get("reminderArmed"));
        patch.put("reminderEnabled",false); db.save(patch); reconcileAll();
        expire(r); ReminderScheduler.deliver(context,db,id);
        assertEquals(false,note(r).get("reminderArmed")); assertFalse(notified(id));
    }

    @Test public void deniedNotificationDoesNotBecomeALateBurstWhenPermissionReturns() throws Exception {
        Context blocked=blocked();
        JSONObject r=remote(System.currentTimeMillis()+3600000L,false); accept(r); reconcileAll(); expire(r);
        String id=r.getString("id"); ReminderScheduler.deliver(blocked,db,id);
        assertEquals(false,note(r).get("isReminderSent")); assertEquals(false,note(r).get("reminderArmed"));
        reconcileAll(); ReminderScheduler.deliver(context,db,id); assertFalse(notified(id));
    }

    @Test public void upgradeFromV3PreservesNotesAndQueueWithoutReplayingPast() throws Exception {
        db.close(); context.deleteDatabase("test-reminders.db");
        String id=UUID.randomUUID().toString(); ids.add(id);
        try(SQLiteDatabase old=context.openOrCreateDatabase("test-reminders.db",0,null)) {
            for(String file:new String[]{"schema.sql","sync-migration.sql","reminder-migration.sql"}) {
                try(java.io.InputStream in=context.getAssets().open(file)) {
                    java.io.ByteArrayOutputStream out=new java.io.ByteArrayOutputStream();
                    byte[] buffer=new byte[4096]; int count;
                    while((count=in.read(buffer))!=-1)out.write(buffer,0,count);
                    for(String statement:out.toString("UTF-8").split(";"))if(!statement.trim().isEmpty())old.execSQL(statement);
                }
            }
            old.execSQL("INSERT INTO notes(id,owner_id,title,created_at,updated_at,reminder_at) VALUES(?,?,?,1,1234,1000)",new Object[]{id,OWNER,"Keep old note"});
            old.execSQL("INSERT INTO sync_outbox(note_id,owner_id,edit_id,payload) VALUES(?,?,?,?)",new Object[]{id,OWNER,"00000000-0000-0000-0000-000000000000","{\"title\":\"queued\"}"});
            old.execSQL("INSERT INTO sync_state(owner_id,revision) VALUES(?,?)",new Object[]{OWNER,"987"});
            old.setVersion(3);
        }
        db=new NoteDatabase(context,"test-reminders.db"); reconcileAll(); ReminderScheduler.deliver(context,db,id);
        assertEquals(5,db.getReadableDatabase().getVersion()); assertEquals("Keep old note",db.find(id).get("title"));
        assertEquals(1234L,db.find(id).get("updatedAt")); assertEquals(false,db.find(id).get("reminderArmed"));
        // v5 pulls every note again to record server delivery flags.
        assertEquals("0",db.checkpoint(OWNER)); assertEquals("queued",db.pending(OWNER).getJSONObject(0).getString("title"));
        assertFalse(notified(id));
    }

    @Test public void webDeliveryPulledWhileArmedShowsWhenBlockedAlarmFires() throws Exception {
        Context blocked=blocked();
        JSONObject r=remote(System.currentTimeMillis()+3600000L,false); accept(r); reconcileAll();
        String id=r.getString("id"); assertEquals(true,note(r).get("reminderArmed"));
        expire(r); r.put("is_reminder_sent",true); accept(r);
        // The armed device still owns delivery, so the web flag is only recorded.
        assertEquals(false,note(r).get("isReminderSent")); assertEquals(true,note(r).get("remoteSent"));
        String token=(String)db.changes(null).get("token");
        ReminderScheduler.deliver(blocked,db,id);
        assertEquals(true,note(r).get("isReminderSent")); assertEquals(false,note(r).get("reminderArmed"));
        assertFalse(notified(id));
        @SuppressWarnings("unchecked") List<Map<String,Object>> rows=(List<Map<String,Object>>)db.changes(token).get("rows");
        assertEquals(1,rows.size()); assertEquals(true,rows.get(0).get("isReminderSent"));
        // Restoring permission neither re-arms nor replays it.
        reconcileAll(); ReminderScheduler.deliver(context,db,id);
        assertFalse(notified(id)); assertEquals(false,note(r).get("reminderArmed"));
    }

    @Test public void blockedNotificationsNeverArmAndSyncShowsWebDelivery() throws Exception {
        Context blocked=blocked();
        JSONObject r=remote(System.currentTimeMillis()+3600000L,false); accept(r);
        assertFalse(ReminderScheduler.reconcile(blocked,db,note(r)));
        assertEquals(false,note(r).get("reminderArmed"));
        expire(r); r.put("is_reminder_sent",true); accept(r);
        assertEquals(true,note(r).get("isReminderSent"));
        reconcileAll(); ReminderScheduler.deliver(context,db,r.getString("id"));
        assertFalse(notified(r.getString("id")));
    }

    @Test public void blockingAfterArmingRevealsWebDeliveryOnReschedule() throws Exception {
        Context blocked=blocked();
        JSONObject r=remote(System.currentTimeMillis()+3600000L,false); accept(r); reconcileAll();
        expire(r); r.put("is_reminder_sent",true); accept(r);
        assertEquals(false,note(r).get("isReminderSent"));
        assertTrue(ReminderScheduler.reconcile(blocked,db,note(r)));
        assertEquals(true,note(r).get("isReminderSent")); assertEquals(false,note(r).get("reminderArmed"));
    }

    @Test public void blockedFutureReminderArmsAgainWhenNotificationsReturn() throws Exception {
        Context blocked=blocked();
        JSONObject r=remote(System.currentTimeMillis()+3600000L,false); accept(r); reconcileAll();
        ReminderScheduler.reconcile(blocked,db,note(r));
        assertEquals(false,note(r).get("reminderArmed")); assertEquals(false,note(r).get("isReminderSent"));
        reconcileAll(); assertEquals(true,note(r).get("reminderArmed"));
    }

    @Test public void newLocalReminderVersionForgetsAnOldWebDelivery() throws Exception {
        Context blocked=blocked();
        JSONObject r=remote(System.currentTimeMillis()-60000L,true); accept(r);
        String id=r.getString("id"); assertEquals(true,note(r).get("remoteSent"));
        Map<String,Object> patch=new HashMap<>(); patch.put("id",id);
        patch.put("reminderDate",System.currentTimeMillis()+3600000L); db.save(patch);
        assertEquals(false,note(r).get("remoteSent")); assertEquals(false,note(r).get("isReminderSent"));
        ReminderScheduler.reconcile(blocked,db,note(r));
        assertEquals(false,note(r).get("isReminderSent"));
    }

    @Test public void upgradeFromV4KeepsArmedAlarmsAndQueueAndPullsDeliveryFlagsAgain() throws Exception {
        String id=UUID.randomUUID().toString(); ids.add(id);
        openVersion(4,"schema.sql","sync-migration.sql","reminder-migration.sql","reminder-arming-migration.sql");
        try(SQLiteDatabase old=context.openOrCreateDatabase("test-reminders.db",0,null)) {
            old.execSQL("INSERT INTO notes(id,owner_id,title,created_at,updated_at,reminder_at,reminder_armed) VALUES(?,?,?,1,1234,?,1)",
                new Object[]{id,OWNER,"Armed before v5",System.currentTimeMillis()+3600000L});
            old.execSQL("INSERT INTO sync_outbox(note_id,owner_id,edit_id,payload) VALUES(?,?,?,?)",new Object[]{id,OWNER,"00000000-0000-0000-0000-000000000000","{\"title\":\"queued\"}"});
            old.execSQL("INSERT INTO sync_state(owner_id,revision) VALUES(?,?)",new Object[]{OWNER,"987"});
        }
        db=new NoteDatabase(context,"test-reminders.db");
        assertEquals(5,db.getReadableDatabase().getVersion());
        Map<String,Object> migrated=db.find(id);
        assertEquals("Armed before v5",migrated.get("title")); assertEquals(1234L,migrated.get("updatedAt"));
        assertEquals(true,migrated.get("reminderArmed")); assertEquals(false,migrated.get("remoteSent"));
        assertEquals("0",db.checkpoint(OWNER)); assertEquals("queued",db.pending(OWNER).getJSONObject(0).getString("title"));
    }
}
