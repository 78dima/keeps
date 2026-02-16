import { create } from 'zustand';
import { NoteResponseDto, CreateNoteDto, UpdateNoteDto } from '@monokeep/shared';
import { getDatabase, NoteDocType } from '@/lib/db';
import { replicateCollections, cancelReplication } from '@/lib/replication';
import { supabase } from '@/lib/supabase';
import { Subscription } from 'rxjs';

interface KeepNoteImport {
    id?: string;
    title?: string;
    textContent?: string;
    content?: string;
    color?: string;
    isPinned?: boolean;
    isArchived?: boolean;
    isTrashed?: boolean;
    createdTimestampUsec?: number;
    userEditedTimestampUsec?: number;
    createdAt?: string;
    tags?: { name: string }[];
    [key: string]: unknown;
}

interface NotesState {
    notes: NoteResponseDto[];
    searchQuery: string;
    selectedNote: NoteResponseDto | null;
    isEditModalOpen: boolean;
    viewMode: 'active' | 'trash' | 'archive';
    isLoading: boolean;
    refreshTrigger: number;
    userId: string;

    // Actions
    init: () => Promise<void>;
    setNotes: (notes: NoteResponseDto[]) => void;
    setSearchQuery: (query: string) => void;
    setViewMode: (mode: 'active' | 'trash' | 'archive') => Promise<void>;
    setUserId: (id: string) => void;

    setSelectedNote: (note: NoteResponseDto | null) => void;
    openEditModal: (note: NoteResponseDto) => void;
    closeEditModal: () => void;

    // DB Actions
    createNote: (note: CreateNoteDto) => Promise<void>;
    updateNote: (note: UpdateNoteDto) => Promise<void>;
    restoreNote: (noteId: string) => Promise<void>;
    deleteNote: (noteId: string) => Promise<void>;
    deleteNoteForever: (noteId: string) => Promise<void>;
    importNotes: (notes: KeepNoteImport[]) => Promise<void>;

    // Deprecated
    triggerRefresh: () => void;
}

const sortNotes = (posts: NoteResponseDto[]) => {
    return [...posts].sort((a, b) => {
        // 1. Reminder Sent (Top Priority)
        if (a.isReminderSent && !b.isReminderSent) return -1;
        if (!a.isReminderSent && b.isReminderSent) return 1;

        // 2. Date (Newest first)
        const dateA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const dateB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;

        if (dateA !== dateB) {
            return dateB - dateA;
        }

        // 3. Fallback to ID string comparison for stability
        return a.id.localeCompare(b.id);
    });
};

let dbSubscription: Subscription | null = null;
let authSubscription: { unsubscribe: () => void } | null = null;
let isInitialized = false;

export const useNotesStore = create<NotesState>((set, get) => ({
    notes: [],
    searchQuery: '',
    selectedNote: null,
    isEditModalOpen: false,
    viewMode: 'active',
    isLoading: true,
    refreshTrigger: 0,
    userId: '',

    init: async () => {
        if (typeof window === 'undefined') return;

        // Prevent double initialization
        if (isInitialized) return;
        isInitialized = true;

        // 1. Get User ID from Supabase SDK
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.user?.id) {
                set({ userId: session.user.id });
            }

            // Cleanup previous auth listener if any
            if (authSubscription) {
                authSubscription.unsubscribe();
                authSubscription = null;
            }

            // Listen for auth changes
            const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
                const prevUserId = get().userId;
                const newUserId = session?.user?.id ?? '';

                if (newUserId && newUserId !== prevUserId) {
                    // New user logged in (or token refreshed with different user)
                    set({ userId: newUserId });

                    // Restart replication for new user
                    const db = await getDatabase();
                    await replicateCollections(db.collections, newUserId);

                    // Reload current view
                    const { viewMode } = get();
                    get().setViewMode(viewMode);
                } else if (!newUserId && prevUserId) {
                    // User logged out
                    set({ userId: '', notes: [] });
                    await cancelReplication();

                    if (dbSubscription) {
                        dbSubscription.unsubscribe();
                        dbSubscription = null;
                    }
                }
            });
            authSubscription = subscription;

        } catch (e) {
            console.error('Failed to get Supabase session', e);
        }

        // 2. Init DB and start replication
        const db = await getDatabase();
        const { userId } = get();

        if (userId) {
            await replicateCollections(db.collections, userId);
        }
    },

    setNotes: (notes) => set({ notes: sortNotes(notes) }),
    setSearchQuery: (query) => {
        set({ searchQuery: query });
        const { viewMode } = get();
        get().setViewMode(viewMode);
    },
    setUserId: (id) => set({ userId: id }),

    setSelectedNote: (note) => set({ selectedNote: note }),
    openEditModal: (note) => set({ selectedNote: note, isEditModalOpen: true }),
    closeEditModal: () => set({ selectedNote: null, isEditModalOpen: false }),

    setViewMode: async (mode) => {
        set({ viewMode: mode, isLoading: true });

        if (typeof window === 'undefined') return;
        const db = await getDatabase();
        const { searchQuery, userId } = get();

        // If no user, show nothing
        if (!userId) {
            set({ notes: [], isLoading: false });
            return;
        }

        if (dbSubscription) {
            dbSubscription.unsubscribe();
            dbSubscription = null;
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const selector: any = {
            userId: userId
        };

        // Mode filtering
        if (mode === 'trash') {
            selector.isDeleted = true;
            selector.syncDeleted = { $ne: true };
        } else if (mode === 'archive') {
            selector.isArchived = true;
            selector.isDeleted = false;
            selector.syncDeleted = { $ne: true };
        } else {
            // Active
            selector.isDeleted = false;
            selector.isArchived = false;
            selector.syncDeleted = { $ne: true };
        }

        // Search filtering
        if (searchQuery) {
            const escapeRegExp = (string: string) => {
                return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            }
            const regex = { $regex: escapeRegExp(searchQuery), $options: 'i' };

            selector.$or = [
                { title: regex },
                { content: regex },
                { tags: { $elemMatch: { name: regex } } }
            ];
        }

        const query = db.notes.find({
            selector,
            sort: [{ updatedAt: 'desc' }]
        });

        dbSubscription = query.$.subscribe((docs: NoteDocType[]) => {
            const mappedNotes = docs.map(doc => {
                // @ts-expect-error - RxDocument toJSON
                const data = typeof doc.toJSON === 'function' ? doc.toJSON() : doc;
                return {
                    ...data,
                    updatedAt: new Date(data.updatedAt),
                    createdAt: data.createdAt ? new Date(data.createdAt) : new Date(),
                    reminderDate: data.reminderDate ? new Date(data.reminderDate) : null,
                    tags: data.tags || [],
                    deleted: data.syncDeleted
                };
            }) as unknown as NoteResponseDto[];

            set({ notes: sortNotes(mappedNotes), isLoading: false });
        });
    },


    createNote: async (note) => {
        const db = await getDatabase();
        const { userId } = get();

        if (!userId) {
            console.error("Cannot create note: No User ID");
            return;
        }

        const tags = (note.tags || []).map(tag => ({
            id: crypto.randomUUID(),
            name: tag
        }));

        await db.notes.insert({
            id: crypto.randomUUID(),
            ...note,
            title: note.title || 'Untitled',
            content: note.content || '',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            syncDeleted: false,
            isDeleted: false,
            isArchived: false,
            isPinned: false,
            isReminderSent: false,
            reminderDate: note.reminderDate ? new Date(note.reminderDate).toISOString() : null,
            tags,
            userId: userId
        });
    },

    updateNote: async (note) => {
        const db = await getDatabase();
        if (!note.id) return;
        const existing = await db.notes.findOne(note.id).exec();
        if (existing) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const updateData: any = { ...note };

            // 1. Remove RxDB internal fields and mapped fields not in schema
            delete updateData._rev;
            delete updateData._meta;
            delete updateData._attachments;
            delete updateData._deleted;
            delete updateData.deleted; // Mapped from syncDeleted

            // 2. Convert Date objects to ISO strings
            const dateFields = ['createdAt', 'updatedAt', 'deletedAt', 'reminderDate'];
            dateFields.forEach(field => {
                if (updateData[field] instanceof Date) {
                    updateData[field] = updateData[field].toISOString();
                }
            });

            // 3. Explicitly handle specific fields logic
            updateData.updatedAt = new Date().toISOString();

            if (note.reminderDate !== undefined) {
                updateData.reminderDate = note.reminderDate ? new Date(note.reminderDate).toISOString() : null;
            }

            // 4. Handle Tags: Ensure they are correctly formatted
            if (note.tags) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                updateData.tags = note.tags.map((tag: any) => {
                    if (typeof tag === 'string') {
                        return {
                            id: crypto.randomUUID(),
                            name: tag
                        };
                    }
                    return tag;
                });
            } else {
                if (!('tags' in note)) {
                    delete updateData.tags;
                }
            }

            await existing.patch(updateData);
        }
    },

    restoreNote: async (noteId) => {
        const db = await getDatabase();
        const note = await db.notes.findOne(noteId).exec();
        if (note) {
            await note.patch({
                isDeleted: false,
                isArchived: false,
                updatedAt: new Date().toISOString()
            });
        }
    },

    deleteNote: async (noteId) => {
        const db = await getDatabase();
        const note = await db.notes.findOne(noteId).exec();
        if (note) {
            await note.patch({
                isDeleted: true,
                updatedAt: new Date().toISOString()
            });
        }
    },

    deleteNoteForever: async (noteId) => {
        const db = await getDatabase();
        const note = await db.notes.findOne(noteId).exec();
        if (note) {
            await note.patch({
                syncDeleted: true,
                updatedAt: new Date().toISOString()
            });
        }
    },

    importNotes: async (notesData: KeepNoteImport[]) => {
        const db = await getDatabase();
        const { userId } = get();

        if (!userId) {
            console.error("Cannot import notes: No User ID");
            return;
        }

        const notesToInsert = notesData.map(n => ({
            id: n.id || crypto.randomUUID(),
            title: n.title || 'Untitled',
            content: n.content || n.textContent || '',
            color: n.color || null,
            createdAt: n.createdTimestampUsec ? new Date(n.createdTimestampUsec / 1000).toISOString() : new Date().toISOString(),
            updatedAt: n.userEditedTimestampUsec ? new Date(n.userEditedTimestampUsec / 1000).toISOString() : new Date().toISOString(),
            syncDeleted: false,
            isDeleted: n.isTrashed || false,
            isArchived: n.isArchived || false,
            isPinned: n.isPinned || false,
            isReminderSent: false,
            tags: (n.tags || []).map(t => ({
                id: crypto.randomUUID(),
                name: t.name
            })),
            userId: userId
        }));

        try {
            await db.notes.bulkInsert(notesToInsert);
        } catch (error) {
            console.error('Failed to import notes:', error);
        }
    },

    // Deprecated
    triggerRefresh: () => { },
}));
