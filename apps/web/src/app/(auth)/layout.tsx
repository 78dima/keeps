export default function AuthLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <div className="auth-bg flex min-h-screen w-full items-center justify-center p-4">
            <div className="relative z-10 w-full max-w-[420px]">
                {/* Decorative glow behind the card */}
                <div className="absolute -top-20 left-1/2 h-40 w-40 -translate-x-1/2 rounded-full bg-violet-600/20 blur-[60px]" />
                <div className="absolute -bottom-20 left-1/2 h-40 w-40 -translate-x-1/2 rounded-full bg-blue-600/20 blur-[60px]" />

                {children}
            </div>
        </div>
    );
}
