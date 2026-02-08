import { z } from 'zod';

// Create Note DTO
export const CreateNoteSchema = z.object({
    title: z.string().min(1, 'Title is required'),
    content: z.string(),
    color: z.string().optional(),
    isPinned: z.boolean().optional().default(false),
    isArchived: z.boolean().optional().default(false),
    reminderDate: z.coerce.date().optional(),
    tags: z.array(z.string()).optional(),
});

export type CreateNoteDto = z.infer<typeof CreateNoteSchema>;

// Update Note DTO
export const UpdateNoteSchema = z.object({
    id: z.string().optional(),
    title: z.string().min(1).optional(),
    content: z.string().optional(),
    color: z.string().nullable().optional(),
    isPinned: z.boolean().optional(),
    isArchived: z.boolean().optional(),
    isDeleted: z.boolean().optional(),
    deleted: z.boolean().optional(), // Sync delete
    reminderDate: z.coerce.date().nullable().optional(),
    isReminderSent: z.boolean().optional(),
    updatedAt: z.coerce.date().optional(),
    tags: z.array(z.string()).optional(),
});

export type UpdateNoteDto = z.infer<typeof UpdateNoteSchema>;

// Note Response DTO (for API responses)
export const NoteResponseSchema = z.object({
    id: z.string(),
    title: z.string(),
    content: z.string(),
    color: z.string().nullable(),
    isPinned: z.boolean(),
    isArchived: z.boolean(),
    isDeleted: z.boolean(),
    deleted: z.boolean().optional(),
    deletedAt: z.date().nullable(),
    reminderDate: z.date().nullable(),
    isReminderSent: z.boolean(), // Add this new field
    userId: z.number(),
    updatedAt: z.date(),
    createdAt: z.date(),
    tags: z.array(z.object({
        id: z.string(),
        name: z.string(),
    })),
});

export type NoteResponseDto = z.infer<typeof NoteResponseSchema>;

export interface GoogleKeepNote {
    color: string;
    isTrashed: boolean;
    isPinned: boolean;
    isArchived: boolean;
    textContent?: string;
    title: string;
    userEditedTimestampUsec: number;
    createdTimestampUsec: number;
    tags?: Array<{ name: string }>; // Keep structure might have labels/tags differently, but usually it's not in the main object in simple exports, or handled separately. The user provided example shows "tasks", let's be flexible or stick to the prompt. The prompt example showed simple fields. I'll add what was shown + standard ones.
}

export const ImportKeepNotesSchema = z.array(z.object({
    color: z.string(),
    isTrashed: z.boolean(),
    isPinned: z.boolean(),
    isArchived: z.boolean(),
    textContent: z.string().optional(),
    title: z.string(),
    userEditedTimestampUsec: z.number(),
    createdTimestampUsec: z.number(),
    // We can add optional mapping for compatibility if needed
}).passthrough()); // passthrough to allow other fields without validation error

export type ImportKeepNotesDto = z.infer<typeof ImportKeepNotesSchema>;
