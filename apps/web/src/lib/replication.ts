import { replicateRxCollection, RxReplicationState } from 'rxdb/plugins/replication';
import { MyDatabaseCollections, NoteDocType, TagDocType } from './db';
import { supabase } from './supabase';
import { RxDocumentData } from 'rxdb';
import { RealtimeChannel } from '@supabase/supabase-js';

// --- CONFIGURATION ---

const IS_DEV = process.env.NODE_ENV !== 'production';
const RETRY_TIME_MS = 30_000; // 30s fallback polling (Realtime handles instant sync)
const BATCH_SIZE = 50;

const log = (...args: unknown[]) => {
    if (IS_DEV) console.log('[Replication]', ...args);
};

// --- HELPER: Field Mapping ---

const toSnakeCase = (str: string) =>
    str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);

const toCamelCase = (str: string) =>
    str.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

const mapToSupabase = (doc: Record<string, unknown>, userId: string): Record<string, unknown> => {
    const mapped: Record<string, unknown> = {};

    for (const key of Object.keys(doc)) {
        if (key.startsWith('_')) continue; // Skip RxDB internals (_rev, _deleted, etc.)
        mapped[toSnakeCase(key)] = doc[key];
    }

    // Force user_id for RLS compliance
    mapped.user_id = userId;
    delete mapped.userId; // Remove camelCase duplicate

    return mapped;
};

const mapFromSupabase = (row: Record<string, unknown>): Record<string, unknown> => {
    const mapped: Record<string, unknown> = {};

    for (const key of Object.keys(row)) {
        mapped[toCamelCase(key)] = row[key];
    }

    // CRITICAL: RxDB requires _deleted for replication to merge documents
    mapped._deleted = !!row.sync_deleted;

    return mapped;
};

// --- CHECKPOINT TYPE ---

interface ReplicationCheckpoint {
    updatedAt: string;
    id: string;
}

// --- STATE ---

let notesReplication: RxReplicationState<NoteDocType, ReplicationCheckpoint> | null = null;
let tagsReplication: RxReplicationState<TagDocType, ReplicationCheckpoint> | null = null;
let realtimeChannel: RealtimeChannel | null = null;
let isPushInProgress = false;

// --- CLEANUP ---

export const cancelReplication = async () => {
    log('Cancelling all replications...');

    if (notesReplication) {
        await notesReplication.cancel();
        notesReplication = null;
    }

    if (tagsReplication) {
        await tagsReplication.cancel();
        tagsReplication = null;
    }

    if (realtimeChannel) {
        supabase.removeChannel(realtimeChannel);
        realtimeChannel = null;
    }

    isPushInProgress = false;
    log('All replications cancelled.');
};

// --- PULL HANDLER FACTORY ---

function createPullHandler<T>(
    tableName: string,
    userId: string
) {
    return async (checkpoint: ReplicationCheckpoint | undefined, batchSize: number) => {
        const updatedMin = checkpoint?.updatedAt ?? new Date(0).toISOString();
        const lastId = checkpoint?.id ?? '';

        log(`${tableName} pull | checkpoint: ${updatedMin} | lastId: ${lastId}`);

        // Composite cursor query: get rows >= checkpoint timestamp,
        // then filter out the exact checkpoint row (we already have it)
        const { data, error } = await supabase
            .from(tableName)
            .select('*')
            .eq('user_id', userId)
            .gte('updated_at', updatedMin)
            .order('updated_at', { ascending: true })
            .order('id', { ascending: true })
            .limit(batchSize + 1);

        if (error) throw error;

        let rows = data ?? [];

        // Skip the exact checkpoint document (composite: same timestamp + same id)
        if (lastId && rows.length > 0) {
            const firstRow = rows[0];
            if (firstRow.updated_at === updatedMin && firstRow.id === lastId) {
                rows = rows.slice(1);
            }
        }

        // Trim back to batchSize
        if (rows.length > batchSize) {
            rows = rows.slice(0, batchSize);
        }

        const documents = rows.map(
            row => mapFromSupabase(row as Record<string, unknown>) as unknown as RxDocumentData<T>
        );

        // Composite checkpoint from last fetched row
        const lastRow = rows[rows.length - 1];
        const newCheckpoint: ReplicationCheckpoint = lastRow
            ? { updatedAt: lastRow.updated_at, id: lastRow.id }
            : { updatedAt: updatedMin, id: lastId };

        log(`${tableName} pulled: ${documents.length} docs`);

        return { documents, checkpoint: newCheckpoint };
    };
}

// --- PUSH HANDLER FACTORY ---

function createPushHandler(
    tableName: string,
    userId: string
) {
    return async (changes: { newDocumentState: Record<string, unknown> }[]) => {
        isPushInProgress = true;

        try {
            const rows = changes.map(change => mapToSupabase(change.newDocumentState, userId));

            const { error } = await supabase
                .from(tableName)
                .upsert(rows);

            if (error) throw error;
            return [];
        } finally {
            // Small delay to let Realtime event pass before resetting flag
            setTimeout(() => { isPushInProgress = false; }, 2000);
        }
    };
}

// --- MAIN ---

export const replicateCollections = async (collections: MyDatabaseCollections, userId: string) => {
    // Cancel any previous replication before starting new one
    await cancelReplication();

    if (!userId) {
        log('Skipped: no userId');
        return;
    }

    log('Starting replication for user:', userId);

    // --- NOTES ---
    notesReplication = replicateRxCollection<NoteDocType, ReplicationCheckpoint>({
        collection: collections.notes,
        replicationIdentifier: `notes-supabase-${userId}`,
        pull: {
            handler: createPullHandler<NoteDocType>('notes', userId),
            batchSize: BATCH_SIZE,
        },
        push: {
            handler: createPushHandler('notes', userId) as any, // eslint-disable-line @typescript-eslint/no-explicit-any
            batchSize: 10,
        },
        live: true,
        retryTime: RETRY_TIME_MS,
        autoStart: true,
        waitForLeadership: false,
    });

    // Error logging
    notesReplication.error$.subscribe(err => {
        console.error('[Replication] Notes error:', err.message || err);
    });

    // --- TAGS ---
    tagsReplication = replicateRxCollection<TagDocType, ReplicationCheckpoint>({
        collection: collections.tags,
        replicationIdentifier: `tags-supabase-${userId}`,
        pull: {
            handler: createPullHandler<TagDocType>('tags', userId),
            batchSize: BATCH_SIZE,
        },
        push: {
            handler: createPushHandler('tags', userId) as any, // eslint-disable-line @typescript-eslint/no-explicit-any
            batchSize: 10,
        },
        live: true,
        retryTime: RETRY_TIME_MS,
        autoStart: true,
        waitForLeadership: false,
    });

    tagsReplication.error$.subscribe(err => {
        console.error('[Replication] Tags error:', err.message || err);
    });

    // --- REALTIME SUBSCRIPTION ---
    realtimeChannel = supabase.channel(`db-changes-${userId}`)
        .on(
            'postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'notes',
                filter: `user_id=eq.${userId}`,
            },
            (payload) => {
                // Skip echo from our own push
                if (isPushInProgress) {
                    log('Notes Realtime event skipped (push in progress)');
                    return;
                }
                log('Notes change:', payload.eventType);
                notesReplication?.reSync();
            }
        )
        .on(
            'postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'tags',
                filter: `user_id=eq.${userId}`,
            },
            (payload) => {
                if (isPushInProgress) {
                    log('Tags Realtime event skipped (push in progress)');
                    return;
                }
                log('Tags change:', payload.eventType);
                tagsReplication?.reSync();
            }
        )
        .subscribe((status) => {
            log('Realtime status:', status);
        });
};