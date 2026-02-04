'use client';

import { useEffect } from 'react';
import api from '@/lib/api';
import { CreateNote } from '@/components/notes/create-note';
import { NoteCard } from '@/components/notes/note-card';
import { useToast } from '@/hooks/use-toast';
import { EditNoteDialog } from '@/components/notes/edit-note-dialog';
import { NoteResponseDto } from '@monokeep/shared';
import { useSearchParams } from 'next/navigation';
import { useNotesStore } from '@/store/useNotesStore';

export default function DashboardPage() {
    const {
        notes,
        fetchNotes,
        selectedNote,
        isEditModalOpen,
        openEditModal,
        closeEditModal,
        deleteNote
    } = useNotesStore();

    const { toast } = useToast();
    const searchParams = useSearchParams();
    const search = searchParams.get('search') || '';
    const { setSearchQuery } = useNotesStore();

    useEffect(() => {
        setSearchQuery(search);
        fetchNotes();
    }, [search, fetchNotes, setSearchQuery]);

    const handlePin = async (note: NoteResponseDto) => {
        try {
            await api.patch(`/notes/${note.id}`, { isPinned: !note.isPinned });
            fetchNotes();
            useNotesStore.getState().triggerRefresh(); // Refresh sidebar
        } catch {
            toast({ variant: "destructive", title: "Failed to update pin" });
        }
    };

    const handleDelete = async (note: NoteResponseDto) => {
        try {
            await api.patch(`/notes/${note.id}`, { isDeleted: true });
            deleteNote(note.id); // Optimistic update in store
            toast({ title: "Note moved to trash" });
        } catch {
            toast({ variant: "destructive", title: "Failed to delete" });
        }
    };

    const handleUpdate = async (note: NoteResponseDto) => {
        try {
            // Optimistic update
            const updated = { ...note };
            useNotesStore.getState().updateNote(updated);

            await api.patch(`/notes/${note.id}`, {
                isReminderSent: note.isReminderSent,
                reminderDate: note.reminderDate // In case we need to update date too
            });
            fetchNotes();
        } catch {
            toast({ variant: "destructive", title: "Failed to update note" });
            fetchNotes(); // Revert on error
        }
    };

    return (
        <div className="mx-auto w-full max-w-5xl">
            <CreateNote onCreated={fetchNotes} />

            <EditNoteDialog
                note={selectedNote}
                isOpen={isEditModalOpen}
                onClose={closeEditModal}
                onUpdate={fetchNotes}
            />

            <div className="columns-1 sm:columns-2 lg:columns-3 gap-4 space-y-4">
                {notes.map(note => (
                    <div key={note.id} className="break-inside-avoid">
                        <NoteCard
                            note={note}
                            onEdit={(n) => openEditModal(n)}
                            onPin={handlePin}
                            onDelete={handleDelete}
                            onUpdate={handleUpdate}
                        />
                    </div>
                ))}
            </div>
            {notes.length === 0 && (
                <div className="text-center text-muted-foreground mt-20">
                    <p>No notes found</p>
                </div>
            )}
        </div>
    );
}