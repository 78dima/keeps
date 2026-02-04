import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Patch,
    Post,
    Query,
    UseGuards,
    Request,
    ParseIntPipe,
} from '@nestjs/common';
import { NotesService } from './notes.service';
import { AuthGuard } from '@nestjs/passport';
import * as noteDto from '@monokeep/shared/dist/dto/note.dto';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';

@UseGuards(AuthGuard('jwt'))
@Controller('notes')
export class NotesController {
    constructor(private readonly notesService: NotesService) { }

    @Post()
    create(@Request() req: any, @Body(new ZodValidationPipe(noteDto.CreateNoteSchema)) dto: noteDto.CreateNoteDto) {
        return this.notesService.create(req.user.id, dto);
    }

    @Post('import/keep')
    importKeep(@Request() req: any, @Body() notes: any[]) {
        // Can add Zod validation for array if needed, but 'any[]' allows flexibility for now
        // or use ImportKeepNotesSchema
        return this.notesService.importKeepNotes(req.user.id, notes);
    }

    @Get()
    findAll(@Request() req: any, @Query('search') search?: string) {
        return this.notesService.findAll(req.user.id, search);
    }

    @Get('pinned')
    findPinned(
        @Request() req: any,
        @Query('skip', ParseIntPipe) skip: number,
        @Query('take', ParseIntPipe) take: number,
    ) {
        return this.notesService.findPinned(req.user.id, skip, take);
    }

    @Get('trash')
    findTrash(@Request() req: any) {
        return this.notesService.findTrash(req.user.id);
    }

    @Get(':id')
    findOne(@Request() req: any, @Param('id', ParseIntPipe) id: number) {
        return this.notesService.findOne(req.user.id, id);
    }

    @Patch(':id')
    update(
        @Request() req: any,
        @Param('id', ParseIntPipe) id: number,
        @Body(new ZodValidationPipe(noteDto.UpdateNoteSchema)) dto: noteDto.UpdateNoteDto,
    ) {
        return this.notesService.update(req.user.id, id, dto);
    }

    @Delete(':id')
    remove(@Request() req: any, @Param('id', ParseIntPipe) id: number) {
        // If it's already in trash, this might mean permanent delete
        // But per requirements, "complete delete only from trash"
        // For now we assume this endpoint can handle both or separate "soft delete" logic
        // Implementation: moveToTrash first? The requirement says DELETE /notes/:id is complete delete.
        // PATCH /notes/:id updates fields. So if someone wants to move to trash, they PATCH isDeleted=true?
        // Let's assume standard REST: DELETE is usually destructive.
        // Requirement says: "DELETE /notes/:id — complete delete (only from trash)"
        // While "PATCH /notes/:id — editing (including move to trash/pin)"

        // So if I call DELETE on a note that is NOT in trash yet, what happens? 
        // Requirement is strict: "only from trash".
        // I should check if it's in trash.
        return this.notesService.delete(req.user.id, id);
    }
}
