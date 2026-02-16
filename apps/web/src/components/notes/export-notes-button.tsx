'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Download, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import api from '@/lib/api';

export function ExportNotesButton() {
    const [isLoading, setIsLoading] = useState(false);
    const { toast } = useToast();

    const handleExport = async () => {
        setIsLoading(true);
        try {
            const res = await api.get('/notes/export');
            const data = res.data;

            const blob = new Blob([JSON.stringify(data, null, 2)], {
                type: 'application/json',
            });

            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `monokeep-export-${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            toast({
                title: 'Export success',
                description: `Exported ${data.length} notes.`,
            });
        } catch (error) {
            console.error(error);
            toast({ variant: 'destructive', title: 'Export failed' });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Button
            variant="ghost"
            className="w-full justify-start text-sm font-medium text-muted-foreground hover:bg-muted/50"
            onClick={handleExport}
            disabled={isLoading}
        >
            {isLoading ? (
                <Loader2 className="mr-3 h-4 w-4 animate-spin" />
            ) : (
                <Download className="mr-3 h-4 w-4" />
            )}
            Export Notes
        </Button>
    );
}
