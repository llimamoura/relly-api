import { TransactionType } from '../common/types';

/** Shape retornado pelo Supabase nas queries de transação. */
export interface TransactionRow {
  id: string;
  group_id: string;
  payer_id: string;
  category_id: string | null;
  amount: number;
  type: TransactionType;
  is_advance: boolean;
  description: string | null;
  occurred_at: string;
  created_at: string;
  deleted_at: string | null;
  categories?: { name: string; type: string } | null;
}

/** Split calculado pelo TypeScript antes de ser enviado ao SQL. */
export interface SplitInput {
  user_id: string;
  amount: number;
}
