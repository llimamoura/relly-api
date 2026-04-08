import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN_CLIENT } from '../common/supabase.provider';
import { GroupType, MemberRole } from '../common/types';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateGroupDto, CreateInviteDto } from './groups.dto';
import {
  DbGroupWithMembers,
  GroupWithMembers,
  InviteResponse,
} from './groups.types';

// O criador sempre começa com 100% — accept_invite_atomic redistribui
// quando novos membros entram (couple → 50/50, shared → igualitário).
const INITIAL_SPLIT: Record<'couple' | 'shared', number> = {
  couple: 100.0,
  shared: 100.0,
};

// max_members inicial por tipo (trial; trigger bypassa para premium+shared)
const MAX_MEMBERS: Record<'couple' | 'shared', number> = {
  couple: 2,
  shared: 5,
};

@Injectable()
export class GroupsService {
  constructor(
    @Inject(SUPABASE_ADMIN_CLIENT) private readonly db: SupabaseClient,
    @Inject(forwardRef(() => NotificationsService))
    private readonly notificationsService: NotificationsService,
  ) {}

  // ── Helpers privados ────────────────────────────────────────────────────

  private toGroupWithMembers(row: DbGroupWithMembers): GroupWithMembers {
    return {
      id: row.id,
      name: row.name,
      type: row.type as GroupType,
      members: row.group_members.map((m) => ({
        userId: m.user_id,
        name: m.users?.name ?? '',
        role: m.role as MemberRole,
        splitShare: Number(m.split_share),
      })),
    };
  }

  /**
   * Mapeia erros vindos das funções PL/pgSQL para exceções HTTP legíveis.
   * Usa as mensagens definidas nas funções accept_invite_atomic e
   * check_group_capacity para identificar cada caso de falha.
   */
  private mapRpcError(error: { message: string }): never {
    const msg = error.message ?? '';
    if (msg.includes('expirou')) throw new BadRequestException('O convite expirou.');
    if (msg.includes('utilizado') || msg.includes('inativo'))
      throw new BadRequestException('Este convite já foi utilizado ou está inativo.');
    if (msg.includes('já é membro'))
      throw new BadRequestException('Você já é membro deste grupo.');
    if (msg.includes('atingiu o limite') || msg.includes('máximo'))
      throw new BadRequestException(msg);
    if (msg.includes('não encontrado') || msg.includes('não encontrada'))
      throw new NotFoundException(msg);
    throw new InternalServerErrorException(msg);
  }

  /**
   * Cria um convite por token (fluxo externo / fallback).
   * Insere o registro em invites e retorna a InviteResponse com delivery='link'.
   */
  private async createLinkInvite(
    groupId: string,
    userId: string,
  ): Promise<InviteResponse> {
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: invite, error } = await this.db
      .from('invites')
      .insert({ group_id: groupId, invited_by: userId, expires_at: expiresAt })
      .select('token, expires_at')
      .single();

    if (error || !invite) throw new InternalServerErrorException('Erro ao gerar convite');

    const inv = invite as { token: string; expires_at: string };

    return {
      delivery:   'link',
      message:    'Link de convite gerado. Compartilhe com o convidado.',
      invite_url: `https://relly.app/join/${inv.token}`,
      expires_at: inv.expires_at,
    };
  }

  // ── Métodos públicos ────────────────────────────────────────────────────

  /**
   * Cria um grupo do tipo 'couple' ou 'shared' e insere o criador como admin.
   * A operação é atômica via RPC — grupo e primeiro membro são criados na
   * mesma transação PostgreSQL, garantindo que o trigger check_split_shares
   * valide o estado final (não o intermediário).
   *
   * Grupos 'personal' são criados automaticamente pelo trigger handle_new_user
   * no signup — nunca devem ser criados via API.
   *
   * @throws {BadRequestException} Se o tipo for 'personal'.
   * @throws {InternalServerErrorException} Se o RPC falhar por motivo inesperado.
   */
  async create(userId: string, dto: CreateGroupDto): Promise<GroupWithMembers> {
    if ((dto.type as string) === 'personal') {
      throw new BadRequestException(
        "Grupos 'personal' são criados automaticamente no cadastro.",
      );
    }

    const { data: groupId, error } = await this.db.rpc('create_group_atomic', {
      p_name:        dto.name,
      p_type:        dto.type,
      p_owner_id:    userId,
      p_max_members: MAX_MEMBERS[dto.type],
      p_split_share: INITIAL_SPLIT[dto.type],
    });

    if (error) this.mapRpcError(error);

    return this.findOne(groupId as string, userId);
  }

  /**
   * Retorna todos os grupos dos quais o usuário é membro,
   * incluindo lista de membros com nome e split_share.
   */
  async findAllByUser(userId: string): Promise<GroupWithMembers[]> {
    const { data: memberships, error: mErr } = await this.db
      .from('group_members')
      .select('group_id')
      .eq('user_id', userId);

    if (mErr) throw new InternalServerErrorException('Erro ao buscar grupos');
    if (!memberships?.length) return [];

    const groupIds = memberships.map((m) => (m as { group_id: string }).group_id);

    const { data, error } = await this.db
      .from('groups')
      .select('id, name, type, group_members ( user_id, role, split_share, users ( name ) )')
      .in('id', groupIds);

    if (error || !data) throw new InternalServerErrorException('Erro ao buscar grupos');

    return (data as unknown as DbGroupWithMembers[]).map((row) =>
      this.toGroupWithMembers(row),
    );
  }

  /**
   * Retorna os detalhes de um grupo específico com todos os membros.
   * Verifica manualmente que o solicitante é membro do grupo
   * (proteção complementar ao RLS — o db usa service_role).
   *
   * @throws {NotFoundException} Se o grupo não existir.
   * @throws {ForbiddenException} Se o usuário não for membro do grupo.
   */
  async findOne(groupId: string, userId: string): Promise<GroupWithMembers> {
    const { data, error } = await this.db
      .from('groups')
      .select('id, name, type, group_members ( user_id, role, split_share, users ( name ) )')
      .eq('id', groupId)
      .single();

    if (error || !data) throw new NotFoundException('Grupo não encontrado');

    const row = data as unknown as DbGroupWithMembers;
    const isMember = row.group_members.some((m) => m.user_id === userId);
    if (!isMember) throw new ForbiddenException('Você não é membro deste grupo');

    return this.toGroupWithMembers(row);
  }

  /**
   * Gera um convite para um grupo com dois fluxos possíveis:
   *
   * - **Fluxo interno** (padrão): o admin informa o `email` de um usuário já
   *   cadastrado. O backend localiza o usuário via `find_user_by_email` e cria
   *   uma notificação interna de tipo `group_invite`. O convidado aceita ou
   *   recusa pela aba de notificações.
   *
   * - **Fluxo externo** (fallback): quando `use_link = true`, o email não é
   *   informado, ou o usuário não é encontrado na base. Gera um token de link
   *   para compartilhamento manual.
   *
   * @throws {NotFoundException}   Se o solicitante não for membro.
   * @throws {ForbiddenException}  Se o solicitante não for admin.
   * @throws {BadRequestException} Se o grupo já está cheio.
   * @throws {ConflictException}   Se o usuário-alvo já for membro do grupo.
   */
  async generateInvite(
    groupId: string,
    userId: string,
    dto: CreateInviteDto = {},
  ): Promise<InviteResponse> {
    // 1. Verificar que o solicitante é admin
    const { data: member, error: mErr } = await this.db
      .from('group_members')
      .select('role')
      .eq('group_id', groupId)
      .eq('user_id', userId)
      .single();

    if (mErr || !member) throw new NotFoundException('Você não é membro deste grupo');

    if ((member as { role: string }).role !== 'admin') {
      throw new ForbiddenException('Apenas admins podem gerar convites');
    }

    // 2. Buscar dados do grupo
    const { data: groupData } = await this.db
      .from('groups')
      .select('id, name, type, max_members')
      .eq('id', groupId)
      .single();

    if (!groupData) throw new NotFoundException('Grupo não encontrado');

    const group = groupData as { id: string; name: string; type: string; max_members: number };

    // 3. Verificar capacidade
    const { count: memberCount } = await this.db
      .from('group_members')
      .select('*', { count: 'exact', head: true })
      .eq('group_id', groupId);

    if ((memberCount ?? 0) >= group.max_members) {
      throw new BadRequestException(
        `O grupo "${group.name}" atingiu o limite máximo de ${group.max_members} membro(s).`,
      );
    }

    // 4. Sem email ou force link → fluxo externo
    if (!dto.email || dto.use_link) {
      return this.createLinkInvite(groupId, userId);
    }

    // 5. Buscar usuário pelo email
    const { data: userRows } = await this.db.rpc('find_user_by_email', {
      p_email: dto.email,
    });
    const targetUser = (userRows as Array<{ id: string; name: string }> | null)?.[0];

    // 5b. Usuário não encontrado → fallback para link
    if (!targetUser) {
      return this.createLinkInvite(groupId, userId);
    }

    // 6. Verificar se já é membro
    const { data: existingMember } = await this.db
      .from('group_members')
      .select('user_id')
      .eq('group_id', groupId)
      .eq('user_id', targetUser.id)
      .single();

    if (existingMember) {
      throw new ConflictException('Este usuário já é membro do grupo.');
    }

    // 7. Criar convite no banco
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: invite, error: invErr } = await this.db
      .from('invites')
      .insert({ group_id: groupId, invited_by: userId, expires_at: expiresAt })
      .select('id, expires_at')
      .single();

    if (invErr || !invite) throw new InternalServerErrorException('Erro ao gerar convite');

    const inv = invite as { id: string; expires_at: string };

    // 8. Buscar nome do invitador
    const { data: inviterData } = await this.db
      .from('users')
      .select('name')
      .eq('id', userId)
      .single();

    const inviterName = (inviterData as { name: string } | null)?.name ?? '';

    // 9. Criar notificação interna para o convidado
    await this.notificationsService.create(
      targetUser.id,
      'group_invite',
      `Convite para ${group.name}`,
      `${inviterName} te convidou para entrar no grupo "${group.name}"`,
      {
        group_id:        groupId,
        group_name:      group.name,
        group_type:      group.type as GroupType,
        invite_id:       inv.id,
        invited_by_name: inviterName,
      },
    );

    return {
      delivery:   'notification',
      message:    `Convite enviado para ${dto.email}`,
      expires_at: inv.expires_at,
    };
  }

  /**
   * Aceita um convite pelo token, adicionando o usuário ao grupo.
   * A operação é atômica via RPC: validação do token, redistribuição
   * de split_share e inserção do membro ocorrem na mesma transação.
   *
   * Também é chamado internamente pelo NotificationsService quando o usuário
   * aceita via notificação interna.
   *
   * @throws {BadRequestException} Se o token for inválido, expirado ou já utilizado.
   * @throws {BadRequestException} Se o grupo estiver cheio (trigger check_group_capacity).
   * @throws {BadRequestException} Se o usuário já for membro do grupo.
   */
  async acceptInvite(token: string, userId: string): Promise<GroupWithMembers> {
    const { data: groupId, error } = await this.db.rpc('accept_invite_atomic', {
      p_token:   token,
      p_user_id: userId,
    });

    if (error) this.mapRpcError(error);

    return this.findOne(groupId as string, userId);
  }

  /**
   * Remove um membro do grupo.
   * Regras:
   *  - Apenas admins podem remover membros.
   *  - Não é possível remover o único admin do grupo;
   *    promova outro membro antes.
   *
   * @throws {ForbiddenException} Se o solicitante não for admin.
   * @throws {NotFoundException} Se o membro-alvo não existir no grupo.
   * @throws {BadRequestException} Se o alvo for o único admin.
   */
  async removeMember(
    groupId: string,
    targetUserId: string,
    requesterId: string,
  ): Promise<void> {
    // 1. Verifica se o solicitante é admin
    const { data: requester } = await this.db
      .from('group_members')
      .select('role')
      .eq('group_id', groupId)
      .eq('user_id', requesterId)
      .single();

    if (!requester || (requester as { role: string }).role !== 'admin') {
      throw new ForbiddenException('Apenas admins podem remover membros');
    }

    // 2. Verifica se o alvo existe no grupo
    const { data: target } = await this.db
      .from('group_members')
      .select('role')
      .eq('group_id', groupId)
      .eq('user_id', targetUserId)
      .single();

    if (!target) throw new NotFoundException('Membro não encontrado no grupo');

    // 3. Se o alvo é admin, garante que não é o único
    if ((target as { role: string }).role === 'admin') {
      const { count } = await this.db
        .from('group_members')
        .select('*', { count: 'exact', head: true })
        .eq('group_id', groupId)
        .eq('role', 'admin');

      if (count === 1) {
        throw new BadRequestException(
          'Não é possível remover o único admin do grupo. Promova outro membro antes.',
        );
      }
    }

    // 4. Remove o membro
    const { error } = await this.db
      .from('group_members')
      .delete()
      .eq('group_id', groupId)
      .eq('user_id', targetUserId);

    if (error) throw new InternalServerErrorException('Erro ao remover membro');
  }
}
