import {
  BadRequestException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN_CLIENT } from '../common/supabase.provider';
import { GroupsService } from '../groups/groups.service';
import type { GroupWithMembers } from '../groups/groups.types';
import { ListNotificationsDto } from './notifications.dto';
import type {
  DeclineResult,
  Notification,
  NotificationData,
  NotificationsResult,
  NotificationType,
} from './notifications.types';

@Injectable()
export class NotificationsService {
  constructor(
    @Inject(SUPABASE_ADMIN_CLIENT) private readonly db: SupabaseClient,
    @Inject(forwardRef(() => GroupsService))
    private readonly groupsService: GroupsService,
  ) {}

  // ── Mapper ─────────────────────────────────────────────────────────────────

  private toNotification = (row: Record<string, unknown>): Notification => ({
    id:        row['id']         as string,
    userId:    row['user_id']    as string,
    type:      row['type']       as NotificationType,
    title:     row['title']      as string,
    body:      (row['body'] as string | null) ?? null,
    data:      row['data']       as NotificationData[NotificationType],
    read:      row['read']       as boolean,
    createdAt: row['created_at'] as string,
  });

  // ── create ─────────────────────────────────────────────────────────────────

  /**
   * Cria uma notificação para um usuário.
   * Método interno — usado por outros services, não exposto diretamente na API.
   *
   * @param userId  - UUID do destinatário.
   * @param type    - Tipo da notificação (discrimina o shape de `data`).
   * @param title   - Título exibido na aba de notificações.
   * @param body    - Texto descritivo opcional.
   * @param data    - Payload tipado conforme `NotificationData[T]`.
   */
  async create<T extends NotificationType>(
    userId: string,
    type: T,
    title: string,
    body: string,
    data: NotificationData[T],
  ): Promise<void> {
    const { error } = await this.db
      .from('notifications')
      .insert({ user_id: userId, type, title, body, data });

    if (error) throw new InternalServerErrorException('Erro ao criar notificação');
  }

  // ── findAll ────────────────────────────────────────────────────────────────

  /**
   * Lista notificações do usuário com paginação e filtro opcional de não lidas.
   * Retorna também `unread_count` total para o badge da aba de notificações.
   */
  async findAll(userId: string, dto: ListNotificationsDto): Promise<NotificationsResult> {
    const page  = dto.page  ?? 1;
    const limit = dto.limit ?? 20;
    const from  = (page - 1) * limit;
    const to    = from + limit - 1;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query: any = this.db
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (dto.unread_only) {
      query = query.eq('read', false);
    }

    const { data, error } = await query;
    if (error) throw new InternalServerErrorException('Erro ao buscar notificações');

    const { count } = await this.db
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('read', false);

    return {
      notifications: (data as Record<string, unknown>[] ?? []).map(this.toNotification),
      unread_count:  count ?? 0,
    };
  }

  // ── markAsRead ─────────────────────────────────────────────────────────────

  /**
   * Marca uma notificação como lida.
   *
   * @throws {NotFoundException}  Se a notificação não existir.
   * @throws {ForbiddenException} Se não pertencer ao usuário autenticado.
   */
  async markAsRead(notificationId: string, userId: string): Promise<Notification> {
    const existing = await this.fetchAndAuthorize(notificationId, userId);
    if (existing.read) return existing;

    const { data, error } = await this.db
      .from('notifications')
      .update({ read: true })
      .eq('id', notificationId)
      .select('*')
      .single();

    if (error || !data) throw new InternalServerErrorException('Erro ao atualizar notificação');

    return this.toNotification(data as Record<string, unknown>);
  }

  // ── markAllAsRead ──────────────────────────────────────────────────────────

  /** Marca todas as notificações não lidas do usuário como lidas. */
  async markAllAsRead(userId: string): Promise<void> {
    const { error } = await this.db
      .from('notifications')
      .update({ read: true })
      .eq('user_id', userId)
      .eq('read', false);

    if (error) throw new InternalServerErrorException('Erro ao atualizar notificações');
  }

  // ── accept ─────────────────────────────────────────────────────────────────

  /**
   * Aceita um convite de grupo recebido via notificação interna.
   *
   * Fluxo:
   *  1. Valida que a notificação pertence ao usuário e é do tipo 'group_invite'.
   *  2. Busca o convite no banco para obter o token (accept_invite_atomic) e o invitador.
   *  3. Delega a lógica de aceite para GroupsService.acceptInvite.
   *  4. Marca a notificação como lida.
   *  5. Cria notificação de retorno ('invite_accepted') para o invitador.
   *  6. Retorna o GroupWithMembers atualizado.
   *
   * @throws {NotFoundException}   Se a notificação ou o convite não forem encontrados.
   * @throws {ForbiddenException}  Se a notificação não pertencer ao usuário.
   * @throws {BadRequestException} Se o tipo não for 'group_invite' ou o convite expirou.
   */
  async accept(notificationId: string, userId: string): Promise<GroupWithMembers> {
    // 1. Buscar + autorizar
    const notif = await this.fetchAndAuthorize(notificationId, userId);

    if (notif.type !== 'group_invite') {
      throw new BadRequestException('Esta notificação não é um convite de grupo');
    }

    const inviteData = notif.data as NotificationData['group_invite'];

    // 2. Buscar convite para obter token e invited_by
    const { data: inviteRaw } = await this.db
      .from('invites')
      .select('id, token, invited_by, group_id')
      .eq('id', inviteData.invite_id)
      .single();

    if (!inviteRaw) throw new NotFoundException('Convite não encontrado ou expirado');

    const invite = inviteRaw as { id: string; token: string; invited_by: string; group_id: string };

    // 3. Aceitar convite via GroupsService (reutiliza accept_invite_atomic)
    const group = await this.groupsService.acceptInvite(invite.token, userId);

    // 4. Marcar notificação como lida
    await this.db
      .from('notifications')
      .update({ read: true })
      .eq('id', notificationId);

    // 5. Criar notificação de retorno para o invitador
    const acceptorMember = group.members.find((m) => m.userId === userId);
    const acceptedByName = acceptorMember?.name ?? '';

    await this.create(
      invite.invited_by,
      'invite_accepted',
      `${acceptedByName} entrou no grupo`,
      `${acceptedByName} aceitou seu convite para ${group.name}`,
      {
        group_id:          group.id,
        group_name:        group.name,
        accepted_by_name:  acceptedByName,
      },
    );

    return group;
  }

  // ── decline ────────────────────────────────────────────────────────────────

  /**
   * Recusa um convite de grupo recebido via notificação interna.
   *
   * A recusa é silenciosa — nenhuma notificação é enviada ao invitador.
   *
   * @throws {NotFoundException}   Se a notificação não for encontrada.
   * @throws {ForbiddenException}  Se a notificação não pertencer ao usuário.
   * @throws {BadRequestException} Se o tipo não for 'group_invite'.
   */
  async decline(notificationId: string, userId: string): Promise<DeclineResult> {
    // 1. Buscar + autorizar
    const notif = await this.fetchAndAuthorize(notificationId, userId);

    if (notif.type !== 'group_invite') {
      throw new BadRequestException('Esta notificação não é um convite de grupo');
    }

    const inviteData = notif.data as NotificationData['group_invite'];

    // 2. Marcar convite como recusado
    const { error } = await this.db
      .from('invites')
      .update({ status: 'declined' })
      .eq('id', inviteData.invite_id);

    if (error) throw new InternalServerErrorException('Erro ao recusar convite');

    // 3. Marcar notificação como lida (silenciosamente)
    await this.db
      .from('notifications')
      .update({ read: true })
      .eq('id', notificationId);

    return { success: true };
  }

  // ── Helpers privados ───────────────────────────────────────────────────────

  /**
   * Busca notificação por ID e valida que pertence ao usuário.
   *
   * @throws {NotFoundException}  Se não existir.
   * @throws {ForbiddenException} Se pertencer a outro usuário.
   */
  private async fetchAndAuthorize(
    notificationId: string,
    userId: string,
  ): Promise<Notification> {
    const { data } = await this.db
      .from('notifications')
      .select('*')
      .eq('id', notificationId)
      .single();

    if (!data) throw new NotFoundException('Notificação não encontrada');

    const notif = this.toNotification(data as Record<string, unknown>);

    if (notif.userId !== userId) {
      throw new ForbiddenException('Acesso negado');
    }

    return notif;
  }
}
