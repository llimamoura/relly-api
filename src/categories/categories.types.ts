import type { TransactionType } from '../common/types';

export interface CategoryRow {
  id: string;
  name: string;
  type: TransactionType;
  icon: string | null;
  group_id: string | null;
  created_at: string;
}
