import { Module } from '@nestjs/common';
import { LedgerService } from './ledger.service';

/**
 * Módulo de ledger — contabilidade append-only do Relly.
 * Depende do CommonModule (global) para o SUPABASE_ADMIN_CLIENT.
 * Exporta LedgerService para uso no TransactionsModule.
 */
@Module({
  providers: [LedgerService],
  exports: [LedgerService],
})
export class LedgerModule {}
