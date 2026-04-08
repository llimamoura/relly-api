import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { SUPABASE_ADMIN_CLIENT } from '../common/supabase.provider';
import { GroupsService } from '../groups/groups.service';

// ── Mock helpers ───────────────────────────────────────────────────────────

function createChain(result: { data: unknown; error: unknown; count?: number | null }) {
  const resolve = () => Promise.resolve(result);

  const chain: Record<string, unknown> = {
    select:  jest.fn().mockReturnThis(),
    insert:  jest.fn().mockReturnThis(),
    update:  jest.fn().mockReturnThis(),
    delete:  jest.fn().mockReturnThis(),
    eq:      jest.fn().mockReturnThis(),
    order:   jest.fn().mockReturnThis(),
    range:   jest.fn().mockReturnThis(),
    single:  jest.fn().mockResolvedValue(result),
    then:    (ok: (v: unknown) => void, fail: (e: unknown) => void) =>
               resolve().then(ok, fail),
    catch:   (fail: (e: unknown) => void) => resolve().catch(fail),
  };

  return chain;
}

// ── Fixtures ───────────────────────────────────────────────────────────────

const USER_ID    = 'user-uuid';
const OTHER_ID   = 'other-uuid';
const INVITER_ID = 'inviter-uuid';
const NOTIF_ID   = 'notif-uuid';
const INVITE_ID  = 'invite-uuid';
const INVITE_TOKEN = 'token-abc';
const GROUP_ID   = 'group-uuid';
const GROUP_NAME = 'Casa';

function makeNotifRow(overrides: Record<string, unknown> = {}) {
  return {
    id:         NOTIF_ID,
    user_id:    USER_ID,
    type:       'group_invite',
    title:      `Convite para ${GROUP_NAME}`,
    body:       'Alguém te convidou',
    data:       { group_id: GROUP_ID, group_name: GROUP_NAME, group_type: 'shared', invite_id: INVITE_ID, invited_by_name: 'Ana' },
    read:       false,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeInviteRow() {
  return { id: INVITE_ID, token: INVITE_TOKEN, invited_by: INVITER_ID, group_id: GROUP_ID };
}

function makeGroup(): import('../groups/groups.types').GroupWithMembers {
  return {
    id:      GROUP_ID,
    name:    GROUP_NAME,
    type:    'shared',
    members: [
      { userId: USER_ID, name: 'Bruno', role: 'member', splitShare: 50 },
      { userId: INVITER_ID, name: 'Ana', role: 'admin', splitShare: 50 },
    ],
  };
}

// ── Setup ──────────────────────────────────────────────────────────────────

const mockFrom = jest.fn();
const mockDb   = { from: mockFrom };

const mockGroupsService = {
  acceptInvite: jest.fn(),
};

describe('NotificationsService', () => {
  let service: NotificationsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: SUPABASE_ADMIN_CLIENT, useValue: mockDb },
        { provide: GroupsService,         useValue: mockGroupsService },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── accept ────────────────────────────────────────────────────────────────

  describe('accept', () => {
    it('chama groupsService.acceptInvite com token e userId corretos', async () => {
      mockGroupsService.acceptInvite.mockResolvedValueOnce(makeGroup());
      jest.spyOn(service, 'create').mockResolvedValue(undefined as never);

      mockFrom
        .mockReturnValueOnce(createChain({ data: makeNotifRow(), error: null })) // fetch notif
        .mockReturnValueOnce(createChain({ data: makeInviteRow(), error: null })) // fetch invite
        .mockReturnValueOnce(createChain({ data: null, error: null }));           // update notif read

      await service.accept(NOTIF_ID, USER_ID);

      expect(mockGroupsService.acceptInvite).toHaveBeenCalledWith(INVITE_TOKEN, USER_ID);
    });

    it('cria notificação invite_accepted para o convidante', async () => {
      mockGroupsService.acceptInvite.mockResolvedValueOnce(makeGroup());
      const createSpy = jest.spyOn(service, 'create').mockResolvedValue(undefined as never);

      mockFrom
        .mockReturnValueOnce(createChain({ data: makeNotifRow(), error: null }))
        .mockReturnValueOnce(createChain({ data: makeInviteRow(), error: null }))
        .mockReturnValueOnce(createChain({ data: null, error: null }));

      await service.accept(NOTIF_ID, USER_ID);

      expect(createSpy).toHaveBeenCalledWith(
        INVITER_ID,
        'invite_accepted',
        expect.stringContaining('Bruno'),
        expect.stringContaining(GROUP_NAME),
        expect.objectContaining({ group_id: GROUP_ID, accepted_by_name: 'Bruno' }),
      );
    });

    it('marca notificação original como lida', async () => {
      mockGroupsService.acceptInvite.mockResolvedValueOnce(makeGroup());
      jest.spyOn(service, 'create').mockResolvedValue(undefined as never);

      const updateChain = createChain({ data: null, error: null });
      mockFrom
        .mockReturnValueOnce(createChain({ data: makeNotifRow(), error: null }))
        .mockReturnValueOnce(createChain({ data: makeInviteRow(), error: null }))
        .mockReturnValueOnce(updateChain);

      await service.accept(NOTIF_ID, USER_ID);

      expect(updateChain.update as jest.Mock).toHaveBeenCalledWith({ read: true });
      expect(updateChain.eq as jest.Mock).toHaveBeenCalledWith('id', NOTIF_ID);
    });

    it('notificação de outro usuário lança ForbiddenException', async () => {
      mockFrom.mockReturnValueOnce(
        createChain({ data: makeNotifRow({ user_id: OTHER_ID }), error: null }),
      );

      await expect(service.accept(NOTIF_ID, USER_ID)).rejects.toThrow(ForbiddenException);
    });

    it('notificação com type != group_invite lança BadRequestException', async () => {
      mockFrom.mockReturnValueOnce(
        createChain({ data: makeNotifRow({ type: 'invite_accepted' }), error: null }),
      );

      await expect(service.accept(NOTIF_ID, USER_ID)).rejects.toThrow(BadRequestException);
    });

    it('notificação não encontrada lança NotFoundException', async () => {
      mockFrom.mockReturnValueOnce(createChain({ data: null, error: null }));

      await expect(service.accept(NOTIF_ID, USER_ID)).rejects.toThrow(NotFoundException);
    });
  });

  // ── decline ───────────────────────────────────────────────────────────────

  describe('decline', () => {
    it('atualiza status do invite para declined', async () => {
      const inviteUpdateChain = createChain({ data: null, error: null });

      mockFrom
        .mockReturnValueOnce(createChain({ data: makeNotifRow(), error: null }))  // fetch notif
        .mockReturnValueOnce(inviteUpdateChain)                                    // update invite
        .mockReturnValueOnce(createChain({ data: null, error: null }));            // update notif read

      await service.decline(NOTIF_ID, USER_ID);

      expect(inviteUpdateChain.update as jest.Mock).toHaveBeenCalledWith({ status: 'declined' });
      expect(inviteUpdateChain.eq as jest.Mock).toHaveBeenCalledWith('id', INVITE_ID);
    });

    it('NÃO cria notificação para o convidante', async () => {
      const createSpy = jest.spyOn(service, 'create').mockResolvedValue(undefined as never);

      mockFrom
        .mockReturnValueOnce(createChain({ data: makeNotifRow(), error: null }))
        .mockReturnValueOnce(createChain({ data: null, error: null }))
        .mockReturnValueOnce(createChain({ data: null, error: null }));

      await service.decline(NOTIF_ID, USER_ID);

      expect(createSpy).not.toHaveBeenCalled();
    });

    it('marca notificação original como lida', async () => {
      const readUpdateChain = createChain({ data: null, error: null });

      mockFrom
        .mockReturnValueOnce(createChain({ data: makeNotifRow(), error: null }))
        .mockReturnValueOnce(createChain({ data: null, error: null }))
        .mockReturnValueOnce(readUpdateChain);

      await service.decline(NOTIF_ID, USER_ID);

      expect(readUpdateChain.update as jest.Mock).toHaveBeenCalledWith({ read: true });
      expect(readUpdateChain.eq as jest.Mock).toHaveBeenCalledWith('id', NOTIF_ID);
    });
  });

  // ── findAll ───────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('retorna unread_count correto', async () => {
      mockFrom
        .mockReturnValueOnce(createChain({ data: [makeNotifRow()], error: null })) // list
        .mockReturnValueOnce(createChain({ data: null, error: null, count: 5 }));  // unread count

      const result = await service.findAll(USER_ID, {});

      expect(result.unread_count).toBe(5);
      expect(result.notifications).toHaveLength(1);
    });

    it('filtro unread_only aplica eq(read, false) na query', async () => {
      const listChain = createChain({ data: [], error: null });
      mockFrom
        .mockReturnValueOnce(listChain)
        .mockReturnValueOnce(createChain({ data: null, error: null, count: 0 }));

      await service.findAll(USER_ID, { unread_only: true });

      expect(listChain.eq as jest.Mock).toHaveBeenCalledWith('read', false);
    });
  });
});
