import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import * as userDto from '@monokeep/shared/dist/dto/user.dto';

@Controller('auth')
export class AuthController {
    constructor(private authService: AuthService) { }

    @Post('register')
    register(@Body(new ZodValidationPipe(userDto.RegisterDtoSchema)) dto: userDto.RegisterDto) {
        return this.authService.register(dto);
    }

    @Post('login')
    login(@Body(new ZodValidationPipe(userDto.LoginDtoSchema)) dto: userDto.LoginDto) {
        return this.authService.login(dto);
    }
}
