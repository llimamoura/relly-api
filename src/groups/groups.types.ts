import { GroupType, MemberRole } from '../common/types';

// ── Tipos públicos ──────────────────────────────────────────────────────────

export interface GroupMemberDetail {
  userId: string;
  name: string;
  role: MemberRole;
  splitShare: number;
}

export interface GroupWithMembers {
  id: string;
  name: string;
  type: GroupType;
  members: GroupMemberDetail[];
}

/** Resposta unificada do endpoint POST /groups/:id/invite */
export interface InviteResponse {
  /** 'notification' quando o convite foi entregue via notificação interna;
   *  'link'         quando um link de token foi gerado para compartilhamento manual. */
  delivery: 'notification' | 'link';
  message: string;
  /** Presente apenas quando delivery = 'link'. */
  invite_url?: string;
  expires_at: string;
}

// ── Tipos internos (shapes retornados pelo Supabase) ────────────────────────

export interface DbMember {
  user_id: string;
  role: string;
  split_share: number;
  users: { name: string } | null;
}

export interface DbGroupWithMembers {
  id: string;
  name: string;
  type: string;
  group_members: DbMember[];
}
