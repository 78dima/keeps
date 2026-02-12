import { create } from 'zustand';
import { NoteResponseDto } from '@monokeep/shared';
import { getDatabase, NoteDocType } from '@/lib/db';

import { Subscription } from 'rxjs';
import { RxDocument } from 'rxdb';

interface PinnedNotesState {
    notes: NoteResponseDto[];
    isLoading: boolean;
    init: (userId: string) => Promise<void>;
}

let sub: Subscription | null = null;

export const usePinnedNotes = create<PinnedNotesState>((set) => ({
    notes: [],
    isLoading: true,
    init: async (userId: string) => {
        if (typeof window === 'undefined') return;

        const db = await getDatabase();

        if (sub) sub.unsubscribe();

        // If no user, clear notes and return
        if (!userId) {
            set({ notes: [], isLoading: false });
            return;
        }

        const query = db.notes.find({
            selector: {
                userId: userId,
                isPinned: true,
                isDeleted: false,
                isArchived: false,
                syncDeleted: { $ne: true }
            },
            sort: [{ updatedAt: 'desc' }]
        });

        sub = query.$.subscribe((docs: RxDocument<NoteDocType>[]) => {
            const mapped = docs.map((doc) => {
                const data = typeof doc.toJSON === 'function' ? doc.toJSON() : doc;
                return {
                    ...data,
                    updatedAt: new Date(data.updatedAt),
                    createdAt: new Date(data.createdAt || new Date()), // Добавил fallback
                    deletedAt: data.deletedAt ? new Date(data.deletedAt) : null,
                    reminderDate: data.reminderDate ? new Date(data.reminderDate) : null,
                    tags: data.tags || [],
                    // Маппинг для DTO (если в DTO поле называется deleted, а в базе syncDeleted)
                    deleted: data.syncDeleted
                };
            }) as unknown as NoteResponseDto[];

            set({ notes: mapped, isLoading: false });
        });
    }
}));
