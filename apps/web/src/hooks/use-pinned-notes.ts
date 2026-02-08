import { create } from 'zustand';
import { NoteResponseDto } from '@monokeep/shared';
import { getDatabase, NoteDocType } from '@/lib/db';
import { Subscription } from 'rxjs';

interface PinnedNotesState {
    notes: NoteResponseDto[];
    isLoading: boolean;
    init: () => Promise<void>;
}

let sub: Subscription | null = null;

export const usePinnedNotes = create<PinnedNotesState>((set) => ({
    notes: [],
    isLoading: true,
    init: async () => {
        if (typeof window === 'undefined') return;

        // Extract User ID
        let userId = 0;
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
                    userId = payload.sub;
                }
            }
        } catch (e) {
            console.error('Failed to parse token for userId', e);
        }

        const db = await getDatabase();

        if (sub) sub.unsubscribe();

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

        sub = query.$.subscribe((docs: NoteDocType[]) => {
            const mapped = docs.map((doc: any) => {
                // @ts-ignore
                const data = typeof doc.toJSON === 'function' ? doc.toJSON() : doc;
                return {
                    ...data,
                    updatedAt: new Date(data.updatedAt),
                    createdAt: new Date(data.createdAt || new Date()),
                    deletedAt: data.deletedAt ? new Date(data.deletedAt) : null,
                    reminderDate: data.reminderDate ? new Date(data.reminderDate) : null,
                    tags: data.tags || []
                };
            }) as unknown as NoteResponseDto[];

            set({ notes: mapped, isLoading: false });
        });
    }
}));
