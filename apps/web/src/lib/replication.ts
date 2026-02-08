import { replicateRxCollection } from 'rxdb/plugins/replication';
import { MyDatabaseCollections } from './db';
import api from './api';

export const replicateCollections = async (collections: MyDatabaseCollections) => {

    // --- NOTES REPLICATION ---
    await replicateRxCollection({
        collection: collections.notes,
        replicationIdentifier: 'notes-replication-v1',
        pull: {
            handler: async (checkpoint: any, batchSize: number) => {
                const updatedMin = checkpoint;
                const limit = batchSize;
                try {
                    const response = await api.get('/sync/pull', {
                        params: {
                            collection: 'notes',
                            checkpoint: updatedMin,
                            limit
                        }
                    });
                    const data = response.data;
                    return {
                        documents: data.documents,
                        checkpoint: data.checkpoint
                    };
                } catch (err) {
                    console.error('Pull Error Note:', err);
                    throw err; // Retry logic relies on throwing
                }
            }
        },
        push: {
            handler: async (changes) => {
                // ИСПРАВЛЕНИЕ ЗДЕСЬ
                const payload = changes.map((change: any) => {
                    // 1. Берем данные документа
                    const doc = { ...change.newDocumentState };

                    // 2. УДАЛЯЕМ СЛУЖЕБНЫЕ ПОЛЯ RXDB
                    // Если их не удалить, Prisma упадет с ошибкой "Unknown argument"
                    delete doc._rev;
                    delete doc._attachments;
                    delete doc._deleted; // <--- Критично важно!

                    return doc;
                });

                try {
                    const response = await api.post('/sync/push', payload, {
                        params: { collection: 'notes' }
                    });
                    return response.data || []; // Conflicts (empty if OK)
                } catch (err) {
                    console.error('Push Error Note:', err);
                    throw err;
                }
            },
            batchSize: 5 // Push in small batches
        },
        live: true,
        retryTime: 5000,
        autoStart: true,
    });

    // --- TAGS REPLICATION ---
    await replicateRxCollection({
        collection: collections.tags,
        replicationIdentifier: 'tags-replication-v1',
        pull: {
            handler: async (checkpoint: any, batchSize: number) => {
                const updatedMin = checkpoint;
                const limit = batchSize;
                try {
                    const response = await api.get('/sync/pull', {
                        params: { collection: 'tags', checkpoint: updatedMin, limit }
                    });
                    const data = response.data;
                    return {
                        documents: data.documents,
                        checkpoint: data.checkpoint
                    };
                } catch (err) { console.error('Pull Error Tag', err); throw err; }
            }
        },
        push: {
            handler: async (changes) => {
                // ИСПРАВЛЕНИЕ ЗДЕСЬ (Аналогично заметкам)
                const payload = changes.map((change: any) => {
                    const doc = { ...change.newDocumentState };

                    // Удаляем мусор RxDB
                    delete doc._rev;
                    delete doc._attachments;
                    delete doc._deleted;

                    return doc;
                });

                try {
                    const response = await api.post('/sync/push', payload, {
                        params: { collection: 'tags' }
                    });
                    return response.data;
                } catch (err) { console.error('Push Tag', err); throw err; }
            },
            batchSize: 5
        },
        live: true,
        retryTime: 5000,
        autoStart: true
    });
};