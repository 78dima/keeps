'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { RegisterDtoSchema, RegisterDto } from '@monokeep/shared/dist/dto/user.dto';
import api from '@/lib/api';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import Link from 'next/link';
import { useToast } from '@/hooks/use-toast';
import { isAxiosError } from 'axios';

export default function RegisterPage() {
    const router = useRouter();
    const { toast } = useToast();

    const form = useForm<RegisterDto>({
        resolver: zodResolver(RegisterDtoSchema),
        defaultValues: {
            email: '',
            password: '',
        },
    });

    async function onSubmit(data: RegisterDto) {
        try {
            const res = await api.post('/auth/register', data);
            localStorage.setItem('token', res.data.access_token);
            toast({ title: 'Welcome!', description: 'Account created successfully.' });
            router.push('/');
        } catch (error: unknown) {
            let errorMessage = 'Registration failed';
            if (isAxiosError(error)) {
                errorMessage = error.response?.data?.message || errorMessage;
            }
            toast({
                variant: 'destructive',
                title: 'Error',
                description: errorMessage,
            });
        }
    }

    return (
        <div className="auth-glass-card rounded-2xl p-8 backdrop-blur-xl">
            <div className="mb-8 text-center">
                <h1 className="bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-3xl font-bold text-transparent">
                    Create Account
                </h1>
                <p className="mt-2 text-sm text-zinc-400">Join the cosmic productivity flow</p>
            </div>

            <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
                    <FormField
                        control={form.control}
                        name="email"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel className="text-zinc-300">Email</FormLabel>
                                <FormControl>
                                    <Input
                                        placeholder="you@example.com"
                                        {...field}
                                        className="input-glow border-white/10 bg-white/5 text-white placeholder:text-zinc-600 focus-visible:ring-0 focus-visible:ring-offset-0"
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="password"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel className="text-zinc-300">Password</FormLabel>
                                <FormControl>
                                    <Input
                                        type="password"
                                        placeholder="******"
                                        {...field}
                                        className="input-glow border-white/10 bg-white/5 text-white placeholder:text-zinc-600 focus-visible:ring-0 focus-visible:ring-offset-0"
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <Button
                        type="submit"
                        className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-lg shadow-violet-500/25 transition-all hover:scale-[1.02] hover:from-violet-500 hover:to-indigo-500 hover:shadow-violet-500/40"
                    >
                        Register
                    </Button>
                </form>
            </Form>

            <div className="mt-6 text-center text-sm text-zinc-500">
                Already have an account?{' '}
                <Link href="/login" className="font-medium text-violet-400 transition-colors hover:text-violet-300 hover:underline">
                    Login
                </Link>
            </div>
        </div>
    );
}
