import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SyncService {
    constructor(private readonly prisma: PrismaService) { }

    async pullChanges(collection: string, lastPulledAt: number, limit: number, userId: number) {
        const timestamp = new Date(lastPulledAt);
        let documents: any[] = [];

        if (collection === 'notes') {
            const notes = await this.prisma.note.findMany({
                where: { userId, updatedAt: { gt: timestamp } },
                take: limit,
                orderBy: { updatedAt: 'asc' },
                include: { tags: true },
            });
            documents = notes.map(note => ({
                ...note,
                // RxDB/Frontend expects tags as array of objects {id, name}
                tags: note.tags.map(tag => ({ id: tag.id, name: tag.name })),
                // Ensure dates are ISO strings for RxDB
                updatedAt: note.updatedAt.toISOString(),
                createdAt: note.createdAt.toISOString(),
                reminderDate: note.reminderDate ? note.reminderDate.toISOString() : null,
                deletedAt: note.deletedAt ? note.deletedAt.toISOString() : null,
            }));
        } else if (collection === 'tags') {
            documents = await this.prisma.tag.findMany({
                where: { userId, updatedAt: { gt: timestamp } },
                take: limit,
                orderBy: { updatedAt: 'asc' },
            });
            // Ensure dates are ISO strings
            documents = documents.map(tag => ({
                ...tag,
                updatedAt: tag.updatedAt.toISOString()
            }));
        }

        if (documents.length === 0) {
            return { documents: [], checkpoint: lastPulledAt };
        }

        const lastDoc = documents[documents.length - 1];
        // Checkpoint must be number for RxDB replication protocol usually, 
        // but our implementation uses timestamp. ensuring it's a number.
        const newCheckpoint = new Date(lastDoc.updatedAt).getTime();

        return {
            documents,
            checkpoint: newCheckpoint,
        };
    }

    async pushChanges(collection: string, changeRows: any[], userId: number) {
        for (const row of changeRows) {

            // 1. Пропускаем битые данные
            if (!row.id) continue;

            // 2. Обработка удалений
            if (row.syncDeleted) {
                try {
                    if (collection === 'notes') {
                        await this.prisma.note.update({
                            where: { id: row.id },
                            data: { syncDeleted: true, isDeleted: true, updatedAt: new Date() }
                        });
                    } else if (collection === 'tags') {
                        await this.prisma.tag.update({
                            where: { id: row.id },
                            data: { syncDeleted: true, updatedAt: new Date() }
                        });
                    }
                } catch (e) { }
                continue;
            }

            // 3. Подготовка данных
            const data = { ...row };
            delete data.updatedAt;
            data.userId = userId;

            if (collection === 'notes') {
                const { id, tags, ...restFields } = data; // Отделяем tags от остальных полей

                // --- ШАГ А: Подготовка Тегов ---
                // Сначала убеждаемся, что все теги существуют в базе
                const tagIdsToLink: string[] = [];

                if (tags && Array.isArray(tags)) {
                    for (const t of tags) {
                        try {
                            // Мы доверяем ID с клиента (UUID). 
                            // Делаем upsert самого тега, чтобы он точно был в базе.
                            await this.prisma.tag.upsert({
                                where: { id: t.id },
                                create: {
                                    id: t.id,
                                    name: t.name,
                                    userId: userId,
                                    syncDeleted: false
                                },
                                update: {
                                    name: t.name, // Если переименовали
                                    syncDeleted: false // Если восстановили
                                }
                            });
                            tagIdsToLink.push(t.id);
                        } catch (e) {
                            console.error(`Failed to upsert tag ${t.name}`, e);
                        }
                    }
                }

                // --- ШАГ Б: Upsert Заметки ---

                // Подготовка полей (дат)
                const notePayload = {
                    ...restFields,
                    deletedAt: restFields.deletedAt ? new Date(restFields.deletedAt) : null,
                    reminderDate: restFields.reminderDate ? new Date(restFields.reminderDate) : null,
                    userId // Гарантируем ID
                };

                try {
                    await this.prisma.note.upsert({
                        where: { id },
                        // ДЛЯ НОВОЙ ЗАМЕТКИ (CREATE)
                        create: {
                            id,
                            ...notePayload,
                            createdAt: new Date(),
                            // В create НЕЛЬЗЯ юзать set. Только connect.
                            tags: {
                                connect: tagIdsToLink.map(tid => ({ id: tid }))
                            }
                        },
                        // ДЛЯ СУЩЕСТВУЮЩЕЙ (UPDATE)
                        update: {
                            ...notePayload,
                            updatedAt: new Date(),
                            // В update НУЖНО юзать set, чтобы перезаписать список (старые отвяжутся, новые привяжутся)
                            tags: {
                                set: tagIdsToLink.map(tid => ({ id: tid }))
                            }
                        },
                    });
                } catch (e) {
                    console.error('Sync Error Note Upsert:', e);
                }

            } else if (collection === 'tags') {
                // Логика для коллекции тегов
                const { id, name, syncDeleted } = data;
                try {
                    await this.prisma.tag.upsert({
                        where: { id },
                        create: { id, name, userId, syncDeleted: false },
                        update: { name, updatedAt: new Date(), syncDeleted: false },
                    });
                } catch (e) { }
            }
        }
        return [];
    }
}
