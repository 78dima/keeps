'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Plus } from 'lucide-react';
import api from '@/lib/api';
import { TagInput } from '@/components/ui/tag-input';

interface CreateNoteProps {
    onCreated: () => void;
}

export function CreateNote({ onCreated }: CreateNoteProps) {
    const [isExpanded, setIsExpanded] = useState(false);
    const [title, setTitle] = useState('');
    const [content, setContent] = useState('');
    const [tags, setTags] = useState<string[]>([]);
    const [isCreating, setIsCreating] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    const handleSave = useCallback(async () => {
        if (!title && !content) return;
        if (isCreating) return;

        setIsCreating(true);
        try {
            await api.post('/notes', {
                title: title || 'Untitled',
                content: content,
                tags: tags
            });
            setTitle('');
            setContent('');
            setTags([]);
            onCreated();
        } catch (e: unknown) {
            console.error("Failed to create note", e);
        } finally {
            setIsCreating(false);
        }
    }, [title, content, tags, onCreated, isCreating]);

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
        setTitle('');
        setContent('');
        setTags([]);
        setIsExpanded(false);
    };

    const handleCreate = async () => {
        await handleSave();
        setIsExpanded(false);
    }

    return (
        <div className="flex justify-center mb-8 px-4">
            <Card className="w-full max-w-[600px] shadow-xl shadow-black/5 rounded-[2rem] border-transparent bg-white ring-1 ring-black/5 transition-shadow" ref={containerRef}>
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

                    <div className="flex justify-between items-center mt-6 pt-2">
                        <div className="flex gap-1 text-muted-foreground">
                            {/* Actions placeholder - consistent aesthetic */}
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
