package com.monokeep.app;
import android.content.Context;
import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
public final class SyncWorker extends Worker {
    public SyncWorker(@NonNull Context context,@NonNull WorkerParameters parameters) { super(context,parameters); }
    @NonNull @Override public Result doWork() {
        try { SyncEngine.synchronize(getApplicationContext()); return Result.success(); }
        catch (Exception error) { return Result.retry(); }
    }
}
