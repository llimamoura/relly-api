import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';

/**
 * Módulo de autenticação.
 * Depende do CommonModule (global) para os clientes Supabase.
 * Exporta AuthGuard para ser registrado como APP_GUARD no AppModule.
 */
@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthGuard],
  exports: [AuthGuard],
})
export class AuthModule {}
