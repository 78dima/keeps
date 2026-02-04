import { Body, Controller, Post, Request, UseGuards } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { AuthGuard } from '@nestjs/passport';

@Controller('telegram')
export class TelegramController {
    constructor(private readonly telegramService: TelegramService) { }

    @UseGuards(AuthGuard('jwt'))
    @Post('link')
    async linkAccount(@Request() req: any) {
        const code = await this.telegramService.generateLinkingCode(req.user.id);
        return { code };
    }
}
