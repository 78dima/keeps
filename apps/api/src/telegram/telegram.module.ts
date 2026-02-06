import { Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { TelegramController } from './telegram.controller';
import { NotificationService } from './notification.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
    imports: [NotificationsModule],
    controllers: [TelegramController],
    providers: [TelegramService, NotificationService],
    exports: [TelegramService],
})
export class TelegramModule { }
