package com.monokeep.app;

import android.content.Context;
import okhttp3.*;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.concurrent.*;

/** Supabase Phoenix websocket, only while the Activity is visible. Durable RPC pull does the work. */
final class SyncRealtime {
    private static final ScheduledExecutorService TIMER=Executors.newSingleThreadScheduledExecutor();
    private static WebSocket socket;
    private static ScheduledFuture<?> heartbeat,reconnect;
    private static long generation,ref;
    private static boolean foreground;
    static synchronized boolean isForeground() { return foreground; }
    static synchronized void start(Context context) {
        stop(); foreground=true;
        Context app=context.getApplicationContext(); long expected=generation;
        SyncEngine.install(app); SyncEngine.request(app);
        connect(app,expected);
    }
    static synchronized void stop() {
        foreground=false; generation++;
        if (heartbeat!=null) heartbeat.cancel(false);
        if (reconnect!=null) reconnect.cancel(false);
        if (socket!=null) socket.cancel();
        socket=null;
    }
    private static void connect(Context c,long expected) {
        SyncEngine.NETWORK.execute(() -> {
            try {
                if (SyncSession.owner(c).isEmpty()) return;
                JSONObject config=SyncEngine.config(c);
                String owner=SyncSession.owner(c),token=SyncEngine.accessToken(c);
                String url=config.getString("url").replaceFirst("https://","wss://")+"/realtime/v1/websocket?apikey="+
                    java.net.URLEncoder.encode(config.getString("publishableKey"),"UTF-8")+"&vsn=1.0.0";
                synchronized (SyncRealtime.class) {
                    if (!foreground || generation!=expected) return;
                    socket=SyncEngine.HTTP.newWebSocket(new Request.Builder().url(url).build(),new WebSocketListener() {
                        private String joinRef = "";
                        private long lastCatchUp = android.os.SystemClock.elapsedRealtime();
                        @Override public void onOpen(WebSocket ws,Response response) {
                            synchronized (SyncRealtime.class) {
                                if (generation!=expected || !foreground) { ws.cancel(); return; }
                                try {
                                    JSONArray changes=new JSONArray().put(new JSONObject().put("event","*").put("schema","public")
                                        .put("table","notes").put("filter","user_id=eq."+owner));
                                    joinRef = send(ws,"realtime:notes-sync","phx_join",new JSONObject().put("access_token",token)
                                        .put("config",new JSONObject().put("postgres_changes",changes).put("private",false)));
                                    heartbeat=TIMER.scheduleAtFixedRate(() -> {
                                        SyncEngine.NETWORK.execute(() -> {
                                            synchronized (SyncRealtime.class) {
                                                if (generation!=expected || !foreground) return;
                                            }
                                            try {
                                                send(ws,"phoenix","heartbeat",new JSONObject());
                                                send(ws,"realtime:notes-sync","access_token",new JSONObject().put("access_token",SyncEngine.accessToken(c)));
                                                long now = android.os.SystemClock.elapsedRealtime();
                                                if (now - lastCatchUp >= 60000) {
                                                    lastCatchUp = now; SyncEngine.request(c);
                                                }
                                            } catch (Exception e) { ws.cancel(); retry(c,expected); }
                                        });
                                    },25,25,TimeUnit.SECONDS);
                                } catch (Exception e) { ws.cancel(); retry(c,expected); }
                            }
                        }
                        @Override public void onMessage(WebSocket ws,String text) {
                            try {
                                JSONObject message=new JSONObject(text); String event=message.optString("event");
                                synchronized (SyncRealtime.class) { if (generation != expected || !foreground) return; }
                                if ("postgres_changes".equals(event)) SyncEngine.request(c);
                                if ("phx_reply".equals(event) && joinRef.equals(message.optString("ref"))) {
                                    if ("ok".equals(message.getJSONObject("payload").optString("status"))) SyncEngine.request(c);
                                    else { ws.cancel(); retry(c,expected); }
                                }
                                if ("phx_error".equals(event) || "phx_close".equals(event)) { ws.cancel(); retry(c,expected); }
                            } catch (Exception ignored) { retry(c,expected); }
                        }
                        @Override public void onFailure(WebSocket ws,Throwable error,Response response) { retry(c,expected); }
                        @Override public void onClosed(WebSocket ws,int code,String reason) { retry(c,expected); }
                    });
                }
            } catch (Exception e) { retry(c,expected); }
        });
    }
    private static synchronized void retry(Context c,long expected) {
        if (!foreground || expected!=generation) return;
        if (heartbeat!=null) heartbeat.cancel(false);
        if (reconnect!=null && !reconnect.isDone()) return;
        reconnect=TIMER.schedule(() -> connect(c,expected),10,TimeUnit.SECONDS);
    }
    private static synchronized String send(WebSocket ws,String topic,String event,JSONObject payload) throws Exception {
        String reference = Long.toString(++ref);
        ws.send(new JSONObject().put("topic",topic).put("event",event).put("payload",payload).put("ref",reference).toString());
        return reference;
    }
}
