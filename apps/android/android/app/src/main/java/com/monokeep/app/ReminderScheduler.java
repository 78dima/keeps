package com.monokeep.app;

import android.Manifest;
import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import java.util.HashMap;
import java.util.Map;

public final class ReminderScheduler {
    static final String CHANNEL = "note_reminders";
    static final String CHANGED = "com.monokeep.app.NOTES_CHANGED";

    private static NotificationManager notifications(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, "Note reminders", NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("Напоминания о заметках MonoKeep");
            channel.enableVibration(true);
            manager.createNotificationChannel(channel);
        }
        return manager;
    }

    public static boolean allowed(Context context) {
        NotificationManager manager = notifications(context);
        if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return false;
        if (Build.VERSION.SDK_INT >= 24 && !manager.areNotificationsEnabled()) return false;
        return Build.VERSION.SDK_INT < 26 || manager.getNotificationChannel(CHANNEL).getImportance() != NotificationManager.IMPORTANCE_NONE;
    }

    public static Map<String, Object> status(Context context) {
        Map<String, Object> result = new HashMap<>();
        result.put("notifications", allowed(context));
        result.put("exactAlarms", exact(context));
        return result;
    }

    private static boolean exact(Context context) {
        return Build.VERSION.SDK_INT < 31 || context.getSystemService(AlarmManager.class).canScheduleExactAlarms();
    }

    static PendingIntent alarmIntent(Context context, String id) {
        Intent intent = new Intent(context, ReminderReceiver.class)
            .setData(new Uri.Builder().scheme("monokeep").authority("reminder").appendPath(id).build())
            .putExtra("noteId", id);
        // URI identity avoids String.hashCode collisions between distinct note IDs.
        return PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    public static void cancel(Context context, String id) {
        context.getSystemService(AlarmManager.class).cancel(alarmIntent(context, id));
        notifications(context).cancel(id, 0);
    }

    public static void reconcile(Context context, Map<String, Object> note) {
        String id = (String) note.get("id");
        AlarmManager alarms = context.getSystemService(AlarmManager.class);
        alarms.cancel(alarmIntent(context, id));
        if (Boolean.TRUE.equals(note.get("isDeleted")) || note.get("reminderDate") == null) {
            notifications(context).cancel(id, 0);
            return;
        }
        if (Boolean.TRUE.equals(note.get("isReminderSent"))) return;
        notifications(context).cancel(id, 0);
        long when = ((Number) note.get("reminderDate")).longValue();
        if (when <= System.currentTimeMillis()) {
            deliver(context, id);
            return;
        }
        PendingIntent pending = alarmIntent(context, id);
        try {
            if (exact(context)) alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, when, pending);
            else alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, when, pending);
        } catch (SecurityException denied) {
            // Permission can be revoked between checking and scheduling.
            alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, when, pending);
        }
    }

    public static void rescheduleAll(Context context) {
        for (Map<String, Object> note : NoteDatabase.get(context).list()) reconcile(context, note);
    }

    public static void deliver(Context context, String id) {
        NoteDatabase db = NoteDatabase.get(context);
        Map<String, Object> note = db.find(id);
        if (note == null || Boolean.TRUE.equals(note.get("isDeleted")) ||
                Boolean.TRUE.equals(note.get("isReminderSent")) || note.get("reminderDate") == null) return;
        long when = ((Number) note.get("reminderDate")).longValue();
        if (when > System.currentTimeMillis()) {
            reconcile(context, note);
            return;
        }
        // Keep it pending when Android blocks notifications. Retry on foreground/permission change.
        if (!allowed(context)) return;
        Intent open = new Intent(context, MainActivity.class)
            .setAction(Intent.ACTION_VIEW)
            .setData(new Uri.Builder().scheme("monokeep").authority("note").appendPath(id).build())
            .putExtra("noteId", id)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        String body = (String) note.get("content");
        // Notification Binder payloads are bounded; the full note remains in SQLite.
        if (body.length() > 4000) body = body.substring(0, 4000);
        String title = (String) note.get("title");
        if (title.length() > 500) title = title.substring(0, 500);
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(context, CHANNEL) : new Notification.Builder(context);
        builder.setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new Notification.BigTextStyle().bigText(body))
            .setCategory(Notification.CATEGORY_REMINDER)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .setAutoCancel(true)
            .setContentIntent(contentIntent);
        if (Build.VERSION.SDK_INT < 26) builder.setPriority(Notification.PRIORITY_HIGH).setDefaults(Notification.DEFAULT_ALL);
        try {
            notifications(context).notify(id, 0, builder.build());
            db.markReminderSent(id, when);
            context.sendBroadcast(new Intent(CHANGED).setPackage(context.getPackageName()));
        } catch (SecurityException denied) {
            // A denied notification is never recorded as delivered.
        }
    }
}
