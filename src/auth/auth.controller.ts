import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto, RegisterDto } from './auth.dto';
import { Public } from './decorators/public.decorator';
import { AuthResponse } from './auth.types';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('register')
  @ApiOperation({ summary: 'Registra novo usuário e cria grupo pessoal' })
  @ApiResponse({ status: 201, description: 'Usuário criado — retorna sessão JWT' })
  @ApiResponse({ status: 400, description: 'E-mail já cadastrado ou dados inválidos' })
  register(@Body() dto: RegisterDto): Promise<AuthResponse> {
    return this.authService.register(dto);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Autentica usuário e retorna tokens JWT' })
  @ApiResponse({ status: 200, description: 'Login realizado — retorna sessão JWT' })
  @ApiResponse({ status: 401, description: 'Credenciais inválidas' })
  login(@Body() dto: LoginDto): Promise<AuthResponse> {
    return this.authService.login(dto);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Invalida o token JWT do usuário' })
  @ApiResponse({ status: 204, description: 'Sessão encerrada com sucesso' })
  async logout(@Headers('authorization') auth: string | undefined): Promise<void> {
    const token = auth?.replace('Bearer ', '') ?? '';
    return this.authService.logout(token);
  }
}
