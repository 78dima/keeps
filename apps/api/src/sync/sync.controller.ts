import { Body, Controller, Get, Post, Query, UseGuards, Request } from '@nestjs/common';
import { SyncService } from './sync.service';
import { AuthGuard } from '@nestjs/passport';

@Controller('sync')
@UseGuards(AuthGuard('jwt'))
export class SyncController {
    constructor(private readonly syncService: SyncService) { }

    @Get('pull')
    async pull(
        @Query('collection') collection: string,
        @Query('checkpoint') checkpoint: number,
        @Query('limit') limit: number,
        @Request() req: any,
    ) {
        if (!collection) return { documents: [], checkpoint: checkpoint || 0 };
        return this.syncService.pullChanges(
            collection,
            checkpoint ? parseInt(checkpoint as any) : 0,
            limit ? parseInt(limit as any) : 100,
            req.user.id,
        );
    }

    @Post('push')
    async push(
        @Query('collection') collection: string,
        @Body() changeRows: any[],
        @Request() req: any
    ) {
        if (!collection) return [];
        return this.syncService.pushChanges(collection, changeRows, req.user.id);
    }
}
