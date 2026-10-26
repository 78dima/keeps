/** Identical ordering on PostgreSQL, web and Android: edit time, then edit UUID. */
export const ZERO_EDIT = '00000000-0000-0000-0000-000000000000';
export type Versioned = { updatedAt: string; editId?: string; isReminderSent?: boolean };
export function compareEdits(a: Versioned, b: Versioned): number {
    const difference = Date.parse(a.updatedAt) - Date.parse(b.updatedAt);
    if (difference) return difference;
    const x = a.editId || ZERO_EDIT, y = b.editId || ZERO_EDIT;
    return x === y ? 0 : x > y ? 1 : -1;
}
export function resolveEdit<T extends Versioned>(local: T, remote: T): T {
    // Equal edit versions use server delivery metadata; delivery is not a user edit.
    return compareEdits(local, remote) > 0 ? local : remote;
}
let offset = 0;
let last = 0;
if (typeof localStorage !== 'undefined') {
    try { offset = Number(localStorage.getItem('monokeep-clock-offset')) || 0; } catch { /* private mode */ }
}
export function calibrateClock(serverTime: string, startedAt: number, finishedAt = Date.now()) {
    if (finishedAt - startedAt > 10000) return;
    const sample = Date.parse(serverTime) - (startedAt + finishedAt) / 2;
    if (!Number.isFinite(sample)) return;
    offset = sample;
    if (last > Date.parse(serverTime) + 300000) last = 0;
    try { localStorage.setItem('monokeep-clock-offset', String(offset)); } catch { /* private mode */ }
}
export function newEdit(previous?: string) {
    const previousTime = previous ? Date.parse(previous) : 0;
    const wall = Math.round(Date.now() + offset);
    const now = Math.max(wall, last + 1, previousTime <= wall + 300000 ? previousTime + 1 : 0);
    last = now;
    return { updatedAt: new Date(now).toISOString(), editId: crypto.randomUUID() };
}

type ReminderState = Versioned & { sortAt?: string; isPinned?: boolean; reminderDate?: string | null; reminderEnabled?: boolean; reminderVersion?: string };
export function noteEditMetadata(existing: ReminderState, patch: Partial<ReminderState>) {
    const edit = newEdit(existing.updatedAt);
    const dateChanged = patch.reminderDate !== undefined && patch.reminderDate !== (existing.reminderDate || null);
    const intentChanged = dateChanged || patch.reminderEnabled !== undefined;
    const enabled = patch.reminderEnabled ?? (dateChanged ? true : existing.reminderEnabled ?? true);
    return { ...edit,
        sortAt: patch.isPinned !== undefined && patch.isPinned !== existing.isPinned ? edit.updatedAt : existing.sortAt || existing.updatedAt,
        reminderEnabled: enabled,
        reminderVersion: intentChanged ? edit.editId : existing.reminderVersion || ZERO_EDIT,
        isReminderSent: intentChanged ? !enabled : existing.isReminderSent || false,
    };
}


export function sameLegacyNote(a: object, b: object) {
    const fields = ['title','content','color','isPinned','isArchived','isDeleted','syncDeleted','reminderDate','reminderEnabled','reminderVersion','createdAt','tags'];
    return fields.every(key => JSON.stringify((a as Record<string, unknown>)[key] ?? null) === JSON.stringify((b as Record<string, unknown>)[key] ?? null));
}
