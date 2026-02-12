'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Send, Copy, Loader2, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';

export function TelegramLinkDialog() {
    const [isOpen, setIsOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [linkingCode, setLinkingCode] = useState<string | null>(null);
    const [isConnected, setIsConnected] = useState(false);

    const { toast } = useToast();
    const botUsername = 'keep_notification_monokeep_bot';

    useEffect(() => {
        if (isOpen) {
            fetchConnectionStatus();
        }
    }, [isOpen]);

    const fetchConnectionStatus = async () => {
        setLoading(true);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            // 1. Проверяем, подключен ли уже бот
            const { data: profile } = await supabase
                .from('profiles')
                .select('telegram_chat_id')
                .eq('id', user.id)
                .single();

            if (profile?.telegram_chat_id) {
                setIsConnected(true);
                setLoading(false);
                return;
            }

            // 2. Если не подключен, генерируем новый код
            const code = Math.floor(100000 + Math.random() * 900000).toString(); // 6 цифр

            // 3. Записываем код в базу
            const { error } = await supabase
                .from('profiles')
                .update({ linking_code: code })
                .eq('id', user.id);

            if (error) throw error;

            setLinkingCode(code);
            setIsConnected(false);

        } catch (error) {
            console.error(error);
            toast({ variant: "destructive", title: "Ошибка соединения с сервером" });
        } finally {
            setLoading(false);
        }
    };

    const copyToClipboard = () => {
        if (linkingCode) {
            navigator.clipboard.writeText(`/start ${linkingCode}`);
            toast({ title: 'Код скопирован!' });
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                <Button variant="ghost" className="w-full justify-start gap-3 px-3">
                    <Send className="h-4 w-4" />
                    Подключить Telegram
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Настройка уведомлений</DialogTitle>
                    <DialogDescription>
                        Получайте напоминания о заметках прямо в Telegram.
                    </DialogDescription>
                </DialogHeader>

                {loading ? (
                    <div className="flex flex-col items-center justify-center py-8 gap-2">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        <p className="text-sm text-muted-foreground">Генерация кода...</p>
                    </div>
                ) : isConnected ? (
                    <div className="flex flex-col items-center justify-center py-6 gap-4 bg-green-50 rounded-lg border border-green-100 dark:bg-green-900/20 dark:border-green-900">
                        <CheckCircle2 className="h-12 w-12 text-green-600 dark:text-green-400" />
                        <div className="text-center">
                            <h3 className="font-medium text-green-900 dark:text-green-300">Успешно подключено!</h3>
                            <p className="text-sm text-green-700 dark:text-green-400 mt-1">
                                Бот отправляет уведомления в этот чат.
                            </p>
                        </div>
                        <Button variant="outline" size="sm" onClick={() => setIsOpen(false)}>
                            Закрыть
                        </Button>
                    </div>
                ) : (
                    <div className="flex flex-col gap-6 py-4">
                        <div className="space-y-2 text-center">
                            <p className="text-sm text-muted-foreground">
                                Нажмите кнопку ниже, чтобы открыть бота и автоматически привязать аккаунт:
                            </p>
                        </div>

                        {linkingCode && (
                            <>
                                <Button asChild size="lg" className="w-full gap-2 bg-[#24A1DE] hover:bg-[#24A1DE]/90 text-white">
                                    <a
                                        href={`https://t.me/${botUsername}?start=${linkingCode}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                    >
                                        <Send className="h-4 w-4" />
                                        Запустить Telegram Бота
                                    </a>
                                </Button>

                                <div className="relative">
                                    <div className="absolute inset-0 flex items-center">
                                        <span className="w-full border-t" />
                                    </div>
                                    <div className="relative flex justify-center text-xs uppercase">
                                        <span className="bg-background px-2 text-muted-foreground">
                                            или вручную
                                        </span>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <p className="text-xs text-center text-muted-foreground">
                                        Отправьте этот код боту <b>@{botUsername}</b>
                                    </p>
                                    <div className="flex items-center gap-2">
                                        <div className="flex-1 bg-muted p-3 rounded-md font-mono text-center text-lg tracking-widest border">
                                            {linkingCode}
                                        </div>
                                        <Button size="icon" variant="outline" className="h-12 w-12 shrink-0" onClick={copyToClipboard}>
                                            <Copy className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}