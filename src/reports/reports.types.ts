export interface ByCategoryItem {
  categoryId: string;
  categoryName: string;
  total: number;
}

export interface PersonalSummary {
  totalIncome: number;
  totalExpenses: number;
  balance: number;
  byCategory: ByCategoryItem[];
}

export interface PoolSummary {
  totalIncome: number;
  totalExpenses: number;
  balance: number;
  byCategory: ByCategoryItem[];
}

export interface MemberAdvance {
  userId: string;
  paid: number;   // expense_paid entries (paid on behalf of others)
  owed: number;   // expense_owed entries (owes others)
  net: number;    // paid - owed
}

export interface GroupSummary {
  period: { from: string; to: string };
  group: { id: string; name: string; type: string };
  personal?: PersonalSummary;
  pool?: PoolSummary;
  members?: MemberAdvance[];
}
