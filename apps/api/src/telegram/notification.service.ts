import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService } from './telegram.service';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

@Injectable()
export class NotificationService {
    private readonly logger = new Logger(NotificationService.name);

    constructor(
        private prisma: PrismaService,
        private telegram: TelegramService,
    ) { }

    @Cron('* * * * *')
    async handleNotifications() {
        const now = new Date(); // DB stores absolute time, simple comparison works
        console.log(now);
        // Find notes that are due, haven't been sent, and belong to users with Telegram setup
        const notes = await this.prisma.note.findMany({
            where: {
                reminderDate: {
                    lte: now,
                },
                isReminderSent: false,
                isDeleted: false, // Ensure we don't notify for trashed notes
                user: {
                    telegramChatId: {
                        not: null
                    }
                }
            },
            include: {
                user: true
            }
        });

        console.log(notes);

        if (notes.length > 0) {
            this.logger.log(`Found ${notes.length} pending notifications.`);
        }

        for (const note of notes) {
            try {
                if (note.user.telegramChatId) {
                    await this.telegram.sendNotification(
                        note.userId,
                        `🔔 <b>Напоминание:</b> ${note.title}\n\n${note.content.substring(0, 200)}`
                    );

                    // Mark as sent to prevent loops
                    await this.prisma.note.update({
                        where: { id: note.id },
                        data: { isReminderSent: true }
                    });
                    this.logger.log(`Notification sent for note ${note.id}`);
                }
            } catch (e) {
                this.logger.error(`Failed to process notification for note ${note.id}`, e);
                // We do NOT stop the loop, just log error
            }
        }
    }

    @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
    async handleTrashCleanup() {
        this.logger.log('Running trash cleanup...');
        const sevenDaysAgo = dayjs().subtract(7, 'day').toDate();

        const result = await this.prisma.note.deleteMany({
            where: {
                isDeleted: true,
                deletedAt: {
                    lt: sevenDaysAgo,
                },
            },
        });

        this.logger.log(`Cleaned up ${result.count} trashed notes.`);
    }
}
