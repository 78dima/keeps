import { create } from 'zustand';
import { NoteResponseDto, CreateNoteDto, UpdateNoteDto } from '@monokeep/shared';
import { getDatabase, NoteDocType } from '@/lib/db';
import { replicateCollections } from '@/lib/replication';
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
    userId: number; // Added userId to state

    // Actions
    init: () => Promise<void>;
    setNotes: (notes: NoteResponseDto[]) => void;
    setSearchQuery: (query: string) => void;
    setViewMode: (mode: 'active' | 'trash' | 'archive') => Promise<void>;
    setUserId: (id: number) => void; // Added setUserId action

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

export const useNotesStore = create<NotesState>((set, get) => ({
    notes: [],
    searchQuery: '',
    selectedNote: null,
    isEditModalOpen: false,
    viewMode: 'active',
    isLoading: true,
    refreshTrigger: 0,
    userId: 0, // Default to 0

    init: async () => {
        if (typeof window === 'undefined') return;

        // Extract User ID from Token
        try {
            const token = localStorage.getItem('token');
            if (token) {
                const base64Url = token.split('.')[1];
                const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
                const jsonPayload = decodeURIComponent(window.atob(base64).split('').map(function (c) {
                    return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
                }).join(''));
                const payload = JSON.parse(jsonPayload);
                if (payload.sub) {
                    set({ userId: payload.sub });
                }
            }
        } catch (e) {
            console.error('Failed to parse token for userId', e);
        }

        const db = await getDatabase();
        await replicateCollections(db.collections);
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
        const { searchQuery, userId } = get(); // Get userId

        if (dbSubscription) {
            dbSubscription.unsubscribe();
            dbSubscription = null;
        }

        // eslint-disable-next-line
        const selector: any = {
            userId: userId
        };

        // Mode filtering
        if (mode === 'trash') {
            selector.isDeleted = true;
            // RxDB Filtering: Check syncDeleted, not deleted
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
            selector.title = { $regex: new RegExp(searchQuery, 'i') };
        }

        const query = db.notes.find({
            selector,
            sort: [{ updatedAt: 'desc' }]
        });

        dbSubscription = query.$.subscribe((docs: NoteDocType[]) => {
            const mappedNotes = docs.map(doc => {
                // @ts-ignore - RxDocument toJSON
                const data = typeof doc.toJSON === 'function' ? doc.toJSON() : doc;
                return {
                    ...data,
                    updatedAt: new Date(data.updatedAt),
                    createdAt: data.createdAt ? new Date(data.createdAt) : new Date(),
                    reminderDate: data.reminderDate ? new Date(data.reminderDate) : null,
                    tags: data.tags || [],
                    // Ensure DTO receives the sync status if needed, or map back
                    deleted: data.syncDeleted
                };
            }) as unknown as NoteResponseDto[];

            set({ notes: sortNotes(mappedNotes), isLoading: false });
        });
    },


    createNote: async (note) => {
        const db = await getDatabase();
        const { userId } = get(); // Get current userId

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
            syncDeleted: false, // Use syncDeleted
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
            let tags = existing.tags;
            if (note.tags) {
                tags = note.tags.map(tag => ({
                    id: crypto.randomUUID(),
                    name: tag
                }));
            }
            console.log(note);
            await existing.patch({
                ...note,
                color: note.color,
                reminderDate: note.reminderDate ? new Date(note.reminderDate).toISOString() : null,
                tags,
                updatedAt: new Date().toISOString()
            });
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
                syncDeleted: true, // Use syncDeleted
                updatedAt: new Date().toISOString()
            });
        }
    },

    importNotes: async (notesData: KeepNoteImport[]) => {
        const db = await getDatabase();
        const { userId } = get();

        const notesToInsert = notesData.map(n => ({
            id: n.id || crypto.randomUUID(),
            title: n.title || 'Untitled',
            content: n.content || n.textContent || '',
            color: n.color || null,
            createdAt: n.createdTimestampUsec ? new Date(n.createdTimestampUsec / 1000).toISOString() : new Date().toISOString(),
            updatedAt: n.userEditedTimestampUsec ? new Date(n.userEditedTimestampUsec / 1000).toISOString() : new Date().toISOString(),
            syncDeleted: false, // Use syncDeleted
            isDeleted: n.isTrashed || false,
            isArchived: n.isArchived || false,
            isPinned: n.isPinned || false,
            isReminderSent: false,
            tags: [],
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
