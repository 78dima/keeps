'use server';

import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

// Define the shape of the imported Note (Google Keep style)
interface KeepNoteImport {
    id?: string;
    title?: string;
    textContent?: string;
    content?: string;
    color?: string;
    isPinned?: boolean;
    isArchived?: boolean;
    isTrashed?: boolean;
    isReminderSent?: boolean;
    reminderDate?: string;
    createdTimestampUsec?: number;
    userEditedTimestampUsec?: number;
    tags?: { name: string }[];
    [key: string]: unknown;
}

export async function importNotes(notesData: KeepNoteImport[]) {
    const cookieStore = await cookies();

    // Initialize Supabase Client with Cookies to respect RLS
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

    const supabase = createClient(supabaseUrl, supabaseKey, {
        auth: {
            persistSession: false,
        },
        global: {
            headers: {
                cookie: cookieStore.toString(),
            },
        },
    });

    // 1. Get Authenticated User
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
        console.error('Import failed: Unauthorized', authError);
        throw new Error('Unauthorized: Please sign in to import notes.');
    }

    const userId = user.id;

    const rows = notesData.map(n => {
        const now = new Date().toISOString();
        const created = n.createdTimestampUsec
            ? new Date(n.createdTimestampUsec / 1000).toISOString()
            : now;
        const updated = n.userEditedTimestampUsec
            ? new Date(n.userEditedTimestampUsec / 1000).toISOString()
            : now;

        // Map colors (Google Keep colors are specific)
        // You might want to map them to your app's palette
        const color = n.color || null;

        return {
            id: crypto.randomUUID(),
            title: n.title || 'Untitled',
            content: n.content || n.textContent || '', // content or textContent
            color: color,
            is_pinned: n.isPinned || false,
            is_archived: n.isArchived || false,
            is_deleted: n.isTrashed || false,
            sync_deleted: false,
            is_reminder_sent: n.isReminderSent || false,
            reminder_date: n.reminderDate || null,
            created_at: created,
            updated_at: updated,
            tags: n.labels || [],
            user_id: userId // CRITICAL: Link to the authenticated user
        };
    });

    // Batch insert (chunks of 100)
    const chunkSize = 100;
    let insertedCount = 0;

    for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);

        // Use upsert to handle potential ID collisions or re-imports if needed
        const { error } = await supabase
            .from('notes')
            .upsert(chunk, { onConflict: 'id', ignoreDuplicates: true });

        if (error) {
            console.error('Import chunk error:', error);
            throw new Error(`Failed to import notes chunk: ${error.message}`);
        }

        insertedCount += chunk.length;
    }

    return { success: true, count: insertedCount };
}
