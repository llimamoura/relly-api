import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN_CLIENT } from '../common/supabase.provider';
import { LedgerService } from '../ledger/ledger.service';
import { CreateTransactionDto, ListTransactionsDto } from './transactions.dto';
import { SplitInput, TransactionRow } from './transactions.types';

@Injectable()
export class TransactionsService {
  constructor(
    @Inject(SUPABASE_ADMIN_CLIENT) private readonly db: SupabaseClient,
    private readonly ledger: LedgerService,
  ) {}

  // ── Helpers privados ────────────────────────────────────────────────────

  /**
   * Lança ForbiddenException se userId não for membro de groupId.
   * Usado como guard antes de qualquer operação de leitura ou escrita.
   */
  private async assertMember(groupId: string, userId: string): Promise<void> {
    const { data } = await this.db
      .from('group_members')
      .select('user_id')
      .eq('group_id', groupId)
      .eq('user_id', userId)
      .single();

    if (!data) throw new ForbiddenException('Você não é membro deste grupo');
  }

  /**
   * Busca uma transação pelo ID sem re-verificar membership (uso interno).
   * Garante que a transação pertence ao grupo e não foi soft-deletada.
   */
  private async fetchTransaction(
    groupId: string,
    transactionId: string,
  ): Promise<TransactionRow> {
    const { data, error } = await this.db
      .from('transactions')
      .select(
        'id, group_id, payer_id, category_id, amount, type, is_advance, description, occurred_at, created_at, deleted_at, categories ( name, type )',
      )
      .eq('id', transactionId)
      .eq('group_id', groupId)
      .is('deleted_at', null)
      .single();

    if (error ?? !data) throw new NotFoundException('Transação não encontrada');
    return data as unknown as TransactionRow;
  }

  /**
   * Calcula a distribuição de splits entre os membros do grupo.
   *
   * Regra de arredondamento:
   *   amount_per_member = floor(total / n * 100) / 100
   *   O payer absorve o centavo residual para garantir SUM(splits) === total.
   *
   * Exemplo: R$99,99 ÷ 2 membros
   *   → member comum: R$49,99
   *   → payer:        R$50,00  (49,99 + 0,01 residual)
   *   → soma:         R$99,99 ✓
   */
  private calculateSplits(
    total: number,
    memberIds: string[],
    payerId: string,
  ): SplitInput[] {
    const n = memberIds.length;
    const perPerson = Math.floor((total / n) * 100) / 100;
    // Payer recebe o residual de arredondamento
    const payerAmount = parseFloat((total - perPerson * (n - 1)).toFixed(2));

    return memberIds.map((uid) => ({
      user_id: uid,
      amount: uid === payerId ? payerAmount : perPerson,
    }));
  }

  // ── Métodos públicos ────────────────────────────────────────────────────

  /**
   * Cria uma transação e popula o ledger de forma atômica via RPC.
   *
   * Fluxo:
   *  1. Verifica membership do payer no grupo.
   *  2. Valida que a categoria pertence ao grupo ou é global (group_id IS NULL).
   *  3. Se is_advance=true: busca membros e calcula splits com regra de
   *     arredondamento (centavo residual vai para o payer).
   *  4. Chama `create_transaction_atomic` — uma única transação PostgreSQL
   *     que faz INSERT em transactions + transaction_splits + populate_ledger.
   *
   * @throws {ForbiddenException}     Se o usuário não for membro do grupo.
   * @throws {BadRequestException}    Se a categoria pertencer a outro grupo.
   * @throws {NotFoundException}      Se a categoria não existir.
   * @throws {InternalServerErrorException} Se o RPC falhar inesperadamente.
   */
  async create(
    groupId: string,
    userId: string,
    dto: CreateTransactionDto,
  ): Promise<TransactionRow> {
    // 1. Membership
    await this.assertMember(groupId, userId);

    // 2. Valida categoria
    const { data: category, error: catErr } = await this.db
      .from('categories')
      .select('group_id')
      .eq('id', dto.category_id)
      .single();

    if (catErr ?? !category) {
      throw new NotFoundException('Categoria não encontrada');
    }

    const cat = category as { group_id: string | null };
    if (cat.group_id !== null && cat.group_id !== groupId) {
      throw new BadRequestException(
        'Categoria pertence a outro grupo. Use uma categoria global ou do próprio grupo.',
      );
    }

    // 3. Calcula splits (somente para expense + is_advance=true)
    let splits: SplitInput[] = [];

    if (dto.type === 'expense' && dto.is_advance === true) {
      const { data: members, error: mErr } = await this.db
        .from('group_members')
        .select('user_id')
        .eq('group_id', groupId);

      if (mErr ?? !members?.length) {
        throw new InternalServerErrorException('Erro ao buscar membros do grupo');
      }

      const memberIds = (members as { user_id: string }[]).map((m) => m.user_id);
      splits = this.calculateSplits(dto.amount, memberIds, userId);
    }

    // 4. Persiste de forma atômica (transaction + splits + ledger)
    const { data: txId, error } = await this.db.rpc('create_transaction_atomic', {
      p_group_id: groupId,
      p_payer_id: userId,
      p_category_id: dto.category_id,
      p_amount: dto.amount,
      p_type: dto.type,
      p_is_advance: dto.is_advance ?? false,
      p_description: dto.description ?? null,
      p_occurred_at: dto.occurred_at ?? null,
      p_splits: splits,
    });

    if (error) throw new InternalServerErrorException(error.message);

    return this.fetchTransaction(groupId, txId as string);
  }

  /**
   * Lista transações de um grupo com filtros e paginação.
   * Retorna apenas transações ativas (deleted_at IS NULL).
   *
   * @param filters.page  Página (default 1)
   * @param filters.limit Itens por página (default 20, max 50)
   * @param filters.order Ordenação por occurred_at (default 'desc')
   */
  async findAll(
    groupId: string,
    userId: string,
    filters: ListTransactionsDto,
  ): Promise<TransactionRow[]> {
    await this.assertMember(groupId, userId);

    const page = filters.page ?? 1;
    const limit = Math.min(filters.limit ?? 20, 50);
    const rangeFrom = (page - 1) * limit;
    const rangeTo = rangeFrom + limit - 1;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query: any = this.db
      .from('transactions')
      .select(
        'id, group_id, payer_id, category_id, amount, type, is_advance, description, occurred_at, created_at, categories ( name, type )',
      )
      .eq('group_id', groupId)
      .is('deleted_at', null)
      .order('occurred_at', { ascending: filters.order === 'asc' })
      .range(rangeFrom, rangeTo);

    if (filters.from) query = query.gte('occurred_at', filters.from);
    if (filters.to) query = query.lte('occurred_at', filters.to);
    if (filters.type) query = query.eq('type', filters.type);
    if (filters.category_id) query = query.eq('category_id', filters.category_id);

    const { data, error } = (await query) as {
      data: TransactionRow[] | null;
      error: unknown;
    };

    if (error ?? !data) throw new InternalServerErrorException('Erro ao buscar transações');
    return data;
  }

  /**
   * Retorna uma transação com detalhes de categoria.
   * Verifica que o usuário é membro do grupo antes de expor os dados.
   *
   * @throws {ForbiddenException} Se o usuário não for membro do grupo.
   * @throws {NotFoundException}  Se a transação não existir ou já foi deletada.
   */
  async findOne(
    groupId: string,
    transactionId: string,
    userId: string,
  ): Promise<TransactionRow> {
    await this.assertMember(groupId, userId);
    return this.fetchTransaction(groupId, transactionId);
  }

  /**
   * Soft-deleta uma transação e remove suas entradas de ledger.
   * Delega para LedgerService.deleteEntries que chama a função SQL
   * `delete_transaction` — a operação é atômica no banco.
   *
   * @throws {ForbiddenException} Se o usuário não for membro do grupo.
   */
  async remove(
    groupId: string,
    transactionId: string,
    userId: string,
  ): Promise<void> {
    await this.assertMember(groupId, userId);
    await this.ledger.deleteEntries(transactionId, userId);
  }
}
