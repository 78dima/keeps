'use client';

import { useState } from 'react';
import { NoteResponseDto } from '@monokeep/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Pin, Trash, CheckCheck, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

interface NoteCardProps {
    note: NoteResponseDto;
    onEdit: (note: NoteResponseDto) => void;
    onPin: (note: NoteResponseDto) => void;
    onDelete: (note: NoteResponseDto) => void;
    onUpdate?: (note: NoteResponseDto) => void;
    isTrash?: boolean;
    onRestore?: (note: NoteResponseDto) => void;
}

export function NoteCard({ note, onEdit, onPin, onDelete, onUpdate, isTrash, onRestore }: NoteCardProps) {
    const [actionStatus, setActionStatus] = useState<'pinning' | 'deleting' | 'restoring' | 'updating' | null>(null);

    // Map color to tailwind classes if needed, or use inline style for custom hex
    // Requirement allows "HEX string".
    const bgStyle = note.color ? { backgroundColor: note.color } : {};

    const handleAction = async (e: React.MouseEvent, type: 'pinning' | 'deleting' | 'restoring' | 'updating', action: () => Promise<void> | void) => {
        e.stopPropagation();
        if (actionStatus) return; // Prevent concurrent actions
        setActionStatus(type);
        try {
            await action();
        } finally {
            setActionStatus(null);
        }
    };

    return (
        <Card
            className={cn(
                "group relative transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-black/5 cursor-pointer h-fit rounded-[2rem] border-transparent bg-white shadow-sm ring-1 ring-black/5",
                note.isPinned && "ring-2 ring-primary/10 bg-blue-50/30"
            )}
            style={bgStyle}
            onClick={() => onEdit(note)}
        >
            <div className="absolute right-3 top-3 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-all duration-200 flex gap-1 z-10 scale-100 md:scale-95 md:group-hover:scale-100">
                {isTrash ? (
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 hover:bg-white/80 hover:shadow-sm rounded-full backdrop-blur-sm transition-all"
                        onClick={(e) => handleAction(e, 'restoring', () => onRestore?.(note))}
                        disabled={!!actionStatus}
                        title="Restore"
                    >
                        {actionStatus === 'restoring' ? (
                            <div className="h-4 w-4 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
                        ) : (
                            <RotateCcw className="h-4 w-4 text-muted-foreground hover:text-primary" />
                        )}
                    </Button>
                ) : (
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 hover:bg-white/80 hover:shadow-sm rounded-full backdrop-blur-sm transition-all"
                        onClick={(e) => handleAction(e, 'pinning', () => onPin(note))}
                        disabled={!!actionStatus}
                    >
                        {actionStatus === 'pinning' ? (
                            <div className="h-4 w-4 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
                        ) : (
                            <Pin className={cn("h-4 w-4", note.isPinned ? "fill-primary text-primary" : "text-muted-foreground")} />
                        )}
                    </Button>
                )}

                <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 hover:bg-white/80 hover:shadow-sm rounded-full backdrop-blur-sm hover:text-destructive transition-all"
                    onClick={(e) => handleAction(e, 'deleting', () => onDelete(note))}
                    disabled={!!actionStatus}
                    title={isTrash ? "Delete Forever" : "Move to Trash"}
                >
                    {actionStatus === 'deleting' ? (
                        <div className="h-4 w-4 rounded-full border-2 border-destructive/30 border-t-destructive animate-spin" />
                    ) : (
                        <Trash className="h-4 w-4" />
                    )}
                </Button>
            </div>

            <CardHeader className="p-5 pb-2">
                <CardTitle className="text-lg font-display font-bold leading-tight tracking-tight text-foreground/90">
                    {note.title}
                </CardTitle>
            </CardHeader>
            <CardContent className="p-5 pt-2">
                <p className="text-[15px] leading-relaxed text-foreground/70 whitespace-pre-wrap line-clamp-[10] font-sans">
                    {note.content}
                </p>

                <div className="flex flex-wrap items-center gap-2 mt-4">
                    {note.isReminderSent ? (
                        <div
                            className="text-[10px] font-bold text-green-700 bg-green-50 border border-green-200 px-2 py-1 rounded-sm flex items-center gap-1 cursor-pointer hover:bg-green-100 transition-colors"
                            onClick={(e) => handleAction(e, 'updating', () => onUpdate?.({ ...note, isReminderSent: false }))}
                            title="Click to mark as read"
                        >
                            {actionStatus === 'updating' ? (
                                <div className="h-3 w-3 rounded-full border-2 border-green-700/30 border-t-green-700 animate-spin" />
                            ) : (
                                <CheckCheck className="h-3 w-3" />
                            )}
                            <span>Уведомление отправлено</span>
                        </div>
                    ) : note.reminderDate && (
                        <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider bg-black/5 px-2 py-1 rounded-sm flex items-center gap-1">
                            ⏰ {format(new Date(note.reminderDate), 'MMM d, HH:mm')}
                        </div>
                    )}

                    {note.tags && note.tags.length > 0 && (
                        note.tags.map(t => (
                            <span key={t.id} className="text-[11px] font-medium bg-secondary/50 text-secondary-foreground/80 px-2.5 py-1 rounded-full border border-transparent hover:border-black/5 transition-colors">
                                #{t.name}
                            </span>
                        ))
                    )}
                </div>
            </CardContent>
        </Card>
    );
}
