'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Plus, CalendarIcon, Bell } from 'lucide-react';
import { useNotesStore } from '@/store/useNotesStore';
import { TagInput } from '@/components/ui/tag-input';

const NOTE_COLORS = ['#ffffff', '#f28b82', '#fbbc04', '#fff475', '#ccff90', '#a7ffeb', '#cbf0f8', '#aecbfa', '#d7aefb', '#fdcfe8', '#e6c9a8', '#e8eaed'];

interface CreateNoteProps {
    onCreated: () => void;
}

export function CreateNote({ onCreated }: CreateNoteProps) {
    const { createNote } = useNotesStore();
    const [isExpanded, setIsExpanded] = useState(false);
    const [title, setTitle] = useState('');
    const [content, setContent] = useState('');
    const [tags, setTags] = useState<string[]>([]);
    const [color, setColor] = useState<string | null>(null);
    const [reminder, setReminder] = useState('');
    const [isCreating, setIsCreating] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    const resetForm = () => {
        setTitle('');
        setContent('');
        setTags([]);
        setColor(null);
        setReminder('');
    };

    const handleSave = useCallback(async () => {
        if (!title && !content) return;
        if (isCreating) return;

        setIsCreating(true);
        try {
            await createNote({
                title,
                content: content || '',
                tags,
                color: color || undefined,
                reminderDate: reminder ? new Date(reminder) : undefined,
                isPinned: false,
                isArchived: false
            });
            resetForm();
            onCreated();
        } catch (e: unknown) {
            console.error("Failed to create note", e);
        } finally {
            setIsCreating(false);
        }
    }, [title, content, tags, color, reminder, onCreated, isCreating, createNote]);

    // Close when clicking outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                if (title || content) {
                    handleSave();
                }
                setIsExpanded(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [title, content, handleSave]);

    if (!isExpanded) {
        return (
            <div className="flex justify-center mb-8 px-4">
                <Card
                    className="w-full max-w-[600px] shadow-sm hover:shadow-lg transition-all duration-300 cursor-text rounded-full border-transparent bg-white ring-1 ring-black/5 group"
                    onClick={() => setIsExpanded(true)}
                >
                    <CardContent className="p-0 pl-6 flex items-center text-muted-foreground/60 font-medium h-14">
                        <span className="flex-1 text-base group-hover:text-foreground/80 transition-colors">Take a note...</span>
                        <div className="flex gap-1 pr-2">
                            <Button size="icon" variant="ghost" className="rounded-full hover:bg-black/5 text-muted-foreground">
                                <Plus className="h-5 w-5" />
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </div>
        );
    }

    const handleClose = () => {
        resetForm();
        setIsExpanded(false);
    };

    const handleCreate = async () => {
        await handleSave();
        setIsExpanded(false);
    }

    return (
        <div className="flex justify-center mb-8 px-4">
            <Card
                className="w-full max-w-[600px] shadow-xl shadow-black/5 rounded-[2rem] border-transparent ring-1 ring-black/5 transition-all"
                style={{ backgroundColor: color ? `${color}F0` : 'white' }}
                ref={containerRef}
            >
                <CardContent className="p-6 flex flex-col gap-1">
                    <Input
                        placeholder="Title"
                        className="border-none shadow-none text-xl font-display font-bold px-0 focus-visible:ring-0 placeholder:text-muted-foreground/40 bg-transparent h-auto py-2"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        disabled={isCreating}
                    />
                    <Textarea
                        placeholder="Take a note..."
                        className="border-none shadow-none resize-none px-0 min-h-[100px] focus-visible:ring-0 text-base font-sans text-foreground/80 placeholder:text-muted-foreground/40 bg-transparent leading-relaxed"
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        autoFocus
                        disabled={isCreating}
                    />

                    <div className="mt-2">
                        <TagInput
                            value={tags}
                            onChange={setTags}
                            placeholder="Add tag..."
                            className="border-none p-0 bg-transparent text-sm"
                            disabled={isCreating}
                        />
                    </div>

                    {/* Reminder + Color section */}
                    <div className="mt-4 pt-3 border-t border-black/5 space-y-3">
                        {/* Reminder */}
                        <div className="flex items-center gap-2">
                            <div className="flex items-center gap-1.5 text-xs font-bold text-black/40 uppercase tracking-widest">
                                <CalendarIcon className="w-3 h-3" />
                                <span>Reminder</span>
                            </div>
                            <Input
                                type="datetime-local"
                                value={reminder}
                                onChange={(e) => setReminder(e.target.value)}
                                className="w-fit h-auto text-xs bg-transparent border-none shadow-none focus-visible:ring-0 p-0 text-foreground/80 font-medium font-mono"
                                disabled={isCreating}
                            />
                            {reminder && (
                                <div className="p-1.5 rounded-full bg-amber-100 text-amber-700 ring-1 ring-amber-300">
                                    <Bell className="w-3.5 h-3.5" />
                                </div>
                            )}
                        </div>

                        {/* Color palette */}
                        <div className="flex gap-2.5 items-center overflow-x-auto scrollbar-hide">
                            {NOTE_COLORS.map(c => (
                                <button
                                    key={c}
                                    className={`w-7 h-7 flex-shrink-0 rounded-full cursor-pointer border-2 border-white/50 transition-all duration-200 hover:scale-110 shadow-sm ${color === c ? 'ring-2 ring-black/20 scale-110 shadow-md' : 'hover:shadow-md'}`}
                                    style={{ backgroundColor: c }}
                                    onClick={() => !isCreating && setColor(c === '#ffffff' ? null : c)}
                                    disabled={isCreating}
                                    aria-label={`Select color ${c}`}
                                />
                            ))}
                        </div>
                    </div>

                    <div className="flex justify-between items-center mt-4 pt-2">
                        <div className="flex gap-1 text-muted-foreground">
                            {/* Actions placeholder */}
                        </div>
                        <div className="flex gap-3">
                            <Button size="sm" variant="ghost" className="font-medium hover:bg-black/5 rounded-full px-6 text-foreground/70" onClick={handleClose} disabled={isCreating}>Close</Button>
                            <Button size="sm" className="font-medium rounded-full px-6 bg-foreground text-background hover:bg-foreground/90 shadow-sm transition-all hover:shadow-md" onClick={handleCreate} disabled={(!title && !content) || isCreating}>
                                {isCreating ? 'Creating...' : 'Create'}
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
