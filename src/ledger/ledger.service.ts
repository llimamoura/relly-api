import { Inject, Injectable, InternalServerErrorException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN_CLIENT } from '../common/supabase.provider';
import { GroupBalance, UserBalance } from './ledger.types';

@Injectable()
export class LedgerService {
  constructor(
    @Inject(SUPABASE_ADMIN_CLIENT) private readonly db: SupabaseClient,
  ) {}

  /**
   * Chama a função SQL `populate_ledger` para gerar as entradas de ledger
   * de uma transação já persistida.
   *
   * Usado standalone para re-população administrativa. No fluxo normal de
   * criação, o ledger é populado atomicamente por `create_transaction_atomic`.
   *
   * @throws {InternalServerErrorException} Se o SQL retornar erro.
   */
  async populate(transactionId: string): Promise<void> {
    const { error } = await this.db.rpc('populate_ledger', {
      p_transaction_id: transactionId,
    });
    if (error) throw new InternalServerErrorException(error.message);
  }

  /**
   * Chama a função SQL `delete_transaction`, que executa atomicamente:
   *   1. Soft-delete em transactions (deleted_at = now())
   *   2. Hard-delete em ledger_entries da transação
   *   3. REFRESH das materialized views de saldo
   *
   * A função SQL também verifica que p_user_id é membro do grupo —
   * proteção dupla em relação à checagem feita no TransactionsService.
   *
   * @throws {InternalServerErrorException} Se o SQL retornar erro.
   */
  async deleteEntries(transactionId: string, userId: string): Promise<void> {
    const { error } = await this.db.rpc('delete_transaction', {
      p_transaction_id: transactionId,
      p_user_id: userId,
    });
    if (error) throw new InternalServerErrorException(error.message);
  }

  /**
   * Retorna o saldo do pool compartilhado de um grupo a partir da
   * materialized view `group_pool_balance`.
   * Retorna null se nenhuma entrada de ledger existir ainda para o grupo.
   */
  async getGroupBalance(groupId: string): Promise<GroupBalance | null> {
    const { data, error } = await this.db
      .from('group_pool_balance')
      .select('group_id, total_in, total_out, pool_balance')
      .eq('group_id', groupId)
      .single();

    if (error ?? !data) return null;

    const row = data as {
      group_id: string;
      total_in: number;
      total_out: number;
      pool_balance: number;
    };

    return {
      groupId: row.group_id,
      totalIn: Number(row.total_in),
      totalOut: Number(row.total_out),
      poolBalance: Number(row.pool_balance),
    };
  }

  /**
   * Retorna o saldo individual de um usuário dentro de um grupo a partir da
   * materialized view `user_group_balance`.
   * Retorna null se nenhuma entrada existir para o par (groupId, userId).
   */
  async getUserBalance(groupId: string, userId: string): Promise<UserBalance | null> {
    const { data, error } = await this.db
      .from('user_group_balance')
      .select('user_id, group_id, total_in, total_owed, net_balance')
      .eq('group_id', groupId)
      .eq('user_id', userId)
      .single();

    if (error ?? !data) return null;

    const row = data as {
      user_id: string;
      group_id: string;
      total_in: number;
      total_owed: number;
      net_balance: number;
    };

    return {
      userId: row.user_id,
      groupId: row.group_id,
      totalIn: Number(row.total_in),
      totalOwed: Number(row.total_owed),
      netBalance: Number(row.net_balance),
    };
  }
}
