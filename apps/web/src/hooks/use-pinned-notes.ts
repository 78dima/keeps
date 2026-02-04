import { create } from 'zustand';
import api from '@/lib/api';
import { NoteResponseDto } from '@monokeep/shared';

interface PinnedNotesState {
    notes: NoteResponseDto[];
    offset: number;
    limit: number;
    hasMore: boolean;
    isLoading: boolean;
    fetchNotes: (reset?: boolean) => Promise<void>;
    addNote: (note: NoteResponseDto) => void;
    removeNote: (noteId: number) => void;
    updateNote: (note: NoteResponseDto) => void;
}

import { useNotesStore } from '@/store/useNotesStore';

export const usePinnedNotes = create<PinnedNotesState>((set, get) => ({
    notes: [],
    offset: 0,
    limit: 6,
    hasMore: true,
    isLoading: false,
    fetchNotes: async (reset = false) => {
        set({ isLoading: true });
        const { offset, limit, notes } = get();
        const currentOffset = reset ? 0 : offset;

        try {
            // Add timestamp/random to avoid cache if needed, though usually not needed with axios unless configured otherwise
            const res = await api.get<NoteResponseDto[]>(`/notes/pinned?skip=${currentOffset}&take=${limit}&t=${Date.now()}`);
            const newNotes = res.data;

            set({
                notes: reset ? newNotes : [...notes, ...newNotes],
                offset: currentOffset + newNotes.length,
                hasMore: newNotes.length === limit,
                isLoading: false,
            });
        } catch (error) {
            console.error('Failed to fetch pinned notes', error);
            set({ isLoading: false });
        }
    },
    addNote: (note) => set((state) => ({ notes: [note, ...state.notes] })),
    removeNote: (id) => set((state) => ({ notes: state.notes.filter(n => n.id !== id) })),
    updateNote: (note) => set((state) => ({
        notes: state.notes.map(n => n.id === note.id ? note : n).filter(n => n.isPinned)
    })),
}));

// Subscription to global store updates
// Subscription to global store updates
useNotesStore.subscribe((state, prevState) => {
    if (state.refreshTrigger !== prevState.refreshTrigger) {
        usePinnedNotes.getState().fetchNotes(true);
    }
});
