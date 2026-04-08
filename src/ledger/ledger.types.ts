export interface GroupBalance {
  groupId: string;
  totalIn: number;
  totalOut: number;
  poolBalance: number;
}

export interface UserBalance {
  userId: string;
  groupId: string;
  totalIn: number;
  totalOwed: number;
  netBalance: number;
}
