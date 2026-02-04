'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Lightbulb, Trash2, Pin } from 'lucide-react';
import { TelegramLinkDialog } from './telegram-link-dialog';
import { usePinnedNotes } from '@/hooks/use-pinned-notes';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { useNotesStore } from '@/store/useNotesStore';
import { ImportNotesDialog } from './import-notes-dialog';

const links = [
    { name: 'Notes', href: '/', icon: Lightbulb },
    { name: 'Trash', href: '/trash', icon: Trash2 },
];

export function Sidebar() {
    const pathname = usePathname();

    return (
        <div className="flex h-screen flex-col border-r-0 glass-panel w-64 hidden md:flex fixed top-0 left-0 z-50">
            <div className="flex h-14 items-center px-4 lg:h-[60px] lg:px-6">
                <Link href="/" className="flex items-center gap-2 font-display text-xl font-bold tracking-tight text-foreground/90">
                    <span className="">MonoKeep</span>
                    <span className="text-xs font-sans font-medium text-muted-foreground bg-black/5 px-1.5 py-0.5 rounded-full">Pro</span>
                </Link>
            </div>
            <div className="flex-1 overflow-auto">
                <nav className="grid items-start px-3 text-sm font-medium mt-6 space-y-1">
                    {links.map((link) => {
                        const Icon = link.icon;
                        const isActive = pathname === link.href;
                        return (
                            <Link
                                key={link.href}
                                href={link.href}
                                className={cn(
                                    'flex items-center gap-3 rounded-full px-4 py-3 transition-all duration-200 group',
                                    isActive
                                        ? 'bg-black/5 text-foreground font-semibold shadow-sm ring-1 ring-black/5'
                                        : 'text-muted-foreground hover:bg-black/5 hover:text-foreground'
                                )}
                            >
                                <Icon className={cn("h-5 w-5 transition-colors", isActive ? "text-foreground" : "text-muted-foreground group-hover:text-foreground")} />
                                {link.name}
                            </Link>
                        );
                    })}
                </nav>
                <div className="px-5 py-4">
                    <PinnedNotesList />
                </div>
            </div>
            <div className="p-4 border-t border-black/5 space-y-2 bg-white/50">
                <ImportNotesDialog />
                <TelegramLinkDialog />
            </div>
        </div>
    );
}


function PinnedNotesList() {
    const { notes, fetchNotes, hasMore, isLoading } = usePinnedNotes();
    const { openEditModal } = useNotesStore();

    useEffect(() => {
        fetchNotes(true);
    }, [fetchNotes]);

    if (notes.length === 0) return null;

    return (
        <div className="mt-6">
            <h3 className="mb-2 px-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Pinned
            </h3>
            <div className="space-y-1">
                {notes.map((note) => (
                    <div
                        key={note.id}
                        className="group flex items-center justify-between rounded-lg px-2 py-1.5 text-sm font-medium hover:bg-muted/50 cursor-pointer"
                        onClick={() => openEditModal(note)}
                    >
                        <div className="flex items-center gap-2 overflow-hidden">
                            <Pin className="h-3 w-3 shrink-0 text-muted-foreground" />
                            <span className="truncate text-foreground/80">{note.title || 'Untitled'}</span>
                        </div>
                    </div>
                ))}

                {hasMore && (
                    <Button
                        variant="ghost"
                        size="sm"
                        className="w-full text-xs h-8 mt-2"
                        onClick={() => fetchNotes()}
                        disabled={isLoading}
                    >
                        {isLoading ? 'Loading...' : 'Load More'}
                    </Button>
                )}
            </div>
        </div>
    );
}
