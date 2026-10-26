package com.monokeep.app;
import android.content.Context;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import org.json.JSONObject;
import com.google.firebase.messaging.FirebaseMessaging;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
public final class SyncMessaging extends FirebaseMessagingService {
    static void register(Context context) {
        if (FirebaseApp.getApps(context).isEmpty() && FirebaseApp.initializeApp(context)==null) {
            // Client options are public. Service account credentials belong exclusively on the server.
            try (java.io.InputStream input=context.getAssets().open("firebase-config.json")) {
                java.io.ByteArrayOutputStream output=new java.io.ByteArrayOutputStream();
                byte[] buffer=new byte[4096]; int count;
                while((count=input.read(buffer))!=-1) output.write(buffer,0,count);
                JSONObject config=new JSONObject(output.toString("UTF-8"));
                FirebaseApp.initializeApp(context,new FirebaseOptions.Builder()
                    .setApplicationId(config.getString("applicationId")).setApiKey(config.getString("apiKey"))
                    .setProjectId(config.getString("projectId")).setGcmSenderId(config.getString("senderId")).build());
            } catch (Exception unavailable) { return; }
        }
        FirebaseMessaging.getInstance().getToken().addOnSuccessListener(token -> {
            context.getSharedPreferences("sync-device",0).edit().putString("fcm_token",token).apply();
            SyncEngine.request(context);
        });
    }
    @Override public void onNewToken(String token) {
        getSharedPreferences("sync-device",0).edit().putString("fcm_token",token).apply();
        SyncEngine.request(this);
    }
    @Override public void onMessageReceived(RemoteMessage message) {
        if ("sync".equals(message.getData().get("type")) && SyncSession.owner(this).equals(message.getData().get("user_id")))
            SyncEngine.request(this);
    }
}
