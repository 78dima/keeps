import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService } from './telegram.service';
import { WebPushService } from '../notifications/web-push.service';
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
        private webPush: WebPushService,
    ) { }

    @Cron('* * * * *')
    async handleNotifications() {
        const now = new Date();
        const notes = await this.prisma.note.findMany({
            where: {
                reminderDate: { lte: now },
                isReminderSent: false,
                isDeleted: false,
                user: {
                    OR: [
                        { telegramChatId: { not: null } },
                        { pushSubscription: { not: null } }
                    ]
                }
            },
            include: { user: true }
        });

        if (notes.length > 0) {
            this.logger.log(`Found ${notes.length} pending notifications.`);
        }

        for (const note of notes) {
            let sent = false;
            try {
                const message = `🔔 <b>Напоминание:</b> ${note.title}\n\n${note.content.substring(0, 200)}`;
                const plainMessage = `🔔 Напоминание: ${note.title}\n\n${note.content.substring(0, 200)}`;

                if (note.user.telegramChatId) {
                    await this.telegram.sendNotification(note.userId, message);
                    sent = true;
                }

                if (note.user.pushSubscription) {
                    try {
                        const sub = JSON.parse(note.user.pushSubscription);
                        await this.webPush.sendNotification(sub, {
                            title: `Напоминание: ${note.title}`,
                            body: note.content.substring(0, 200),
                            url: `/note/${note.id}` // actionable url
                        });
                        sent = true;
                    } catch (e) {
                        this.logger.error(`Failed to send web push for note ${note.id}`, e);
                        // If push fails (e.g. expired), we might want to remove subscription, but for now just log
                    }
                }

                if (sent) {
                    await this.prisma.note.update({
                        where: { id: note.id },
                        data: { isReminderSent: true }
                    });
                    this.logger.log(`Notification sent for note ${note.id}`);
                }
            } catch (e) {
                this.logger.error(`Failed to process notification for note ${note.id}`, e);
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
