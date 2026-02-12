// supabase/functions/telegram-webhook/index.ts

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { Bot, webhookCallback } from 'https://deno.land/x/grammy@v1.8.3/mod.ts'

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const bot = new Bot(TELEGRAM_BOT_TOKEN);
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Команда /start 123456
bot.command("start", async (ctx) => {
    const code = ctx.match;

    if (!code) {
        return ctx.reply("Привет! Чтобы привязать аккаунт MonoKeep, нажми на ссылку в настройках приложения.");
    }

    try {
        // 1. Ищем код в базе
        const { data: profiles } = await supabase
            .from('profiles')
            .select('id, email')
            .eq('linking_code', code)
            .limit(1);

        if (!profiles || profiles.length === 0) {
            return ctx.reply("Код неверный или устарел. Сгенерируйте новый в приложении.");
        }

        const user = profiles[0];

        // 2. Сохраняем Chat ID и стираем код (одноразовый)
        await supabase
            .from('profiles')
            .update({
                telegram_chat_id: ctx.chat.id.toString(),
                linking_code: null
            })
            .eq('id', user.id);

        await ctx.reply(`✅ Аккаунт ${user.email} успешно привязан! Теперь сюда будут приходить напоминания.`);
    } catch (e) {
        console.error(e);
        ctx.reply("Произошла ошибка сервера.");
    }
});

bot.on("message", (ctx) => ctx.reply("Я бот для уведомлений. Используйте приложение MonoKeep для управления заметками."));

const handleUpdate = webhookCallback(bot, 'std/http');

Deno.serve(async (req) => {
    if (req.method === 'POST') {
        const url = new URL(req.url);
        // Небольшой хак для grammy webhook
        return await handleUpdate(req);
    }
    return new Response('Telegram Bot OK');
});