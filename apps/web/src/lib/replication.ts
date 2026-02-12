import { replicateRxCollection } from 'rxdb/plugins/replication';
import { MyDatabaseCollections, NoteDocType, TagDocType } from './db';
import { supabase } from './supabase';
import { RxDocumentData } from 'rxdb';
import { RealtimeChannel } from '@supabase/supabase-js';

// --- HELPER: Field Mapping ---

const toSnakeCase = (str: string) => str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
const toCamelCase = (str: string) => str.replace(/_([a-z])/g, (g) => g[1].toUpperCase());

const mapToSupabase = (doc: Record<string, unknown>, userId?: string) => {
    const newDoc: Record<string, unknown> = {};
    Object.keys(doc).forEach(key => {
        // 1. Пропускаем служебные поля RxDB (_rev, _deleted, _attachments)
        if (key.startsWith('_')) return;

        // 2. Маппим ключ
        newDoc[toSnakeCase(key)] = doc[key];
    });

    // 3. ПРИНУДИТЕЛЬНО ставим user_id, если он передан
    // Это гарантирует, что мы не запишем null и не нарушим RLS
    if (userId) {
        newDoc.user_id = userId;
    }

    // Очищаем потенциально лишнее поле userId (camelCase), так как мы задали user_id
    delete newDoc.userId;

    return newDoc;
};

const mapFromSupabase = (row: Record<string, unknown>) => {
    const newDoc: Record<string, unknown> = {};
    Object.keys(row).forEach(key => {
        newDoc[toCamelCase(key)] = row[key];
    });
    return newDoc;
};

// --- REPLICATION ---

let realtimeChannel: RealtimeChannel | null = null;

export const replicateCollections = async (collections: MyDatabaseCollections) => {
    const session = await supabase.auth.getSession();
    const user = session.data.session?.user;
    const userId = user?.id;

    if (!userId) {
        console.warn("Replication skipped: User not logged in");
        return;
    }

    // --- NOTES REPLICATION ---
    const notesReplicationState = await replicateRxCollection({
        collection: collections.notes,
        replicationIdentifier: 'notes-supabase-v1',
        pull: {
            handler: async (checkpoint: unknown, batchSize: number) => {
                const updatedMin = (typeof checkpoint === 'string' ? checkpoint : new Date(0).toISOString());

                const { data, error } = await supabase
                    .from('notes')
                    .select('*')
                    .gt('updated_at', updatedMin)
                    .order('updated_at', { ascending: true })
                    .limit(batchSize);

                if (error) throw error;

                const safeData = data || [];
                const documents = safeData.map(row => mapFromSupabase(row as Record<string, unknown>) as unknown as RxDocumentData<NoteDocType>);
                // New checkpoint is the last document's updatedAt
                const lastDoc = safeData[safeData.length - 1];
                const newCheckpoint = lastDoc ? lastDoc.updated_at : updatedMin;

                return {
                    documents,
                    checkpoint: newCheckpoint
                };
            }
        },
        push: {
            handler: async (changes) => {
                const rows = changes.map(change => {
                    const doc = { ...change.newDocumentState };
                    // Ensure deleted flag is synced
                    if (change.newDocumentState.syncDeleted) {
                        doc.syncDeleted = true;
                    }
                    return mapToSupabase(doc, userId);
                });

                const { error } = await supabase
                    .from('notes')
                    .upsert(rows);

                if (error) throw error;

                return []; // No conflicts handling for now
            },
            batchSize: 10
        },
        live: true,
        retryTime: 6000, // Increase polling interval to 60s as fallback
        autoStart: true,
        waitForLeadership: false, // Ensure replication starts immediately even in multiple tabs
    });

    // --- TAGS REPLICATION ---
    const tagsReplicationState = await replicateRxCollection({
        collection: collections.tags,
        replicationIdentifier: 'tags-supabase-v1',
        pull: {
            handler: async (checkpoint: unknown, batchSize: number) => {
                const updatedMin = (typeof checkpoint === 'string' ? checkpoint : new Date(0).toISOString());

                const { data, error } = await supabase
                    .from('tags')
                    .select('*')
                    .gt('updated_at', updatedMin)
                    .order('updated_at', { ascending: true })
                    .limit(batchSize);

                if (error) throw error;

                const safeData = data || [];

                const documents = safeData.map(row => mapFromSupabase(row as Record<string, unknown>) as unknown as RxDocumentData<TagDocType>);

                return {
                    documents,
                    checkpoint: safeData.length > 0 ? safeData[safeData.length - 1].updated_at : updatedMin
                };
            }
        },
        push: {
            handler: async (changes) => {
                const rows = changes.map(change => mapToSupabase(change.newDocumentState as Record<string, unknown>, userId));

                const { error } = await supabase
                    .from('tags')
                    .upsert(rows);

                if (error) throw error;
                return [];
            },
            batchSize: 10
        },
        live: true,
        retryTime: 6000, // Increase polling interval to 60s as fallback
        autoStart: true,
        waitForLeadership: false,
    });

    // --- REALTIME SUBSCRIPTION ---
    if (!realtimeChannel) {
        realtimeChannel = supabase.channel('db-changes')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'notes' },
                () => {
                    notesReplicationState.reSync();
                }
            )
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'tags' },
                () => {
                    tagsReplicationState.reSync();
                }
            )
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    // console.log('Realtime connected');
                }
            });
    }
};