import release from '@/lib/android-release.json';

// A stable URL must resolve the latest release each time, including after updates.
export const dynamic = 'force-dynamic';

export function GET() {
    return new Response(null, {
        status: 307,
        headers: {
            Location: `/downloads/${release.fileName}`,
            'Cache-Control': 'no-store',
        },
    });
}
