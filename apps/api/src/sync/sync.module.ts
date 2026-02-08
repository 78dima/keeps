import { Module } from '@nestjs/common';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';
import { PrismaService } from '../prisma/prisma.service';

@Module({
    controllers: [SyncController],
    providers: [SyncService, PrismaService],
})
export class SyncModule { }
