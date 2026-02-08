'use client';

import { useEffect, useState } from 'react';
import { NoteResponseDto } from '@monokeep/shared';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { CalendarIcon } from 'lucide-react';
import { TagInput } from '@/components/ui/tag-input';
import { useNotesStore } from '@/store/useNotesStore';

interface EditNoteDialogProps {
    note: NoteResponseDto | null;
    isOpen: boolean;
    onClose: () => void;
    onUpdate: () => void;
}

export function EditNoteDialog({ note, isOpen, onClose, onUpdate }: EditNoteDialogProps) {
    const [title, setTitle] = useState('');
    const [content, setContent] = useState('');
    const [color, setColor] = useState<string | null>(null);
    const [reminder, setReminder] = useState<string>('');
    const [tags, setTags] = useState<string[]>([]);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (note) {
            setTitle(note.title);
            setContent(note.content);
            setColor(note.color || null);
            setReminder(note.reminderDate ? new Date(note.reminderDate).toISOString().slice(0, 16) : '');
            // Convert Tag objects to string array for TagInput
            setTags(note.tags ? note.tags.map(t => t.name) : []);
        }
    }, [note]);


    const { updateNote } = useNotesStore();

    const handleSave = async () => {
        if (!note || isSaving) return;
        setIsSaving(true);
        try {
            await updateNote({
                id: note.id,
                title,
                content,
                color,
                reminderDate: reminder ? new Date(reminder) : null,
                tags: tags
            });
            onUpdate();
            onClose();
        } catch {
            console.error("Failed to update note");
        } finally {
            setIsSaving(false);
        }
    };

    if (!note) return null;

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && !isSaving && onClose()}>
            <DialogContent className="sm:max-w-[700px] p-0 gap-0 rounded-[2rem] border-0 shadow-2xl bg-white/90 backdrop-blur-2xl ring-1 ring-white/20 transition-all duration-300 flex flex-col max-h-[90vh] [&>button]:hidden outline-none" style={{ backgroundColor: color ? `${color}F0` : undefined }}>
                {/* Custom Close Button - Absolute Positioned */}
                <div className="absolute right-4 top-4 z-50">
                    <button
                        onClick={onClose}
                        disabled={isSaving}
                        className="p-2 rounded-full bg-black/5 hover:bg-black/10 transition-colors text-black/40 hover:text-black/80 disabled:opacity-50"
                    >
                        <span className="sr-only">Close</span>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                    </button>
                </div>

                <div className="flex flex-col h-full overflow-hidden">
                    {/* Header Section */}
                    <DialogHeader className="px-8 pt-10 pb-2 shrink-0">
                        <DialogTitle className="sr-only">Edit Note</DialogTitle>
                        <Input
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="Title"
                            className="border-none shadow-none text-3xl font-display font-bold tracking-tight px-0 py-1 h-auto focus-visible:ring-0 bg-transparent placeholder:text-black/20 text-foreground/90 w-full"
                            disabled={isSaving}
                        />
                    </DialogHeader>

                    {/* Scrollable Content Section */}
                    <div className="flex-1 overflow-y-auto px-8 py-2 min-h-0">
                        <Textarea
                            value={content}
                            onChange={(e) => setContent(e.target.value)}
                            placeholder="Note"
                            className="border-none shadow-none resize-none p-0 min-h-[150px] focus-visible:ring-0 bg-transparent text-lg font-sans text-foreground/80 leading-relaxed placeholder:text-black/30 scrollbar-hide w-full"
                            disabled={isSaving}
                        />

                        <div className="mt-6">
                            <TagInput
                                value={tags}
                                onChange={setTags}
                                placeholder="+ Add tag"
                                className="border-none p-0 bg-transparent text-sm placeholder:text-black/40"
                                disabled={isSaving}
                            />
                        </div>

                        {/* Controls Section within scroll view to prevent cut-off */}
                        <div className="mt-8 mb-4">
                            <div className="flex items-center gap-2 mb-3">
                                <div className="flex items-center gap-2 text-xs font-bold text-black/50 uppercase tracking-widest">
                                    <CalendarIcon className="w-3 h-3" />
                                    <span>Reminder</span>
                                </div>
                                <Input
                                    type="datetime-local"
                                    value={reminder}
                                    onChange={(e) => setReminder(e.target.value)}
                                    className="w-fit h-auto text-xs bg-transparent border-none shadow-none focus-visible:ring-0 p-0 text-foreground/80 font-medium font-mono"
                                    disabled={isSaving}
                                />
                            </div>

                            <div className="relative py-2 -mx-2 px-2">
                                <div className="flex gap-3 items-center overflow-x-auto pb-4 pt-2 scrollbar-hide px-1">
                                    {['#ffffff', '#f28b82', '#fbbc04', '#fff475', '#ccff90', '#a7ffeb', '#cbf0f8', '#aecbfa', '#d7aefb', '#fdcfe8', '#e6c9a8', '#e8eaed'].map(c => (
                                        <button
                                            key={c}
                                            className={`w-9 h-9 flex-shrink-0 rounded-full cursor-pointer border-2 border-white/50 transition-all duration-200 hover:scale-110 shadow-sm ${color === c ? 'ring-2 ring-black/20 scale-110 shadow-md' : 'hover:shadow-md'}`}
                                            style={{ backgroundColor: c }}
                                            onClick={() => !isSaving && setColor(c)}
                                            disabled={isSaving}
                                            aria-label={`Select color ${c}`}
                                        />
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Fixed Footer */}
                    <DialogFooter className="px-8 py-6 pt-4 bg-gradient-to-t from-black/5 to-transparent shrink-0 flex gap-3 sm:justify-end z-20">
                        <Button
                            variant="ghost"
                            className="rounded-full px-6 py-2 h-auto hover:bg-black/5 text-black/60 hover:text-foreground font-medium transition-all"
                            onClick={onClose}
                            disabled={isSaving}
                        >
                            Cancel
                        </Button>
                        <Button
                            className="rounded-full px-8 py-2 h-auto bg-foreground text-background hover:bg-foreground/90 font-medium shadow-lg shadow-black/5 transition-all hover:scale-105 active:scale-95"
                            onClick={handleSave}
                            disabled={isSaving}
                        >
                            {isSaving ? 'Saving...' : 'Save'}
                        </Button>
                    </DialogFooter>
                </div>
            </DialogContent>
        </Dialog>
    );
}
