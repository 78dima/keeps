package com.monokeep.app;

import android.os.PowerManager;
import android.content.Context;
import android.view.Display;
import androidx.lifecycle.Lifecycle;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class DisplayRefreshTest {
    @Test public void foregroundVoteKeepsResolutionAndClearsInBackground() {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> {
                PowerManager power = (PowerManager) activity.getSystemService(Context.POWER_SERVICE);
                Display display = activity.getWindowManager().getDefaultDisplay();
                Display.Mode current = display.getMode();
                float max = current.getRefreshRate();
                for (Display.Mode mode : display.getSupportedModes()) {
                    if (mode.getPhysicalWidth() == current.getPhysicalWidth() &&
                        mode.getPhysicalHeight() == current.getPhysicalHeight()) max = Math.max(max, mode.getRefreshRate());
                }
                assertEquals(power.isPowerSaveMode() ? 0f : max,
                    activity.getWindow().getAttributes().preferredRefreshRate, 0.01f);
            });
            scenario.moveToState(Lifecycle.State.CREATED);
            scenario.onActivity(activity -> {
                assertEquals(0f, activity.getWindow().getAttributes().preferredRefreshRate, 0f);
                assertEquals(0, activity.getWindow().getAttributes().preferredDisplayModeId);
            });
            scenario.moveToState(Lifecycle.State.RESUMED);
        }
    }
}
