// supabase/functions/send-reminders/index.ts

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from "https://esm.sh/web-push@3.6.7";

// --- КОНФИГУРАЦИЯ ---
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!;

// Web Push Config
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!;
const VAPID_SUBJECT = "mailto:admin@monokeep.com";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// --- ХЕЛПЕРЫ ---

async function sendTelegram(chatId: string, text: string) {
    try {
        const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: text,
                parse_mode: 'HTML' // Лучше HTML для жирного текста
            })
        });
        return res.ok;
    } catch (e) {
        console.error('Telegram send error:', e);
        return false;
    }
}

async function sendWebPushToUser(userId: string, payload: any) {
    // 1. Получаем все подписки юзера
    const { data: subs } = await supabase
        .from('push_subscriptions')
        .select('*')
        .eq('user_id', userId);

    if (!subs || subs.length === 0) return 0;

    let successCount = 0;

    // 2. Шлем на каждое устройство
    await Promise.all(subs.map(async (sub) => {
        try {
            await webpush.sendNotification({
                endpoint: sub.endpoint,
                keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth } // Внимательно с названиями полей в БД!
            }, JSON.stringify(payload));
            successCount++;
        } catch (err: any) {
            // Если подписка протухла (410 Gone), удаляем её
            if (err.statusCode === 410 || err.statusCode === 404) {
                await supabase.from('push_subscriptions').delete().eq('id', sub.id);
            }
        }
    }));

    return successCount;
}

// --- ОСНОВНОЙ ПРОЦЕСС ---

Deno.serve(async (req) => {
    const now = new Date().toISOString();

    // 1. Ищем заметки, которые пора отправить
    // Важно: проверяем sync_deleted, чтобы не слать удаленные
    const { data: notes, error } = await supabase
        .from('notes')
        .select(`
            id, title, content, user_id,
            profiles:user_id ( telegram_chat_id )
        `)
        .lte('reminder_date', now)
        .eq('is_reminder_sent', false)
        .eq('sync_deleted', false)
        .limit(50);

    if (error) return new Response(JSON.stringify({ error }), { status: 500 });
    if (!notes || notes.length === 0) return new Response(JSON.stringify({ message: 'No reminders' }), { status: 200 });

    const results = [];

    // 2. Обрабатываем каждую заметку
    for (const note of notes) {
        const tgChatId = note.profiles?.telegram_chat_id;
        const title = note.title || 'Untitled';
        const body = note.content || '';

        const tasks = [];

        // А) Отправка в Telegram
        if (tgChatId) {
            const tgMsg = `🔔 <b>${title}</b>\n\n${body}`;
            tasks.push(sendTelegram(tgChatId, tgMsg));
        }

        // Б) Отправка Web Push
        const pushPayload = {
            title: `🔔 ${title}`,
            body: body,
            url: `/?note=${note.id}`, // Ссылка на открытие конкретной заметки
            icon: '/icon-192x192.png'
        };
        tasks.push(sendWebPushToUser(note.user_id, pushPayload));

        // Ждем выполнения отправок
        await Promise.all(tasks);

        // 3. Помечаем как отправленное (В любом случае, чтобы не заспамить, если ошибка сети)
        // В реальном проде можно проверять, ушло ли хоть куда-то, но для MVP лучше пометить.
        await supabase
            .from('notes')
            .update({ is_reminder_sent: true })
            .eq('id', note.id);

        results.push({ id: note.id, status: 'processed' });
    }

    // 4. Триггерим Webhook на фронт? 
    // Нет, Web Push уже отправит сигнал "PUSH_FOREGROUND" если приложение открыто (через SW).
    // А Supabase Realtime обновит данные в RxDB.

    return new Response(JSON.stringify({ processed: results.length }), { headers: { 'Content-Type': 'application/json' } });
});