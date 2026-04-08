import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';

/**
 * Módulo de transações — coração financeiro do Relly.
 * Importa LedgerModule para delegar o soft-delete + limpeza de ledger.
 * Depende do CommonModule (global) para o SUPABASE_ADMIN_CLIENT.
 */
@Module({
  imports: [LedgerModule],
  controllers: [TransactionsController],
  providers: [TransactionsService],
})
export class TransactionsModule {}
