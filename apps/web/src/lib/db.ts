import {
    createRxDatabase,
    RxDatabase,
    RxCollection,
    RxStorage,
    addRxPlugin
} from 'rxdb';
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie';
import { RxDBUpdatePlugin } from 'rxdb/plugins/update';
import { RxDBQueryBuilderPlugin } from 'rxdb/plugins/query-builder';
import { wrappedValidateAjvStorage } from 'rxdb/plugins/validate-ajv';
import { RxDBDevModePlugin } from 'rxdb/plugins/dev-mode';

// 1. Добавляем основные плагины (нужны всегда)
addRxPlugin(RxDBUpdatePlugin);
addRxPlugin(RxDBQueryBuilderPlugin);

// 2. DevMode включаем ТОЛЬКО если не продакшн.
const isDev = process.env.NODE_ENV !== 'production';

if (isDev) {
    addRxPlugin(RxDBDevModePlugin);
}

const isClient = typeof window !== 'undefined';

// --- СХЕМЫ ---

const noteSchema = {
    version: 0,
    primaryKey: 'id',
    type: 'object',
    properties: {
        id: {
            type: 'string',
            maxLength: 100
        },
        title: { type: 'string' },
        content: { type: 'string' },
        color: { type: ['string', 'null'] },
        isPinned: { type: 'boolean' },
        isArchived: { type: 'boolean' },

        // UI Trash flag
        isDeleted: { type: 'boolean' },

        // Sync delete flag (renamed from deleted to syncDeleted)
        syncDeleted: { type: 'boolean' },

        // Allow null for date
        deletedAt: { type: ['string', 'null'] },

        reminderDate: { type: ['string', 'null'] },
        isReminderSent: { type: 'boolean' },

        updatedAt: { type: 'string' },
        createdAt: { type: 'string' },

        // Changed to string to match Supabase UUID
        userId: { type: 'string' },

        tags: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    name: { type: 'string' }
                }
            }
        }
    },
    required: ['id', 'title', 'content', 'updatedAt']
};

const tagSchema = {
    version: 0,
    primaryKey: 'id',
    type: 'object',
    properties: {
        id: { type: 'string', maxLength: 100 },
        name: { type: 'string' },
        userId: { type: 'string' }, // Changed to string
        updatedAt: { type: 'string' },
        syncDeleted: { type: 'boolean' }
    },
    required: ['id', 'name', 'userId', 'updatedAt']
};

// --- TYPES ---

export type NoteDocType = {
    id: string;
    title: string;
    content: string;
    color?: string | null;
    isPinned: boolean;
    isArchived: boolean;
    isDeleted: boolean;
    syncDeleted: boolean;
    deletedAt?: string | null;
    reminderDate?: string | null;
    isReminderSent: boolean;
    updatedAt: string;
    createdAt?: string;
    userId: string; // Changed to string (UUID)
    tags: { id: string; name: string }[];
};

export type TagDocType = {
    id: string;
    name: string;
    userId: string; // Changed to string (UUID)
    updatedAt: string;
    syncDeleted: boolean;
};

export type MyDatabaseCollections = {
    notes: RxCollection<NoteDocType>;
    tags: RxCollection<TagDocType>;
};

export type MyDatabase = RxDatabase<MyDatabaseCollections>;

let dbPromise: Promise<MyDatabase> | null = null;

export const getDatabase = async (): Promise<MyDatabase> => {
    if (!isClient) return null as unknown as MyDatabase;
    if (!dbPromise) {
        dbPromise = createDatabase();
    }
    return dbPromise;
};

const createDatabase = async (): Promise<MyDatabase> => {
    let storage: RxStorage<unknown, unknown> = getRxStorageDexie();

    // 3. Оборачиваем хранилище ТОЛЬКО если мы в dev режиме
    if (isDev) {
        storage = wrappedValidateAjvStorage({ storage });
    }

    const db = await createRxDatabase<MyDatabaseCollections>({
        name: 'monokeepdb_v2',
        storage,
        ignoreDuplicate: isDev // Only allowed in dev-mode, throws DB9 in production
    });

    await db.addCollections({
        notes: { schema: noteSchema },
        tags: { schema: tagSchema }
    });

    return db;
};