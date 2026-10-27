package com.monokeep.app;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class SyncTimestampTest {
    @Test public void postgresAndExportTimestampsRepresentTheSameInstant() {
        long expected = Instant.parse("2026-10-27T17:02:24.495Z").toEpochMilli();
        for (String value : new String[]{
                "2026-10-27T17:02:24.495Z",
                "2026-10-27T17:02:24.495809+00:00",
                "2026-10-28T01:02:24.495809+08:00",
                "2026-10-27T11:32:24.495809-05:30"}) {
            assertEquals(value, expected, SyncTimestamp.millis(value));
        }
        assertEquals(0L, SyncTimestamp.millis("1970-01-01T00:00:00+00:00"));
    }

    @Test public void ambiguousOrInvalidDatesAreRejectedInsteadOfChangingEditOrder() {
        for (String value : new String[]{"2026-10-27T17:02:24", "2026-02-30T17:02:24Z", "invalid"}) {
            assertThrows(DateTimeParseException.class, () -> SyncTimestamp.millis(value));
        }
    }
}
