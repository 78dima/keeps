package com.monokeep.app;

import android.content.Context;
import android.content.Intent;
import android.os.SystemClock;
import androidx.work.*;
import okhttp3.*;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.TimeUnit;

/** The foreground UI and WorkManager use the same authenticated, retryable engine. */
public final class SyncEngine {
    static final ExecutorService NETWORK = Executors.newSingleThreadExecutor();
    static final OkHttpClient HTTP = new OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS).callTimeout(45, TimeUnit.SECONDS).build();
    private static JSONObject config;
    private static volatile String error = "";
    private static volatile boolean running;
    private static final java.util.concurrent.atomic.AtomicBoolean foregroundQueued = new java.util.concurrent.atomic.AtomicBoolean();
    private static final java.util.concurrent.atomic.AtomicBoolean foregroundDirty = new java.util.concurrent.atomic.AtomicBoolean();
    private static final java.util.concurrent.ScheduledExecutorService SCHEDULER = Executors.newSingleThreadScheduledExecutor();
    private static final java.util.concurrent.atomic.AtomicBoolean backgroundQueued = new java.util.concurrent.atomic.AtomicBoolean();
    private static final Object LOCK = new Object();
    static synchronized JSONObject config(Context c) throws Exception {
        if (config == null) {
            try (InputStream in = c.getAssets().open("sync-config.json")) {
                java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
                byte[] buf = new byte[4096]; int n; while ((n = in.read(buf)) != -1) out.write(buf,0,n);
                config = new JSONObject(out.toString("UTF-8"));
            }
            if (!config.getString("url").startsWith("https://")) throw new IOException("HTTPS is required");
        }
        return config;
    }
    static JSONObject call(Context c, String path, JSONObject body, String token) throws Exception {
        JSONObject settings = config(c);
        Request.Builder request = new Request.Builder().url(settings.getString("url") + path)
            .header("apikey", settings.getString("publishableKey"))
            .post(RequestBody.create(body.toString(), MediaType.get("application/json")));
        if (token != null) request.header("Authorization", "Bearer " + token);
        long wall = System.currentTimeMillis(), elapsed = SystemClock.elapsedRealtime();
        try (Response response = HTTP.newCall(request.build()).execute()) {
            String text = response.body() == null ? "{}" : response.body().string();
            if (!response.isSuccessful()) {
                // Avoid returning server payloads or tokens to the UI/logs.
                if (response.code() == 401 || response.code() == 400 && path.startsWith("/auth/"))
                    throw new IOException("Sign in again or check your email and password");
                throw new IOException("Sync request failed (HTTP " + response.code() + ")");
            }
            String date = response.header("Date");
            if (date != null) try {
                SyncClock.sample(c, java.time.ZonedDateTime.parse(date, java.time.format.DateTimeFormatter.RFC_1123_DATE_TIME).toInstant().toString(), wall, elapsed);
            } catch (Exception ignored) { /* RPC clock below is more precise. */ }
            return decodeResponse(c, text, wall, elapsed);
        }
    }
    static JSONObject decodeResponse(Context c, String text, long wall, long elapsed) throws Exception {
        JSONObject result = new JSONObject(text);
        if (result.has("server_time")) SyncClock.sample(c, result.getString("server_time"), wall, elapsed);
        return result;
    }
    static String accessToken(Context c) throws Exception {
        synchronized (LOCK) {
            JSONObject session = SyncSession.read(c);
            if (session == null) throw new IOException("Sign in to synchronize");
            if (session.optLong("expires_at") <= System.currentTimeMillis()/1000 + 120) {
                JSONObject refreshed = call(c, "/auth/v1/token?grant_type=refresh_token",
                    new JSONObject().put("refresh_token",session.getString("refresh_token")), null);
                if (!refreshed.has("expires_at")) refreshed.put("expires_at",System.currentTimeMillis()/1000+refreshed.getLong("expires_in"));
                SyncSession.save(c, refreshed); session = refreshed;
            }
            return session.getString("access_token");
        }
    }
    static void signIn(Context c, String email, String password) throws Exception {
        synchronized (LOCK) {
            JSONObject session = call(c,"/auth/v1/token?grant_type=password",new JSONObject().put("email",email).put("password",password), null);
            if (!session.has("expires_at")) session.put("expires_at",System.currentTimeMillis()/1000+session.getLong("expires_in"));
            NoteDatabase.IO.submit(() -> {
                try {
                    for (Map<String,Object> note : NoteDatabase.get(c).list()) ReminderScheduler.cancel(c,(String)note.get("id"));
                    SyncSession.save(c,session);
                    NoteDatabase.get(c).adoptGuestNotes(SyncSession.owner(c));
                    ReminderScheduler.rescheduleAll(c);
                } catch (Exception e) { throw new RuntimeException(e); }
            }).get();
            error = "";
        }
        install(c); request(c); changed(c);
    }
    static void signOut(Context c) throws Exception {
        synchronized (LOCK) {
            // Local logout always works offline. Pending edits remain tied to their owner.
            NoteDatabase.IO.submit(() -> {
                for (Map<String,Object> note : NoteDatabase.get(c).list()) ReminderScheduler.cancel(c,(String)note.get("id"));
                SyncSession.clear(c); error = "";
            }).get();
        }
        SyncRealtime.stop();
        WorkManager.getInstance(c).cancelUniqueWork("monokeep-sync-periodic");
        WorkManager.getInstance(c).cancelUniqueWork("monokeep-sync-now");
        changed(c);
    }
    public static void install(Context c) {
        if (SyncSession.owner(c).isEmpty()) return;
        Constraints network = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        WorkManager.getInstance(c).enqueueUniquePeriodicWork("monokeep-sync-periodic", ExistingPeriodicWorkPolicy.KEEP,
            new PeriodicWorkRequest.Builder(SyncWorker.class,15,TimeUnit.MINUTES).setConstraints(network).build());
        SyncMessaging.register(c);
    }
    public static void request(Context c) {
        if (SyncSession.owner(c).isEmpty()) return;
        if (!SyncRealtime.isForeground()) { background(c); return; }
        foregroundDirty.set(true);
        if (!foregroundQueued.compareAndSet(false,true)) return;
        NETWORK.execute(() -> {
            boolean succeeded = false;
            try {
                do {
                    foregroundDirty.set(false);
                    synchronize(c.getApplicationContext());
                } while (foregroundDirty.get() && SyncRealtime.isForeground());
                succeeded = true;
            } catch (Exception ignored) { background(c); }
            finally {
                foregroundQueued.set(false);
                // Close the race between the last dirty check and releasing the queue flag.
                if (succeeded && foregroundDirty.get()) request(c);
            }
        });
    }
    private static void background(Context c) {
        if (!backgroundQueued.compareAndSet(false,true)) return;
        SCHEDULER.schedule(() -> {
            backgroundQueued.set(false);
            if (SyncSession.owner(c).isEmpty()) return;
            try {
                WorkManager manager=WorkManager.getInstance(c);
                // At most one running worker plus one successor. An unstarted worker will read
                // all persisted edits; a running worker gets a successor so the final ACK race is safe.
                for (WorkInfo info : manager.getWorkInfosForUniqueWork("monokeep-sync-now").get()) {
                    if (info.getState()==WorkInfo.State.ENQUEUED || info.getState()==WorkInfo.State.BLOCKED) return;
                }
                manager.enqueueUniqueWork("monokeep-sync-now", ExistingWorkPolicy.APPEND_OR_REPLACE,
                    new OneTimeWorkRequest.Builder(SyncWorker.class)
                        .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                        .setBackoffCriteria(BackoffPolicy.EXPONENTIAL,30,TimeUnit.SECONDS).build()).getResult().get();
            } catch (Exception ignored) { /* The durable periodic worker still catches up. */ }
        },300,TimeUnit.MILLISECONDS);
    }
    static void synchronize(Context c) throws Exception {
        synchronized (LOCK) {
            String owner = SyncSession.owner(c);
            if (owner.isEmpty()) return;
            running = true; changed(c);
            try {
                NoteDatabase db = NoteDatabase.get(c);
                // Resume a first-login adoption interrupted after the encrypted session was saved.
                NoteDatabase.IO.submit(() -> db.adoptGuestNotes(owner)).get();
                // Bound each worker run. Remaining batches are durable and continued by a new worker.
                for (int round=0; round<20; round++) {
                    JSONArray pending = db.pending(owner);
                    if (pending.length()==0) break;
                    JSONObject response = call(c,"/rest/v1/rpc/sync_push",new JSONObject().put("entity","notes").put("documents",pending),accessToken(c));
                    acceptOnStorageThread(db,owner,response.getJSONArray("rows"),null);
                }
                String checkpoint = db.checkpoint(owner);
                for (int round=0; round<100; round++) {
                    JSONObject response = call(c,"/rest/v1/rpc/sync_pull",new JSONObject().put("entity","notes").put("after_revision",checkpoint).put("page_size",100),accessToken(c));
                    JSONArray rows = response.getJSONArray("rows");
                    if (rows.length()>0) checkpoint = rows.getJSONObject(rows.length()-1).getString("sync_revision");
                    acceptOnStorageThread(db,owner,rows,checkpoint);
                    if (rows.length()<100) break;
                    if (round==99) request(c);
                }
                if (db.pendingCount(owner)>0) request(c);
                registerDevice(c,owner);
                error = "";
            } catch (Exception e) {
                error = e instanceof IOException ? e.getMessage() : "Could not synchronize. Your changes are saved on this device.";
                throw e;
            } finally {
                running = false;
                NoteDatabase.IO.execute(() -> { ReminderScheduler.rescheduleAll(c); changed(c); });
            }
        }
    }
    private static void acceptOnStorageThread(NoteDatabase db,String owner,JSONArray rows,String revision) throws Exception {
        NoteDatabase.IO.submit(() -> {
            try { db.accept(owner,rows,revision); }
            catch (Exception e) { throw new RuntimeException(e); }
        }).get();
    }
    private static void registerDevice(Context c,String owner) throws Exception {
        String token = c.getSharedPreferences("sync-device",0).getString("fcm_token","");
        if (token.isEmpty()) return;
        JSONObject row = new JSONObject().put("user_id",owner).put("device_id",deviceId(c)).put("fcm_token",token)
            .put("updated_at",java.time.Instant.now().toString());
        Request request = new Request.Builder().url(config(c).getString("url")+"/rest/v1/sync_devices?on_conflict=user_id,device_id")
            .header("apikey",config(c).getString("publishableKey")).header("Authorization","Bearer "+accessToken(c))
            .header("Prefer","resolution=merge-duplicates").post(RequestBody.create(row.toString(),MediaType.get("application/json"))).build();
        try (Response response = HTTP.newCall(request).execute()) {
            if (!response.isSuccessful()) throw new IOException("Could not register background sync (HTTP "+response.code()+")");
        }
    }
    static String deviceId(Context c) {
        android.content.SharedPreferences p=c.getSharedPreferences("sync-device",0);
        String id=p.getString("id","");
        if (id.isEmpty()) { id=UUID.randomUUID().toString(); p.edit().putString("id",id).commit(); }
        return id;
    }
    static Map<String,Object> status(Context c) {
        Map<String,Object> state = new HashMap<>();
        String owner=SyncSession.owner(c);
        state.put("email",SyncSession.email(c)); state.put("signedIn",!owner.isEmpty()); state.put("running",running);
        state.put("pending",NoteDatabase.get(c).pendingCount(owner)); state.put("error",error);
        state.put("pushEnabled",!c.getSharedPreferences("sync-device",0).getString("fcm_token","").isEmpty());
        return state;
    }
    static void changed(Context c) { c.sendBroadcast(new Intent(ReminderScheduler.CHANGED).setPackage(c.getPackageName())); }
}
