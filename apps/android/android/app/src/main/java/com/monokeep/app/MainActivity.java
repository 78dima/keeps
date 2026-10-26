package com.monokeep.app;

import android.Manifest;
import android.app.DatePickerDialog;
import android.app.TimePickerDialog;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.OpenableColumns;
import android.provider.Settings;
import android.text.format.DateFormat;
import io.flutter.embedding.android.FlutterActivity;
import io.flutter.embedding.engine.FlutterEngine;
import io.flutter.plugin.common.MethodCall;
import io.flutter.plugin.common.MethodChannel;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public final class MainActivity extends FlutterActivity {
    private static final int IMPORT = 1101, EXPORT = 1102, NOTIFICATIONS = 1103;
    private MethodChannel channel;
    private MethodChannel.Result documentResult, permissionResult, pickerResult;
    private Map<String, Object> pendingIntent;
    private boolean dartReady;
    private boolean receiverRegistered;
    private final BroadcastReceiver changes = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            if (channel != null && dartReady) channel.invokeMethod("notesChanged", null);
        }
    };

    @Override public void configureFlutterEngine(FlutterEngine engine) {
        super.configureFlutterEngine(engine);
        channel = new MethodChannel(engine.getDartExecutor().getBinaryMessenger(), "com.monokeep.app/native");
        channel.setMethodCallHandler(this::handle);
        pendingIntent = readIntent(getIntent());
        IntentFilter filter = new IntentFilter(ReminderScheduler.CHANGED);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(changes, filter, Context.RECEIVER_NOT_EXPORTED);
        else registerReceiver(changes, filter);
        receiverRegistered = true;
    }

    @SuppressWarnings("unchecked")
    private void handle(MethodCall call, MethodChannel.Result result) {
        try {
            switch (call.method) {
                case "syncStatus": io(result, () -> SyncEngine.status(this)); break;
                case "syncNow": SyncEngine.request(this); result.success(null); break;
                case "signIn": network(result, () -> {
                    SyncEngine.signIn(getApplicationContext(), call.argument("email"), call.argument("password"));
                    runOnUiThread(() -> SyncRealtime.start(getApplicationContext()));
                    return SyncEngine.status(this);
                }); break;
                case "signOut": network(result, () -> { SyncEngine.signOut(getApplicationContext()); return null; }); break;
                case "listNotes": io(result, () -> NoteDatabase.get(this).list()); break;
                case "saveNote": io(result, () -> {
                    Map<String, Object> note = NoteDatabase.get(this).save((Map<String, Object>) call.arguments);
                    ReminderScheduler.reconcile(this, note);
                    return NoteDatabase.get(this).find((String) note.get("id"));
                }); break;
                case "deleteForever": io(result, () -> {
                    String id = call.argument("id");
                    Map<String, Object> note = NoteDatabase.get(this).find(id);
                    if (note != null && Boolean.TRUE.equals(note.get("isDeleted"))) {
                        ReminderScheduler.cancel(this, id);
                        NoteDatabase.get(this).deleteForever(id);
                    }
                    return null;
                }); break;
                case "importNotes": io(result, () -> {
                    List<Map<String, Object>> notes = call.argument("notes");
                    int inserted = NoteDatabase.get(this).importNotes(notes);
                    ReminderScheduler.rescheduleAll(this);
                    Map<String, Object> count = new HashMap<>();
                    count.put("imported", inserted);
                    count.put("skipped", notes.size() - inserted);
                    return count;
                }); break;
                case "reschedule": io(result, () -> { ReminderScheduler.rescheduleAll(this); return null; }); break;
                case "notificationStatus": result.success(ReminderScheduler.status(this)); break;
                case "requestNotifications":
                    if (permissionResult != null) { result.error("busy", "Permission request already open", null); break; }
                    if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                        permissionResult = result;
                        requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATIONS);
                    } else result.success(ReminderScheduler.status(this));
                    break;
                case "openSettings": openSettings(call.argument("kind")); result.success(null); break;
                case "pickReminder": pickReminder(call.argument("initial"), result); break;
                case "pickImportFiles":
                    if (documentResult != null) { result.error("busy", "File picker already open", null); break; }
                    documentResult = result;
                    Intent pick = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                        .setType("*/*").putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/json", "text/json", "text/plain", "application/octet-stream"})
                        .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                    startActivityForResult(pick, IMPORT);
                    break;
                case "exportNotes":
                    if (documentResult != null) { result.error("busy", "File picker already open", null); break; }
                    documentResult = result;
                    Intent export = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                        .setType("application/json").putExtra(Intent.EXTRA_TITLE, "MonoKeep-" + new java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.ROOT).format(new java.util.Date()) + ".json");
                    startActivityForResult(export, EXPORT);
                    break;
                case "shareNote":
                    String title = call.argument("title"), content = call.argument("content");
                    Intent share = new Intent(Intent.ACTION_SEND).setType("text/plain")
                        .putExtra(Intent.EXTRA_SUBJECT, title).putExtra(Intent.EXTRA_TEXT, title + "\n\n" + content);
                    startActivity(Intent.createChooser(share, "Share note"));
                    result.success(null);
                    break;
                case "initialIntent":
                    dartReady = true;
                    result.success(pendingIntent);
                    pendingIntent = null;
                    break;
                default: result.notImplemented();
            }
        } catch (Exception error) {
            if (documentResult == result) documentResult = null;
            if (permissionResult == result) permissionResult = null;
            result.error("native_error", error.getMessage(), null);
        }
    }

    @Override protected void onResume() {
        super.onResume();
        SyncRealtime.start(getApplicationContext());
    }
    @Override protected void onPause() {
        SyncRealtime.stop();
        SyncEngine.request(getApplicationContext());
        super.onPause();
    }
    private void network(MethodChannel.Result result, Work work) {
        SyncEngine.NETWORK.execute(() -> {
            try { Object value = work.run(); runOnUiThread(() -> result.success(value)); }
            catch (Exception e) { runOnUiThread(() -> result.error("sync_error", e.getMessage(), null)); }
        });
    }
    private interface Work { Object run() throws Exception; }
    private void io(MethodChannel.Result result, Work work) {
        NoteDatabase.IO.execute(() -> {
            try {
                Object value = work.run();
                runOnUiThread(() -> result.success(value));
            } catch (Exception error) {
                runOnUiThread(() -> result.error("storage_error", error.getMessage(), null));
            }
        });
    }

    private void openSettings(String kind) {
        Intent intent;
        if ("exact".equals(kind) && Build.VERSION.SDK_INT >= 31) {
            intent = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM).setData(Uri.parse("package:" + getPackageName()));
        } else if (Build.VERSION.SDK_INT >= 26) {
            intent = new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName())
                .putExtra(Settings.EXTRA_CHANNEL_ID, ReminderScheduler.CHANNEL);
        } else {
            intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).setData(Uri.parse("package:" + getPackageName()));
        }
        startActivity(intent);
    }

    private void pickReminder(Number initial, MethodChannel.Result result) {
        if (pickerResult != null) { result.error("busy", "Date picker already open", null); return; }
        pickerResult = result;
        Calendar selected = Calendar.getInstance();
        selected.setTimeInMillis(initial == null ? System.currentTimeMillis() + 3600000 : initial.longValue());
        DatePickerDialog date = new DatePickerDialog(this, (view, year, month, day) -> {
            selected.set(year, month, day);
            TimePickerDialog time = new TimePickerDialog(this, (clock, hour, minute) -> {
                selected.set(Calendar.HOUR_OF_DAY, hour);
                selected.set(Calendar.MINUTE, minute);
                selected.set(Calendar.SECOND, 0);
                selected.set(Calendar.MILLISECOND, 0);
                finishPicker(selected.getTimeInMillis());
            }, selected.get(Calendar.HOUR_OF_DAY), selected.get(Calendar.MINUTE), DateFormat.is24HourFormat(this));
            time.setOnCancelListener(dialog -> finishPicker(null));
            time.show();
        }, selected.get(Calendar.YEAR), selected.get(Calendar.MONTH), selected.get(Calendar.DAY_OF_MONTH));
        date.getDatePicker().setMinDate(System.currentTimeMillis() - 1000);
        date.setOnCancelListener(dialog -> finishPicker(null));
        date.show();
    }

    private void finishPicker(Long value) {
        if (pickerResult == null) return;
        MethodChannel.Result result = pickerResult;
        pickerResult = null;
        result.success(value);
    }

    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] grants) {
        super.onRequestPermissionsResult(request, permissions, grants);
        if (request == NOTIFICATIONS && permissionResult != null) {
            MethodChannel.Result result = permissionResult;
            permissionResult = null;
            result.success(ReminderScheduler.status(this));
        }
    }

    @Override protected void onActivityResult(int request, int code, Intent data) {
        super.onActivityResult(request, code, data);
        if ((request != IMPORT && request != EXPORT) || documentResult == null) return;
        MethodChannel.Result result = documentResult;
        documentResult = null;
        if (code != RESULT_OK || data == null) { result.success(request == EXPORT ? false : new ArrayList<>()); return; }
        if (request == EXPORT) {
            Uri uri = data.getData();
            io(result, () -> {
                JSONObject backup = new JSONObject();
                backup.put("format", "monokeep");
                backup.put("version", 1);
                backup.put("notes", new JSONArray(NoteDatabase.get(this).list()));
                try (OutputStream output = getContentResolver().openOutputStream(uri, "wt")) {
                    if (output == null) throw new IllegalStateException("Cannot open export file");
                    output.write(backup.toString(2).getBytes(StandardCharsets.UTF_8));
                }
                return true;
            });
        } else {
            List<Uri> uris = new ArrayList<>();
            if (data.getClipData() != null) {
                for (int i = 0; i < data.getClipData().getItemCount(); i++) uris.add(data.getClipData().getItemAt(i).getUri());
            } else if (data.getData() != null) uris.add(data.getData());
            io(result, () -> {
                List<Map<String, Object>> files = new ArrayList<>();
                long totalBytes = 0;
                for (Uri uri : uris) {
                    Map<String, Object> file = new HashMap<>();
                    file.put("name", "JSON");
                    try {
                        try (Cursor cursor = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
                            if (cursor != null && cursor.moveToFirst()) file.put("name", cursor.getString(0));
                        }
                        try (InputStream input = getContentResolver().openInputStream(uri); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                            if (input == null) throw new IllegalStateException("Cannot read file");
                            byte[] buffer = new byte[8192];
                            int count;
                            while ((count = input.read(buffer)) != -1) {
                                totalBytes += count;
                                if (totalBytes > 32L * 1024 * 1024) throw new IllegalArgumentException("Import exceeds 32 MB. Select fewer files.");
                                output.write(buffer, 0, count);
                            }
                            file.put("text", output.toString("UTF-8"));
                        }
                    } catch (Exception error) { file.put("error", error.getMessage()); }
                    files.add(file);
                }
                return files;
            });
        }
    }

    @Override public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        Map<String, Object> action = readIntent(intent);
        if (action == null) return;
        if (dartReady && channel != null) channel.invokeMethod("openIntent", action);
        else pendingIntent = action;
    }

    private Map<String, Object> readIntent(Intent intent) {
        if (intent == null) return null;
        Map<String, Object> action = new HashMap<>();
        if (intent.hasExtra("noteId")) {
            action.put("noteId", intent.getStringExtra("noteId"));
            intent.removeExtra("noteId");
        } else if (Intent.ACTION_SEND.equals(intent.getAction()) && "text/plain".equals(intent.getType())) {
            action.put("title", intent.getStringExtra(Intent.EXTRA_SUBJECT));
            CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
            action.put("content", text == null ? null : text.toString());
            intent.setAction(Intent.ACTION_MAIN);
        } else return null;
        return action;
    }

    @Override protected void onDestroy() {
        if (receiverRegistered) unregisterReceiver(changes);
        if (channel != null) channel.setMethodCallHandler(null);
        super.onDestroy();
    }
}
