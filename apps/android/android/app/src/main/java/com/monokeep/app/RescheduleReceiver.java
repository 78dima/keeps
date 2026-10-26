package com.monokeep.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public final class RescheduleReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        PendingResult pending = goAsync();
        NoteDatabase.IO.execute(() -> {
            try { ReminderScheduler.rescheduleAll(context.getApplicationContext()); }
            finally { pending.finish(); }
        });
    }
}
