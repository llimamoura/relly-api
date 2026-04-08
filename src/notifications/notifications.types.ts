import type { GroupType } from '../common/types';

export type NotificationType = 'group_invite' | 'invite_accepted';

/**
 * Mapa de tipos de dados por categoria de notificação.
 * Acesse com `NotificationData['group_invite']` para obter o shape correto.
 */
export interface NotificationData {
  group_invite: {
    group_id: string;
    group_name: string;
    group_type: GroupType;
    invite_id: string;
    invited_by_name: string;
  };
  invite_accepted: {
    group_id: string;
    group_name: string;
    accepted_by_name: string;
  };
}

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string | null;
  data: NotificationData[NotificationType];
  read: boolean;
  createdAt: string;
}

export interface NotificationsResult {
  notifications: Notification[];
  unread_count: number;
}

export interface DeclineResult {
  success: true;
}
