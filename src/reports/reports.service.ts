import {
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN_CLIENT } from '../common/supabase.provider';
import type { LedgerEntryType } from '../common/types';
import { SummaryQueryDto } from './reports.dto';
import type {
  ByCategoryItem,
  GroupSummary,
  MemberAdvance,
  PersonalSummary,
  PoolSummary,
} from './reports.types';

interface LedgerRow {
  entry_type: LedgerEntryType;
  amount: number;
  user_id: string | null;
  transaction: {
    occurred_at: string;
    category: { id: string; name: string } | null;
  } | null;
}

interface GroupRow {
  id: string;
  name: string;
  type: string;
}

@Injectable()
export class ReportsService {
  constructor(
    @Inject(SUPABASE_ADMIN_CLIENT) private readonly db: SupabaseClient,
  ) {}

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async assertMember(groupId: string, userId: string): Promise<void> {
    const { data } = await this.db
      .from('group_members')
      .select('user_id')
      .eq('group_id', groupId)
      .eq('user_id', userId)
      .single();

    if (!data) throw new ForbiddenException('Você não é membro deste grupo');
  }

  private startOfCurrentMonth(): string {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  }

  private endOfToday(): string {
    const now = new Date();
    now.setHours(23, 59, 59, 999);
    return now.toISOString();
  }

  private sumAmounts(rows: LedgerRow[], type: LedgerEntryType, userId?: string | null): number {
    return rows
      .filter((r) => {
        if (r.entry_type !== type) return false;
        if (userId !== undefined) return r.user_id === userId;
        return true;
      })
      .reduce((acc, r) => acc + Number(r.amount), 0);
  }

  private groupByCategory(rows: LedgerRow[], types: LedgerEntryType[], userId?: string | null): ByCategoryItem[] {
    const map = new Map<string, ByCategoryItem>();

    for (const row of rows) {
      if (!types.includes(row.entry_type)) continue;
      if (userId !== undefined && row.user_id !== userId) continue;

      const cat = row.transaction?.category;
      if (!cat) continue;

      const existing = map.get(cat.id);
      if (existing) {
        existing.total = parseFloat((existing.total + Number(row.amount)).toFixed(2));
      } else {
        map.set(cat.id, {
          categoryId: cat.id,
          categoryName: cat.name,
          total: Number(row.amount),
        });
      }
    }

    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }

  private buildPersonalSummary(rows: LedgerRow[], userId: string): PersonalSummary {
    // income pessoal → user_id = payer_id; expense pessoal → user_id = NULL (pool pessoal)
    const totalIncome   = this.sumAmounts(rows, 'income',  userId);
    const totalExpenses = this.sumAmounts(rows, 'expense', null);
    const balance       = parseFloat((totalIncome - totalExpenses).toFixed(2));
    // Sem filtro de user_id: inclui income (userId) e expense (null) do grupo pessoal
    const byCategory    = this.groupByCategory(rows, ['income', 'expense']);

    return { totalIncome, totalExpenses, balance, byCategory };
  }

  private buildPoolSummary(rows: LedgerRow[]): PoolSummary {
    // Pool entries have user_id = NULL
    const totalIncome   = this.sumAmounts(rows, 'income',  null);
    const totalExpenses = this.sumAmounts(rows, 'expense', null);
    const balance       = parseFloat((totalIncome - totalExpenses).toFixed(2));
    const byCategory    = this.groupByCategory(rows, ['income', 'expense'], null);

    return { totalIncome, totalExpenses, balance, byCategory };
  }

  private buildMembersAdvances(rows: LedgerRow[]): MemberAdvance[] | undefined {
    const advanceRows = rows.filter(
      (r) => r.entry_type === 'expense_paid' || r.entry_type === 'expense_owed',
    );

    if (advanceRows.length === 0) return undefined;

    const map = new Map<string, MemberAdvance>();

    for (const row of advanceRows) {
      if (!row.user_id) continue;

      let entry = map.get(row.user_id);
      if (!entry) {
        entry = { userId: row.user_id, paid: 0, owed: 0, net: 0 };
        map.set(row.user_id, entry);
      }

      if (row.entry_type === 'expense_paid') {
        entry.paid = parseFloat((entry.paid + Number(row.amount)).toFixed(2));
      } else {
        entry.owed = parseFloat((entry.owed + Number(row.amount)).toFixed(2));
      }
    }

    for (const entry of map.values()) {
      entry.net = parseFloat((entry.paid - entry.owed).toFixed(2));
    }

    return Array.from(map.values());
  }

  // ── Public ─────────────────────────────────────────────────────────────────

  async getSummary(
    groupId: string,
    userId: string,
    dto: SummaryQueryDto,
  ): Promise<GroupSummary> {
    await this.assertMember(groupId, userId);

    const from = dto.from ?? this.startOfCurrentMonth();
    const to   = dto.to   ?? this.endOfToday();

    // Fetch group info
    const { data: groupData, error: groupError } = await this.db
      .from('groups')
      .select('id, name, type')
      .eq('id', groupId)
      .single();

    if (groupError ?? !groupData) {
      throw new InternalServerErrorException('Erro ao buscar dados do grupo');
    }

    const group = groupData as GroupRow;

    // Fetch ledger entries for the period, joining transaction → category
    // Filtra por transactions.occurred_at (quando a transação ocorreu),
    // não por ledger_entries.created_at (quando o registro foi inserido).
    const { data: ledgerData, error: ledgerError } = await this.db
      .from('ledger_entries')
      .select(
        'entry_type:type, amount, user_id, transaction:transactions!inner(occurred_at, category:categories(id, name))',
      )
      .eq('group_id', groupId)
      .gte('transactions.occurred_at', from)
      .lte('transactions.occurred_at', to);

    if (ledgerError ?? !ledgerData) {
      throw new InternalServerErrorException('Erro ao buscar lançamentos');
    }

    const rows = ledgerData as unknown as LedgerRow[];

    const summary: GroupSummary = {
      period: { from, to },
      group:  { id: group.id, name: group.name, type: group.type },
    };

    if (group.type === 'personal') {
      summary.personal = this.buildPersonalSummary(rows, userId);
    } else {
      // couple / shared: pool + optional advances section
      summary.pool    = this.buildPoolSummary(rows);
      summary.members = this.buildMembersAdvances(rows);
    }

    return summary;
  }
}
