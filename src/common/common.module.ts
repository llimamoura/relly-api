import { Global, Module } from '@nestjs/common';
import { SupabaseProvider, SupabaseAdminProvider } from './supabase.provider';

/**
 * Módulo global que disponibiliza os clientes Supabase em toda a aplicação
 * sem necessidade de importação explícita em cada módulo.
 */
@Global()
@Module({
  providers: [SupabaseProvider, SupabaseAdminProvider],
  exports: [SupabaseProvider, SupabaseAdminProvider],
})
export class CommonModule {}
