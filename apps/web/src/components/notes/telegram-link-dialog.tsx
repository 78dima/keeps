'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Send, Copy } from 'lucide-react';
import api from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

export function TelegramLinkDialog() {
    const [isOpen, setIsOpen] = useState(false);
    const [code, setCode] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const { toast } = useToast();

    const generateCode = async () => {
        setLoading(true);
        try {
            const res = await api.post('/telegram/link');
            setCode(res.data.code);
        } catch {
            toast({ variant: 'destructive', title: 'Error generating code' });
        } finally {
            setLoading(false);
        }
    };

    const copyToClipboard = () => {
        if (code) {
            navigator.clipboard.writeText(`/start ${code}`);
            toast({ title: 'Copied to clipboard!' });
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                <Button variant="ghost" className="w-full justify-start gap-3 px-3">
                    <Send className="h-4 w-4" />
                    Link Telegram
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Connect Telegram</DialogTitle>
                    <DialogDescription>
                        Receive notifications for your reminders directly in Telegram.
                    </DialogDescription>
                </DialogHeader>

                {!code ? (
                    <div className="flex flex-col items-center gap-4 py-4">
                        <p className="text-sm text-center text-muted-foreground">
                            Click below to generate a unique One-Time code.
                        </p>
                        <Button onClick={generateCode} disabled={loading}>
                            {loading ? 'Generating...' : 'Generate Code'}
                        </Button>
                    </div>
                ) : (
                    <div className="flex flex-col items-center gap-4 py-4">
                        <div className="bg-muted p-4 rounded-lg text-center font-mono text-xl tracking-widest">
                            {code}
                        </div>
                        <p className="text-sm text-center">
                            1. Open our Telegram bot: <b>@keep_notification_monokeep_bot</b><br />
                            2. Send the command below:
                        </p>
                        <div className="flex items-center gap-2 w-full">
                            <code className="flex-1 bg-black/5 p-2 rounded text-sm">/start {code}</code>
                            <Button size="icon" variant="outline" onClick={copyToClipboard}>
                                <Copy className="h-4 w-4" />
                            </Button>
                        </div>
                        <Button variant="secondary" onClick={() => { setIsOpen(false); setCode(null); }}>
                            Done
                        </Button>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
