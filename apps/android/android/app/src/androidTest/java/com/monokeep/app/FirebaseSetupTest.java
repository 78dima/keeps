package com.monokeep.app;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.google.android.gms.tasks.Tasks;
import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.concurrent.TimeUnit;
import static org.junit.Assert.*;
import static org.junit.Assume.assumeTrue;

@RunWith(AndroidJUnit4.class)
public class FirebaseSetupTest {
    @Test public void defaultAppExistsBeforeOpeningActivityOrSigningIn() {
        // The provider must initialize a cold process started by a background FCM event.
        assertEquals("monokeep-78dima-sync", FirebaseApp.getInstance().getOptions().getProjectId());
        assertEquals("433473461790", FirebaseApp.getInstance().getOptions().getGcmSenderId());
    }

    @Test public void googlePlayServicesCanRegisterForCloudMessaging() throws Exception {
        assumeTrue("true".equals(InstrumentationRegistry.getArguments().getString("monokeepFcmCheck")));
        // Opt-in live infrastructure check. Never print the device registration token.
        String token = Tasks.await(FirebaseMessaging.getInstance().getToken(), 60, TimeUnit.SECONDS);
        assertNotNull(token);
        assertFalse(token.isEmpty());
        Tasks.await(FirebaseMessaging.getInstance().deleteToken(), 30, TimeUnit.SECONDS);
    }
}
