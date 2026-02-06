import { Module } from '@nestjs/common';
import { WebPushService } from './web-push.service';
import { NotificationsController } from './notifications.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
    imports: [PrismaModule],
    controllers: [NotificationsController],
    providers: [WebPushService],
    exports: [WebPushService],
})
export class NotificationsModule { }
