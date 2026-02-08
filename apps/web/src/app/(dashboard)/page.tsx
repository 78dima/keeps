'use client';

import { useEffect } from 'react';
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
        selectedNote,
        isEditModalOpen,
        openEditModal,
        closeEditModal,
        deleteNote,
        updateNote,
        setViewMode,
        isLoading
    } = useNotesStore();

    const { toast } = useToast();
    const searchParams = useSearchParams();
    const search = searchParams.get('search') || '';
    const { setSearchQuery } = useNotesStore();

    useEffect(() => {
        setSearchQuery(search);
        setViewMode('active');
    }, [search, setViewMode, setSearchQuery]);

    const handleUpdate = async (note: NoteResponseDto) => {
        try {
            await updateNote({
                ...note,
                tags: note.tags?.map(t => t.name)
            });
        } catch (error) {
            console.error("Failed to update note", error);
            toast({ variant: "destructive", title: "Failed to update note" });
        }
    };

    const handlePin = async (note: NoteResponseDto) => {
        try {
            await updateNote({
                ...note,
                isPinned: !note.isPinned,
                tags: note.tags?.map(t => t.name)
            });
        } catch (error) {
            console.error("Failed to pin note", error);
            toast({ variant: "destructive", title: "Failed to pin note" });
        }
    };

    const handleDelete = async (note: NoteResponseDto) => {
        try {
            await deleteNote(note.id);
            toast({ title: "Note moved to trash" });
        } catch {
            toast({ variant: "destructive", title: "Failed to delete" });
        }
    };

    if (isLoading && notes.length === 0) {
        return <div className="text-center mt-20">Loading notes...</div>;
    }

    return (
        <div className="mx-auto w-full max-w-5xl">
            <CreateNote onCreated={() => { }} />

            <EditNoteDialog
                note={selectedNote}
                isOpen={isEditModalOpen}
                onClose={closeEditModal}
                onUpdate={() => { }}
            />

            {notes.length === 0 ? (
                <div className="text-center text-muted-foreground mt-20">
                    <p>No notes found</p>
                </div>
            ) : (
                <div className="space-y-12">
                    {notes.some(n => n.isPinned) && (
                        <section>
                            <h2 className="text-xs font-bold tracking-wider text-muted-foreground uppercase mb-4 pl-1">
                                Pinned
                            </h2>
                            <div className="columns-1 sm:columns-2 lg:columns-3 gap-4 space-y-4">
                                {notes
                                    .filter(n => n.isPinned)
                                    .map(note => (
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
                        </section>
                    )}

                    {notes.some(n => !n.isPinned) && (
                        <section>
                            {notes.some(n => n.isPinned) && (
                                <h2 className="text-xs font-bold tracking-wider text-muted-foreground uppercase mb-4 pl-1">
                                    Others
                                </h2>
                            )}
                            <div className="columns-1 sm:columns-2 lg:columns-3 gap-4 space-y-4">
                                {notes
                                    .filter(n => !n.isPinned)
                                    .map(note => (
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
                        </section>
                    )}
                </div>
            )}
        </div>
    );
}