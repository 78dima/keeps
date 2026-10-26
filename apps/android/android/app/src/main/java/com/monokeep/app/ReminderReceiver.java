package com.monokeep.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public final class ReminderReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        String id = intent.getStringExtra("noteId");
        if (id == null) return;
        PendingResult pending = goAsync();
        NoteDatabase.IO.execute(() -> {
            try { ReminderScheduler.deliver(context.getApplicationContext(), id); }
            finally { pending.finish(); }
        });
    }
}
