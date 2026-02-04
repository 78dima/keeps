import { Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { TelegramController } from './telegram.controller';
import { NotificationService } from './notification.service';

@Module({
    controllers: [TelegramController],
    providers: [TelegramService, NotificationService],
    exports: [TelegramService],
})
export class TelegramModule { }
