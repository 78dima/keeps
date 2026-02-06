import { Controller, Post, Body, UseGuards, Request } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PrismaService } from '../prisma/prisma.service';

@UseGuards(AuthGuard('jwt'))
@Controller('notifications')
export class NotificationsController {
    constructor(private prisma: PrismaService) { }

    @Post('subscribe')
    async subscribe(@Request() req: any, @Body() body: { subscription: any }) {
        const subscription = JSON.stringify(body.subscription);
        await this.prisma.user.update({
            where: { id: req.user.id },
            data: { pushSubscription: subscription },
        });
        return { success: true };
    }
}
