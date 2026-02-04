import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Telegraf } from 'telegraf';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TelegramService implements OnModuleInit {
    private bot: Telegraf;

    constructor(
        private config: ConfigService,
        private prisma: PrismaService,
    ) {
        const token = this.config.get<string>('TELEGRAM_BOT_TOKEN');
        if (token) {
            this.bot = new Telegraf(token);
        }
    }

    async onModuleInit() {
        if (this.bot) {
            this.bot.start((ctx) => {
                const uniqueCode = ctx.message.text.split(' ')[1];
                if (uniqueCode) {
                    return this.handleLinking(ctx.from.id.toString(), uniqueCode, ctx);
                }
                return ctx.reply('Welcome! Send /start <code_from_profile> to link your account.');
            });

            this.bot.launch().catch((err) => console.error('Bot launch failed', err));
        }
    }

    async generateLinkingCode(userId: number) {
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        await this.prisma.user.update({
            where: { id: userId },
            data: { linkingCode: code },
        });
        return code;
    }

    async handleLinking(chatId: string, uniqueCode: string, ctx: any) {
        const user = await this.prisma.user.findFirst({
            where: { linkingCode: uniqueCode },
        });

        if (!user) {
            return ctx.reply('Invalid or expired code. Please generate a new one.');
        }

        await this.prisma.user.update({
            where: { id: user.id },
            data: {
                telegramChatId: chatId,
                linkingCode: null, // Clear code after usage
            },
        });

        return ctx.reply('Account successfully linked! You will now receive notifications here.');
    }

    async sendNotification(userId: number, message: string) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (user?.telegramChatId && this.bot) {
            try {
                await this.bot.telegram.sendMessage(user.telegramChatId, message, { parse_mode: 'HTML' });
            } catch (e) {
                console.error(`Failed to send telegram message to user ${userId}`, e);
            }
        }
    }
}
