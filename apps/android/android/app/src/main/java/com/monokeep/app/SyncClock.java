package com.monokeep.app;

import android.content.Context;
import android.os.SystemClock;
import java.time.Instant;

final class SyncClock {
    private static long anchorServer, anchorElapsed;
    static synchronized long now(Context c, long previous) {
        long elapsed = SystemClock.elapsedRealtime();
        long calibrated = anchorServer != 0 && elapsed >= anchorElapsed ? anchorServer + elapsed - anchorElapsed :
            System.currentTimeMillis() + c.getSharedPreferences("sync-clock", 0).getLong("offset", 0);
        return Math.max(calibrated, previous + 1);
    }
    static synchronized void sample(Context c, String server, long startWall, long startElapsed) {
        long elapsed = SystemClock.elapsedRealtime(), duration = elapsed - startElapsed;
        if (duration > 10000) return;
        long serverMs = Instant.parse(server).toEpochMilli();
        anchorServer = serverMs + duration / 2; anchorElapsed = elapsed;
        c.getSharedPreferences("sync-clock", 0).edit().putLong("offset", serverMs - startWall - duration / 2).apply();
    }
}
