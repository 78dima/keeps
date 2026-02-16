import { replicateRxCollection, RxReplicationState } from 'rxdb/plugins/replication';
import { MyDatabaseCollections, NoteDocType, TagDocType } from './db';
import { supabase } from './supabase';
import { RxDocumentData } from 'rxdb';
import { RealtimeChannel } from '@supabase/supabase-js';

// --- CONFIGURATION ---

const IS_DEV = process.env.NODE_ENV !== 'production';
const RETRY_TIME_MS = 5 * 60_000; // 5 min fallback polling (Realtime handles instant sync)
const BATCH_SIZE = 50;
const PUSH_ECHO_TTL_MS = 5_000; // How long to ignore Realtime echoes after a push

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

/**
 * Track recently pushed document IDs to ignore their Realtime echoes.
 * Each entry is auto-removed after PUSH_ECHO_TTL_MS.
 */
const recentlyPushedIds = new Set<string>();

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

    recentlyPushedIds.clear();
    log('All replications cancelled.');
};

// --- PULL HANDLER FACTORY ---

function createPullHandler<T>(
    tableName: string,
    userId: string
) {
    return async (checkpoint: ReplicationCheckpoint | undefined, batchSize: number) => {
        const updatedMin = checkpoint?.updatedAt ?? '';
        const lastId = checkpoint?.id ?? '';

        log(`${tableName} pull | checkpoint: ${updatedMin || '(initial)'} | lastId: ${lastId || '(none)'}`);

        // Build query with proper keyset pagination (composite cursor).
        // Instead of `.gte()` + skip-first-row (which breaks when multiple docs
        // share the same timestamp), we use a proper composite condition:
        //   (updated_at > checkpoint) OR (updated_at = checkpoint AND id > lastId)
        // This guarantees we never re-fetch already-seen documents.
        let query = supabase
            .from(tableName)
            .select('*')
            .eq('user_id', userId);

        if (updatedMin && lastId) {
            // Composite keyset cursor: skip everything at or before the checkpoint
            query = query.or(
                `updated_at.gt.${updatedMin},and(updated_at.eq.${updatedMin},id.gt.${lastId})`
            );
        } else if (updatedMin) {
            // Only timestamp (no ID) — fallback to gte
            query = query.gte('updated_at', updatedMin);
        }
        // If no checkpoint at all → fetch everything from the beginning

        const { data, error } = await query
            .order('updated_at', { ascending: true })
            .order('id', { ascending: true })
            .limit(batchSize);

        if (error) throw error;

        const rows = data ?? [];

        const documents = rows.map(
            row => mapFromSupabase(row as Record<string, unknown>) as unknown as RxDocumentData<T>
        );

        // Composite checkpoint from last fetched row
        const lastRow = rows[rows.length - 1];
        const newCheckpoint: ReplicationCheckpoint = lastRow
            ? { updatedAt: lastRow.updated_at, id: lastRow.id }
            : checkpoint ?? { updatedAt: '', id: '' };

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
        try {
            const rows = changes.map(change => mapToSupabase(change.newDocumentState, userId));

            // Track pushed document IDs to ignore their Realtime echoes
            for (const row of rows) {
                const id = row.id as string;
                if (id) {
                    recentlyPushedIds.add(id);
                    setTimeout(() => recentlyPushedIds.delete(id), PUSH_ECHO_TTL_MS);
                }
            }

            const { error } = await supabase
                .from(tableName)
                .upsert(rows);

            if (error) throw error;
            return [];
        } catch (err) {
            // On error, clear tracked IDs so Realtime can recover
            for (const change of changes) {
                const id = change.newDocumentState.id as string;
                if (id) recentlyPushedIds.delete(id);
            }
            throw err;
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
                // Skip echo from our own push (check by document ID)
                const recordId = (payload.new as Record<string, unknown>)?.id as string
                    || (payload.old as Record<string, unknown>)?.id as string;

                if (recordId && recentlyPushedIds.has(recordId)) {
                    log('Notes Realtime echo skipped for id:', recordId);
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
                const recordId = (payload.new as Record<string, unknown>)?.id as string
                    || (payload.old as Record<string, unknown>)?.id as string;

                if (recordId && recentlyPushedIds.has(recordId)) {
                    log('Tags Realtime echo skipped for id:', recordId);
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