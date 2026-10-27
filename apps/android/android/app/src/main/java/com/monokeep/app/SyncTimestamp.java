package com.monokeep.app;

import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;

/** Postgres JSON uses numeric UTC offsets, while Android exports use Z. */
final class SyncTimestamp {
    private SyncTimestamp() {}

    static long millis(String value) {
        // The desugared Instant.parse implementation only accepts a literal Z.
        // Preserve the actual offset and fractional seconds instead of stripping them.
        return OffsetDateTime.parse(value, DateTimeFormatter.ISO_OFFSET_DATE_TIME)
            .toInstant().toEpochMilli();
    }
}
