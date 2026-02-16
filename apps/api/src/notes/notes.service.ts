import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateNoteDto, UpdateNoteDto } from '@monokeep/shared/dist/dto/note.dto';
@Injectable()
export class NotesService {
    constructor(private prisma: PrismaService) { }

    async create(userId: number, dto: CreateNoteDto) {
        const { tags, ...rest } = dto;

        // Handle tags creation/connection
        const tagConnect = tags?.map((name) => ({
            where: { name_userId: { name, userId } },
            create: { name, userId },
        }));

        return this.prisma.note.create({
            data: {
                ...rest,
                userId,
                // If tags are provided, connect or create them
                tags: tags
                    ? {
                        connectOrCreate: tagConnect,
                    }
                    : undefined,
            },
            include: { tags: true },
        });
    }

    async findAll(userId: number, search?: string) {
        const term = search?.trim().toLowerCase();

        const notes = await this.prisma.note.findMany({
            where: {
                userId,
                isDeleted: false,
                isArchived: false, // Default to active notes
            },
            orderBy: { id: 'desc' },
            include: { tags: true },
        });

        if (!term) {
            return notes;
        }

        return notes.filter(note => {
            return (
                note.title.toLowerCase().includes(term) ||
                note.content.toLowerCase().includes(term) ||
                note.tags.some(tag => tag.name.toLowerCase().includes(term))
            );
        });
    }

    async findPinned(userId: number, skip: number, take: number) {
        return this.prisma.note.findMany({
            where: {
                userId,
                isPinned: true,
                isDeleted: false,
                isArchived: false,
            },
            skip,
            take,
            orderBy: { id: 'desc' },
            include: { tags: true },
        });
    }

    async findTrash(userId: number) {
        return this.prisma.note.findMany({
            where: {
                userId,
                isDeleted: true,
            },
            orderBy: { deletedAt: 'desc' },
            include: { tags: true },
        });
    }

    async findOne(userId: number, id: number) {
        const note = await this.prisma.note.findFirst({
            where: { id, userId },
            include: { tags: true },
        });
        if (!note) throw new NotFoundException('Note not found');
        return note;
    }

    async update(userId: number, id: number, dto: UpdateNoteDto) {
        await this.findOne(userId, id); // check ownership

        const { tags, id: _id, ...rest } = dto as any;

        return this.prisma.note.update({
            where: { id },
            data: {
                ...rest,
                tags: tags
                    ? {
                        set: [], // clear existing tags connection
                        connectOrCreate: tags.map((name: string) => ({
                            where: { name_userId: { name, userId } },
                            create: { name, userId },
                        })),
                    }
                    : undefined,
            },
            include: { tags: true },
        });
    }

    async moveToTrash(userId: number, id: number) {
        await this.findOne(userId, id);
        return this.prisma.note.update({
            where: { id },
            data: {
                isDeleted: true,
                deletedAt: new Date(),
                isPinned: false, // unpin if trashed
            },
        });
    }

    async delete(userId: number, id: number) {
        const note = await this.findOne(userId, id);
        if (!note.isDeleted) {
            throw new BadRequestException('Note must be in trash to be permanently deleted');
        }
        return this.prisma.note.delete({
            where: { id },
        });
    }

    private mapGoogleKeepColor(keepColor: string): string {
        const map: Record<string, string> = {
            "DEFAULT": "#ffffff",
            "RED": "#f28b82",
            "ORANGE": "#fbbc04",
            "YELLOW": "#fff475",
            "GREEN": "#ccff90",
            "TEAL": "#a7ffeb",
            "BLUE": "#cbf0f8",
            "DARK_BLUE": "#aecbfa",
            "PURPLE": "#d7aefb",
            "PINK": "#fdcfe8",
            "BROWN": "#e6c9a8",
            "GRAY": "#e8eaed"
        };
        return map[keepColor] || "#ffffff";
    }

    async importKeepNotes(userId: number, notes: any[]) {
        // Prepare data for bulk insert
        const formattedNotes = notes.map(note => ({
            userId,
            title: note.title || '',
            content: note.textContent || '',
            isPinned: note.isPinned || false,
            isArchived: note.isArchived || false,
            isDeleted: note.isTrashed || false,
            color: this.mapGoogleKeepColor(note.color),
            // User requested to rely on DB default dates due to Prisma error
            // createdAt: new Date(note.createdTimestampUsec / 1000),
            // updatedAt: new Date(note.userEditedTimestampUsec / 1000),
        }));

        return this.prisma.note.createMany({
            data: formattedNotes,
        });
    }

    async exportNotes(userId: number) {
        const notes = await this.prisma.note.findMany({
            where: { userId },
            include: { tags: true },
        });

        return notes.map(note => ({
            title: note.title,
            textContent: note.content,
            isPinned: note.isPinned,
            isArchived: note.isArchived,
            isTrashed: note.isDeleted,
            color: note.color,
            reminderDate: note.reminderDate || false,
            isReminderSent: note.isReminderSent || false,
            labels: note.tags.map(tag => ({ name: tag.name })),
        }));
    }
}
