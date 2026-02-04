import { z } from 'zod';

// Register DTO
export const RegisterDtoSchema = z.object({
    email: z.string().email('Invalid email format'),
    password: z.string().min(6, 'Password must be at least 6 characters'),
});

export type RegisterDto = z.infer<typeof RegisterDtoSchema>;

// Login DTO
export const LoginDtoSchema = z.object({
    email: z.string().email('Invalid email format'),
    password: z.string().min(1, 'Password is required'),
});

export type LoginDto = z.infer<typeof LoginDtoSchema>;
