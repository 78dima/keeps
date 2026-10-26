package com.monokeep.app;
import android.content.Context;
import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
public final class SyncMessaging extends FirebaseMessagingService {
    static void register(Context context) {
        if (FirebaseApp.getApps(context).isEmpty() && FirebaseApp.initializeApp(context)==null) return;
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
