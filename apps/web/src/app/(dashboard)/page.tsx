'use client';

import { useEffect, useState } from 'react';
import { CreateNote } from '@/components/notes/create-note';
import { NoteCard } from '@/components/notes/note-card';
import { useToast } from '@/hooks/use-toast';
import { EditNoteDialog } from '@/components/notes/edit-note-dialog';
import { NoteResponseDto } from '@monokeep/shared';
import { useSearchParams } from 'next/navigation';
import { useNotesStore } from '@/store/useNotesStore';

type TierFilter = 'all' | 'alarm' | 'scheduled';
const NOTE_COLORS_MAP: Record<string, string> = {
    '#f28b82': 'Red', '#fbbc04': 'Orange', '#fff475': 'Yellow', '#ccff90': 'Green',
    '#a7ffeb': 'Teal', '#cbf0f8': 'Blue', '#aecbfa': 'Indigo', '#d7aefb': 'Purple',
    '#fdcfe8': 'Pink', '#e6c9a8': 'Brown', '#e8eaed': 'Gray',
};

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

    const [tierFilter, setTierFilter] = useState<TierFilter>('all');
    const [colorFilter, setColorFilter] = useState<string | null>(null);

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
        console.log(note, ' dasdasdad');
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

    // --- Color filter: extract unique colors used by notes ---
    const usedColors = [...new Set(notes.map(n => n.color).filter((c): c is string => !!c && c !== '#ffffff'))];

    // --- Apply color filter first ---
    const colorFiltered = colorFilter ? notes.filter(n => n.color === colorFilter) : notes;

    // --- Tier filtering ---
    const pinned = colorFiltered.filter(n => n.isPinned);
    const nonPinned = colorFiltered.filter(n => !n.isPinned);
    const alarm = nonPinned.filter(n => n.reminderDate && n.isReminderSent);
    const scheduled = nonPinned.filter(n => n.reminderDate && !n.isReminderSent);

    const filterButtons: { key: TierFilter; label: string; count: number }[] = [
        { key: 'all', label: 'All', count: colorFiltered.length },
        { key: 'alarm', label: '🔥 Alarm', count: alarm.length },
        { key: 'scheduled', label: '⏰ Scheduled', count: scheduled.length },
    ];
    const renderGrid = (items: NoteResponseDto[], label: string) => {
        if (items.length === 0) return null;
        return (
            <section>
                <h2 className="text-xs font-bold tracking-wider text-muted-foreground uppercase mb-4 pl-1">
                    {label}
                </h2>
                <div className="columns-1 sm:columns-2 lg:columns-3 gap-4 space-y-4">
                    {items.map(note => (
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
        );
    };

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
                <div className="space-y-8">
                    {/* Tier filter pills */}
                    <div className="flex flex-wrap gap-2 pl-1">
                        {filterButtons.map(({ key, label, count }) => (
                            <button
                                key={key}
                                onClick={() => setTierFilter(key)}
                                className={`
                                    px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-200
                                    ${tierFilter === key
                                        ? 'bg-foreground text-background shadow-md'
                                        : 'bg-black/5 text-muted-foreground hover:bg-black/10 hover:text-foreground'
                                    }
                                `}
                            >
                                {label}
                                {count > 0 && (
                                    <span className={`ml-1.5 text-xs ${tierFilter === key ? 'opacity-70' : 'opacity-50'}`}>
                                        {count}
                                    </span>
                                )}
                            </button>
                        ))}
                    </div>

                    {/* Color filter pills */}
                    {usedColors.length > 0 && (
                        <div className="flex gap-2 pl-1 items-center">
                            <button
                                onClick={() => setColorFilter(null)}
                                className={`px-3 py-1 rounded-full text-xs font-medium transition-all duration-200 ${colorFilter === null
                                        ? 'bg-foreground text-background shadow-md'
                                        : 'bg-black/5 text-muted-foreground hover:bg-black/10'
                                    }`}
                            >
                                All colors
                            </button>
                            {usedColors.map(c => (
                                <button
                                    key={c}
                                    onClick={() => setColorFilter(colorFilter === c ? null : c)}
                                    className={`w-6 h-6 rounded-full border-2 transition-all duration-200 hover:scale-110 ${colorFilter === c
                                            ? 'ring-2 ring-black/30 scale-110 shadow-md border-white/70'
                                            : 'border-black/10 hover:shadow-md'
                                        }`}
                                    style={{ backgroundColor: c }}
                                    title={NOTE_COLORS_MAP[c] || c}
                                />
                            ))}
                        </div>
                    )}

                    {/* Pinned — always visible */}
                    {renderGrid(pinned, '📌 Pinned')}

                    {/* Filtered views */}
                    {tierFilter === 'all' && renderGrid(nonPinned, '📄 Notes')}
                    {tierFilter === 'alarm' && renderGrid(alarm, '🔥 Alarm')}
                    {tierFilter === 'scheduled' && renderGrid(scheduled, '⏰ Scheduled')}
                </div>
            )}
        </div>
    );
}