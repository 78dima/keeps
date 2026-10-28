package com.monokeep.app;

import android.app.Activity;
import android.content.*;
import android.hardware.display.DisplayManager;
import android.os.*;
import android.view.*;

/** A foreground-only refresh-rate vote. Android retains the final decision. */
final class DisplayRefreshController implements DisplayManager.DisplayListener, SurfaceHolder.Callback {
    private final Activity activity;
    private final DisplayManager displays;
    private final PowerManager power;
    private boolean active;
    private SurfaceView view;
    private Surface appliedSurface;
    private float appliedRate = -1;
    private final BroadcastReceiver powerChanged = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) { apply(); }
    };
    DisplayRefreshController(Activity activity) {
        this.activity = activity;
        displays = (DisplayManager) activity.getSystemService(Context.DISPLAY_SERVICE);
        power = (PowerManager) activity.getSystemService(Context.POWER_SERVICE);
    }
    void start() {
        if (active) return;
        active = true;
        displays.registerDisplayListener(this, new Handler(Looper.getMainLooper()));
        IntentFilter filter = new IntentFilter(PowerManager.ACTION_POWER_SAVE_MODE_CHANGED);
        if (Build.VERSION.SDK_INT >= 33) activity.registerReceiver(powerChanged, filter, Context.RECEIVER_NOT_EXPORTED);
        else activity.registerReceiver(powerChanged, filter);
        activity.getWindow().getDecorView().post(() -> {
            if (!active) return;
            view = findSurface(activity.getWindow().getDecorView());
            if (view != null) view.getHolder().addCallback(this);
            apply();
        });
    }
    void stop() {
        if (!active) return;
        active = false;
        displays.unregisterDisplayListener(this);
        activity.unregisterReceiver(powerChanged);
        apply();
        if (view != null) view.getHolder().removeCallback(this);
        view = null; appliedSurface = null; appliedRate = -1;
    }
    @SuppressWarnings("deprecation")
    private void apply() {
        Display display = activity.getWindowManager().getDefaultDisplay();
        Display.Mode current = display.getMode(), fastest = current;
        for (Display.Mode mode : display.getSupportedModes()) {
            if (mode.getPhysicalWidth() == current.getPhysicalWidth() &&
                mode.getPhysicalHeight() == current.getPhysicalHeight() &&
                mode.getRefreshRate() > fastest.getRefreshRate()) fastest = mode;
        }
        float rate = active && !power.isPowerSaveMode() ? fastest.getRefreshRate() : 0f;
        WindowManager.LayoutParams attrs = activity.getWindow().getAttributes();
        // Before Android 11 there is no Surface frame-rate vote. Keep the resolution.
        int modeId = Build.VERSION.SDK_INT < 30 && rate > 0 ? fastest.getModeId() : 0;
        if (attrs.preferredRefreshRate != rate || attrs.preferredDisplayModeId != modeId) {
            attrs.preferredRefreshRate = rate; attrs.preferredDisplayModeId = modeId;
            activity.getWindow().setAttributes(attrs);
        }
        if (Build.VERSION.SDK_INT >= 30 && view != null) {
            Surface surface = view.getHolder().getSurface();
            if (surface.isValid() && (surface != appliedSurface || appliedRate != rate)) {
                try {
                    if (Build.VERSION.SDK_INT >= 31) surface.setFrameRate(rate,
                        Surface.FRAME_RATE_COMPATIBILITY_DEFAULT, Surface.CHANGE_FRAME_RATE_ONLY_IF_SEAMLESS);
                    else surface.setFrameRate(rate, Surface.FRAME_RATE_COMPATIBILITY_DEFAULT);
                    appliedSurface = surface; appliedRate = rate;
                } catch (IllegalArgumentException | IllegalStateException ignored) {
                    // The surface can disappear while Android recreates the window.
                    appliedSurface = null; appliedRate = -1;
                }
            }
        }
    }
    private static SurfaceView findSurface(View root) {
        if (root instanceof SurfaceView) return (SurfaceView) root;
        if (root instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) root;
            for (int i = 0; i < group.getChildCount(); i++) {
                SurfaceView found = findSurface(group.getChildAt(i));
                if (found != null) return found;
            }
        }
        return null;
    }
    @Override public void onDisplayAdded(int id) { if (active) apply(); }
    @Override public void onDisplayRemoved(int id) { if (active) apply(); }
    @Override public void onDisplayChanged(int id) { if (active) apply(); }
    @Override public void surfaceCreated(SurfaceHolder holder) { appliedSurface = null; if (active) apply(); }
    @Override public void surfaceChanged(SurfaceHolder holder, int format, int width, int height) { if (active) apply(); }
    @Override public void surfaceDestroyed(SurfaceHolder holder) { appliedSurface = null; appliedRate = -1; }
}
