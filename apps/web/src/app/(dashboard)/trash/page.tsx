'use client';

import { useEffect } from 'react';
import { NoteCard } from '@/components/notes/note-card';
import { useToast } from '@/hooks/use-toast';
import { NoteResponseDto } from '@monokeep/shared';
import { useNotesStore } from '@/store/useNotesStore';

export default function TrashPage() {
    const {
        notes,
        fetchTrashNotes,
        restoreNote,
        deleteNoteForever
    } = useNotesStore();

    const { toast } = useToast();

    useEffect(() => {
        fetchTrashNotes();
    }, [fetchTrashNotes]);

    const handleRestore = async (note: NoteResponseDto) => {
        try {
            await restoreNote(note.id);
            toast({ title: "Note restored" });
        } catch {
            toast({ variant: "destructive", title: "Failed to restore note" });
        }
    };

    const handleDeleteForever = async (note: NoteResponseDto) => {
        if (confirm("Are you sure you want to permanently delete this note? This action cannot be undone.")) {
            try {
                await deleteNoteForever(note.id);
                toast({ title: "Note deleted forever" });
            } catch {
                toast({ variant: "destructive", title: "Failed to delete note" });
            }
        }
    };

    return (
        <div className="mx-auto w-full max-w-5xl">
            <h1 className="text-2xl font-bold mb-6 px-4">Trash</h1>

            <div className="columns-1 sm:columns-2 lg:columns-3 gap-4 space-y-4">
                {notes.map(note => (
                    <div key={note.id} className="break-inside-avoid">
                        <NoteCard
                            note={note}
                            onEdit={() => { }} // Can't edit in trash, maybe view only or restore first? For now disabling edit
                            onPin={() => { }} // Disabled in trash
                            onDelete={handleDeleteForever}
                            onRestore={handleRestore}
                            isTrash={true}
                        />
                    </div>
                ))}
            </div>
            {notes.length === 0 && (
                <div className="text-center text-muted-foreground mt-20">
                    <p>Trash is empty</p>
                </div>
            )}
        </div>
    );
}
