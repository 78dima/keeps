import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { LoginDto, RegisterDto } from '@monokeep/shared/dist/dto/user.dto';

@Injectable()
export class AuthService {
    constructor(
        private prisma: PrismaService,
        private jwt: JwtService,
        private config: ConfigService,
    ) { }

    async register(dto: RegisterDto) {
        // Check if user exists
        const existing = await this.prisma.user.findUnique({
            where: { email: dto.email },
        });

        if (existing) {
            throw new ForbiddenException('Email already taken');
        }

        const hash = await bcrypt.hash(dto.password, 10);

        const user = await this.prisma.user.create({
            data: {
                email: dto.email,
                passwordHash: hash,
            },
        });

        return this.signToken(user.id, user.email);
    }

    async login(dto: LoginDto) {
        const user = await this.prisma.user.findUnique({
            where: { email: dto.email },
        });

        if (!user) {
            throw new ForbiddenException('Credentials incorrect');
        }

        const pwMatches = await bcrypt.compare(dto.password, user.passwordHash);
        if (!pwMatches) {
            throw new ForbiddenException('Credentials incorrect');
        }

        return this.signToken(user.id, user.email);
    }

    async signToken(userId: number, email: string): Promise<{ access_token: string }> {
        const payload = {
            sub: userId,
            email,
        };
        const secret = this.config.get('JWT_SECRET') || 'super-secret';

        const token = await this.jwt.signAsync(payload, {
            expiresIn: '7d',
            secret: secret,
        });

        return {
            access_token: token,
        };
    }
}
