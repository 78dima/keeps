import { create } from 'zustand';
import { NoteResponseDto } from '@monokeep/shared';
import api from '@/lib/api';

interface NotesState {
    notes: NoteResponseDto[];
    searchQuery: string;
    selectedNote: NoteResponseDto | null; // For editing
    isEditModalOpen: boolean;

    // Actions
    setNotes: (notes: NoteResponseDto[]) => void;
    setSearchQuery: (query: string) => void;
    setSelectedNote: (note: NoteResponseDto | null) => void;
    openEditModal: (note: NoteResponseDto) => void;
    closeEditModal: () => void;

    // Async Actions
    fetchNotes: () => Promise<void>;
    fetchTrashNotes: () => Promise<void>;
    updateNote: (updatedNote: NoteResponseDto) => void;
    restoreNote: (noteId: number) => Promise<void>;
    deleteNote: (noteId: number) => void;
    deleteNoteForever: (noteId: number) => Promise<void>;
    triggerRefresh: () => void;
    refreshTrigger: number;
}

const sortNotes = (posts: NoteResponseDto[]) => {
    return [...posts].sort((a, b) => {
        // 1. Reminder Sent (Top Priority)
        if (a.isReminderSent && !b.isReminderSent) return -1;
        if (!a.isReminderSent && b.isReminderSent) return 1;

        // 2. Date (Newest first) or ID
        return b.id - a.id;
    });
};

export const useNotesStore = create<NotesState>((set, get) => ({
    notes: [],
    searchQuery: '',
    selectedNote: null,
    isEditModalOpen: false,
    refreshTrigger: 0, // Used to trigger refreshes in other components

    setNotes: (notes) => set({ notes: sortNotes(notes) }),
    setSearchQuery: (query) => set({ searchQuery: query }),

    setSelectedNote: (note) => set({ selectedNote: note }),

    openEditModal: (note) => set({ selectedNote: note, isEditModalOpen: true }),
    closeEditModal: () => set({ selectedNote: null, isEditModalOpen: false }),

    fetchNotes: async () => {
        const { searchQuery } = get();
        try {
            const res = await api.get(`/notes?search=${searchQuery}`);
            set({ notes: sortNotes(res.data) });
        } catch (e) {
            console.error("Failed to fetch notes", e);
        }
    },

    fetchTrashNotes: async () => {
        try {
            const res = await api.get('/notes/trash');
            set({ notes: res.data }); // Trash notes don't need the same complex sorting, usually just deletedAt desc (handled by backend or simple sort)
        } catch (e) {
            console.error("Failed to fetch trash notes", e);
        }
    },

    triggerRefresh: () => set((state) => ({ refreshTrigger: state.refreshTrigger + 1 })),

    updateNote: (updatedNote) => {
        set((state) => {
            const newNotes = state.notes.map((n) => (n.id === updatedNote.id ? updatedNote : n));
            return {
                notes: sortNotes(newNotes),
                selectedNote: state.selectedNote?.id === updatedNote.id ? updatedNote : state.selectedNote,
                refreshTrigger: state.refreshTrigger + 1
            };
        });
    },

    restoreNote: async (noteId) => {
        // Optimistic
        set((state) => ({
            notes: state.notes.filter((n) => n.id !== noteId),
            refreshTrigger: state.refreshTrigger + 1
        }));
        try {
            await api.patch(`/notes/${noteId}`, { isDeleted: false });
        } catch (e) {
            console.error("Failed to restore note", e);
            // Ideally revert state here
        }
    },

    deleteNote: (noteId) => {
        // Optimistic move to trash (or delete from list)
        set((state) => ({
            notes: state.notes.filter((n) => n.id !== noteId),
            refreshTrigger: state.refreshTrigger + 1
        }));
    },

    deleteNoteForever: async (noteId) => {
        // Optimistic
        set((state) => ({
            notes: state.notes.filter((n) => n.id !== noteId),
            refreshTrigger: state.refreshTrigger + 1
        }));
        try {
            await api.delete(`/notes/${noteId}`);
        } catch (e) {
            console.error("Failed to delete note forever", e);
        }
    }
}));
