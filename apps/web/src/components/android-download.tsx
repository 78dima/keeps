import { Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import release from '@/lib/android-release.json';

export function AndroidDownload({ dark = false }: { dark?: boolean }) {
    return (
        <a
            href={`/downloads/${release.fileName}`}
            download={release.fileName}
            className={cn(
                'flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400',
                dark
                    ? 'border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10'
                    : 'border-black/5 bg-black/[0.03] text-foreground hover:bg-black/[0.06]'
            )}
        >
            <Download className="h-5 w-5 shrink-0" aria-hidden="true" />
            <span className="min-w-0">
                <span className="block text-sm font-medium">Скачать для Android</span>
                <span className={cn('mt-0.5 block text-xs', dark ? 'text-zinc-400' : 'text-muted-foreground')}>
                    APK · {release.version} · {(release.sizeBytes / 1_000_000).toFixed(1)} МБ
                </span>
            </span>
        </a>
    );
}
