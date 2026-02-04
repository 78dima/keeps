'use client';

import { Sidebar, MobileSidebar } from '@/components/notes/sidebar';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { LogOut, Menu } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Search } from 'lucide-react';

import { useDebounce } from '@/hooks/use-debounce';

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const router = useRouter();
    const [isAuthChecking, setIsAuthChecking] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
    const debouncedSearchQuery = useDebounce(searchQuery, 300);

    useEffect(() => {
        // Basic Client-Side Auth Check
        const token = localStorage.getItem('token');
        if (!token) {
            router.push('/login');
        } else {
            setIsAuthChecking(false);
        }
    }, [router]);

    // Initial search query sync
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const search = params.get('search');
        if (search) {
            setSearchQuery(search);
        }
    }, []);

    // Sync debounced query to URL
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const currentSearch = params.get('search') || '';
        if (debouncedSearchQuery !== currentSearch) {
            if (debouncedSearchQuery) {
                params.set('search', debouncedSearchQuery);
            } else {
                params.delete('search');
            }
            router.replace(`/?${params.toString()}`);
        }
    }, [debouncedSearchQuery, router]);


    const handleLogout = () => {
        localStorage.removeItem('token');
        router.push('/login');
    };

    const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSearchQuery(e.target.value);
    };

    if (isAuthChecking) {
        return <div className="flex h-screen items-center justify-center">Loading...</div>;
    }

    return (
        <div className="min-h-screen w-full bg-background">
            <Sidebar />
            <MobileSidebar isOpen={mobileSidebarOpen} onClose={() => setMobileSidebarOpen(false)} />

            <div className="flex flex-col md:ml-64 transition-all duration-300">
                <header className="sticky top-0 z-40 flex h-16 items-center gap-3 px-4 lg:px-6 justify-between glass-panel border-b-0 mb-4 bg-white/50 backdrop-blur-md">
                    <div className='flex items-center gap-3 w-full max-w-[600px]'>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="md:hidden -ml-2 text-muted-foreground hover:text-foreground"
                            onClick={() => setMobileSidebarOpen(true)}
                        >
                            <Menu className="h-5 w-5" />
                        </Button>
                        <div className="relative w-full max-w-[400px] group">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                            <Input
                                type="search"
                                value={searchQuery}
                                placeholder="Search notes..."
                                className="w-full appearance-none bg-black/5 border-transparent pl-10 h-10 rounded-full shadow-none md:w-2/3 lg:w-full focus-visible:ring-1 focus-visible:ring-primary focus-visible:bg-white transition-all placeholder:text-muted-foreground/60 font-medium"
                                onChange={handleSearch}
                            />
                        </div>
                    </div>
                    <Button variant="ghost" size="icon" onClick={handleLogout} title="Logout" className="rounded-full hover:bg-black/5 text-muted-foreground hover:text-destructive transition-colors">
                        <LogOut className="h-5 w-5" />
                    </Button>
                </header>
                <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-8 lg:p-8 max-w-7xl mx-auto w-full">
                    {children}
                </main>
            </div>
        </div>
    );
}
