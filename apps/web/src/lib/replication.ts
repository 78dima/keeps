import { replicateRxCollection, RxReplicationState } from 'rxdb/plugins/replication';
import type { RxDocumentData, RxReplicationWriteToMasterRow } from 'rxdb';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { MyDatabaseCollections, NoteDocType, TagDocType } from './db';
import { supabase } from './supabase';
import { calibrateClock, compareEdits, sameLegacyNote, ZERO_EDIT } from './sync-protocol';

type Checkpoint = { revision: string };
type Synced = NoteDocType | TagDocType;
type Row = Record<string, unknown>;
let notesReplication: RxReplicationState<NoteDocType, Checkpoint> | null = null;
let tagsReplication: RxReplicationState<TagDocType, Checkpoint> | null = null;
let realtimeChannel: RealtimeChannel | null = null;
let cleanup: (() => void) | null = null;
let generation = 0;

// Explicit allowlists keep server-only fields out of RxDB.
const common = ['id', 'userId', 'updatedAt', 'editId', 'syncDeleted'];
const noteFields = [...common, 'title', 'content', 'color', 'isPinned', 'isArchived', 'isDeleted',
    'reminderDate', 'isReminderSent', 'reminderEnabled', 'reminderVersion', 'sortAt', 'wasSentOnce', 'tags', 'createdAt'];
const snake = (key: string) => key.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
function fromServer<T extends Synced>(entity: string, row: Row): RxDocumentData<T> {
    const doc: Row = {};
    for (const key of entity === 'notes' ? noteFields : [...common, 'name']) {
        doc[key] = row[snake(key)];
    }
    doc.updatedAt = new Date(String(doc.updatedAt)).toISOString();
    for (const key of ['createdAt', 'reminderDate', 'sortAt']) {
        if (doc[key]) doc[key] = new Date(String(doc[key])).toISOString();
    }
    doc.editId = doc.editId || ZERO_EDIT;
    if (entity === 'notes') {
        doc.sortAt = doc.sortAt || doc.updatedAt;
        doc.reminderEnabled = doc.reminderEnabled ?? true;
        doc.reminderVersion = doc.reminderVersion || ZERO_EDIT;
        doc.wasSentOnce = doc.wasSentOnce ?? false;
    }
    // Keep tombstones as normal RxDB documents, so a later offline edit can win by time.
    doc._deleted = false;
    return doc as unknown as RxDocumentData<T>;
}
function toServer(entity: string, doc: Synced, userId: string): Row {
    if (doc.userId !== userId) throw new Error('Account changed during synchronization');
    const row: Row = {};
    for (const key of entity === 'notes' ? noteFields : [...common, 'name']) {
        const value = (doc as unknown as Row)[key];
        if (value !== undefined) row[snake(key)] = value;
    }
    row.edit_id = row.edit_id || ZERO_EDIT;
    return row;
}
export async function cancelReplication() {
    generation++;
    cleanup?.(); cleanup = null;
    const oldNotes = notesReplication, oldTags = tagsReplication, oldChannel = realtimeChannel;
    notesReplication = null; tagsReplication = null; realtimeChannel = null;
    await Promise.all([oldNotes?.cancel(), oldTags?.cancel(), oldChannel ? supabase.removeChannel(oldChannel) : null]);
}
export function createSyncHandlers<T extends Synced>(entity: string, userId: string, activeGeneration: number, client: Pick<typeof supabase, 'rpc'> = supabase) {
    const assertActive = () => { if (generation !== activeGeneration) throw new Error('Sync account changed'); };
    return {
        pull: {
            batchSize: 100,
            handler: async (checkpoint: Checkpoint | undefined, batchSize: number) => {
                assertActive();
                const started = Date.now();
                const { data, error } = await client.rpc('sync_pull', {
                    entity, after_revision: checkpoint?.revision || '0', page_size: batchSize,
                });
                if (error) throw error;
                assertActive();
                if ((data.rows as Row[]).some(row => row.user_id !== userId)) throw new Error('Wrong sync owner');
                calibrateClock(data.server_time, started);
                const rows: Row[] = data.rows;
                return {
                    documents: rows.map(row => fromServer<T>(entity, row)),
                    checkpoint: { revision: String(rows.at(-1)?.sync_revision || checkpoint?.revision || '0') },
                };
            },
        },
        push: {
            batchSize: 25,
            handler: async (changes: RxReplicationWriteToMasterRow<T>[]) => {
                // Shared legacy RxDB contains multiple owners: never relabel their notes.
                const own = changes.filter(change => change.newDocumentState.userId === userId);
                if (!own.length) return [];
                assertActive();
                const started = Date.now();
                const { data, error } = await client.rpc('sync_push', {
                    entity, documents: own.map(change => toServer(entity, change.newDocumentState, userId)),
                });
                if (error) throw error;
                assertActive();
                if ((data.rows as Row[]).some(row => row.user_id !== userId)) throw new Error('Wrong sync owner');
                calibrateClock(data.server_time, started);
                return (data.rows as Row[]).flatMap((row, i) => {
                    const remote = fromServer<T>(entity, row), local = own[i].newDocumentState;
                    return compareEdits(remote, local) > 0 ||
                        (entity === 'notes' && (local.editId || ZERO_EDIT) === ZERO_EDIT && (compareEdits(remote, local) !== 0 || !sameLegacyNote(remote, local))) ||
                        ('isReminderSent' in remote && (remote.isReminderSent !== (local as NoteDocType).isReminderSent || remote.sortAt !== (local as NoteDocType).sortAt || remote.wasSentOnce !== (local as NoteDocType).wasSentOnce))
                        ? [remote] : [];
                });
            },
        },
    };
}
export async function replicateCollections(collections: MyDatabaseCollections, userId: string) {
    const cancelled = cancelReplication();
    const current = generation;
    await cancelled;
    if (!userId || generation !== current) return;
    // A fresh identifier performs a full pull after upgrading the old timestamp protocol.
    notesReplication = replicateRxCollection<NoteDocType, Checkpoint>({
        collection: collections.notes, replicationIdentifier: `notes-sync-v2-${userId}`,
        ...createSyncHandlers<NoteDocType>('notes', userId, current), live: true, retryTime: 15000, waitForLeadership: false,
    });
    tagsReplication = replicateRxCollection<TagDocType, Checkpoint>({
        collection: collections.tags, replicationIdentifier: `tags-sync-v2-${userId}`,
        ...createSyncHandlers<TagDocType>('tags', userId, current), live: true, retryTime: 15000, waitForLeadership: false,
    });
    const resync = () => {
        if (generation !== current) return;
        notesReplication?.reSync(); tagsReplication?.reSync();
    };
    const visible = () => { if (document.visibilityState === 'visible') resync(); };
    // Realtime is a hint. Catch-up on subscribe/reconnect/focus and periodic polling cover missed events.
    realtimeChannel = supabase.channel(`sync-v2-${userId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'notes', filter: `user_id=eq.${userId}` }, resync)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tags', filter: `user_id=eq.${userId}` }, resync)
        .subscribe(status => { if (status === 'SUBSCRIBED') resync(); });
    const timer = setInterval(visible, 60000);
    window.addEventListener('online', resync);
    document.addEventListener('visibilitychange', visible);
    const subscriptions = [notesReplication.error$, tagsReplication.error$].map(errors => errors.subscribe(error => {
        console.error('[Sync]', error.message);
    }));
    cleanup = () => {
        clearInterval(timer);
        window.removeEventListener('online', resync);
        document.removeEventListener('visibilitychange', visible);
        subscriptions.forEach(sub => sub.unsubscribe());
    };
}
