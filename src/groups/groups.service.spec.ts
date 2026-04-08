import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { GroupsService } from './groups.service';
import { SUPABASE_ADMIN_CLIENT } from '../common/supabase.provider';
import { NotificationsService } from '../notifications/notifications.service';

// ── Mock helpers ───────────────────────────────────────────────────────────

/**
 * Cria um mock de builder encadeável do Supabase.
 * Implementa `then`/`catch` para ser awaitable diretamente (ex: count queries)
 * além de expor `.single()` para queries que retornam um único registro.
 */
function createChain(result: { data: unknown; error: unknown; count?: number | null }) {
  const resolve = () => Promise.resolve(result);

  const chain: Record<string, unknown> = {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    eq:     jest.fn().mockReturnThis(),
    neq:    jest.fn().mockReturnThis(),
    in:     jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue(result),
    then:   (ok: (v: unknown) => void, fail: (e: unknown) => void) =>
              resolve().then(ok, fail),
    catch:  (fail: (e: unknown) => void) => resolve().catch(fail),
  };

  return chain;
}

// Instâncias reutilizadas nos testes
const mockRpc  = jest.fn();
const mockFrom = jest.fn();

const mockDb = {
  rpc:  mockRpc,
  from: mockFrom,
};

const mockNotificationsService = {
  create: jest.fn().mockResolvedValue(undefined),
};

// ── Dados de exemplo ───────────────────────────────────────────────────────

const REQUESTER_ID = 'req-user-uuid';
const TARGET_ID    = 'tgt-user-uuid';
const GROUP_ID     = 'group-uuid-001';
const TOKEN        = 'invite-token-abc';
const INVITE_ID    = 'invite-uuid-001';
const TARGET_EMAIL = 'bruno@email.com';

function makeGroupRow(overrides: Record<string, unknown> = {}) {
  return {
    id:   GROUP_ID,
    name: 'Casal Teste',
    type: 'couple',
    group_members: [
      {
        user_id:     REQUESTER_ID,
        role:        'admin',
        split_share: 50,
        users:       { name: 'Req User' },
      },
    ],
    ...overrides,
  };
}

function makeGroupInfo(maxMembers = 2) {
  return { id: GROUP_ID, name: 'Casal Teste', type: 'couple', max_members: maxMembers };
}

// ── Suite ──────────────────────────────────────────────────────────────────

describe('GroupsService', () => {
  let service: GroupsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GroupsService,
        { provide: SUPABASE_ADMIN_CLIENT,   useValue: mockDb },
        { provide: NotificationsService,    useValue: mockNotificationsService },
      ],
    }).compile();

    service = module.get<GroupsService>(GroupsService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── create ──────────────────────────────────────────────────────────────

  describe('create', () => {
    it('cria grupo couple atomicamente via RPC e retorna GroupWithMembers', async () => {
      // RPC cria grupo e retorna o ID
      mockRpc.mockResolvedValueOnce({ data: GROUP_ID, error: null });

      // findOne chamado internamente após o RPC
      mockFrom.mockReturnValueOnce(
        createChain({ data: makeGroupRow(), error: null }),
      );

      const result = await service.create(REQUESTER_ID, {
        name: 'Casal Teste',
        type: 'couple',
      });

      expect(mockRpc).toHaveBeenCalledWith('create_group_atomic', {
        p_name:        'Casal Teste',
        p_type:        'couple',
        p_owner_id:    REQUESTER_ID,
        p_max_members: 2,
        p_split_share: 100,
      });

      expect(result.id).toBe(GROUP_ID);
      expect(result.type).toBe('couple');
      expect(result.members[0].role).toBe('admin');
    });

    it("tipo 'personal' lança BadRequestException sem chamar o banco", async () => {
      await expect(
        service.create(REQUESTER_ID, { name: 'Casa', type: 'personal' as never }),
      ).rejects.toThrow(BadRequestException);

      expect(mockRpc).not.toHaveBeenCalled();
    });
  });

  // ── generateInvite ───────────────────────────────────────────────────────

  describe('generateInvite', () => {
    it('membro sem role admin lança ForbiddenException', async () => {
      mockFrom.mockReturnValueOnce(
        createChain({ data: { role: 'member' }, error: null }),
      );

      await expect(
        service.generateInvite(GROUP_ID, REQUESTER_ID),
      ).rejects.toThrow(ForbiddenException);
    });

    it('admin sem email gera link de convite (delivery = link)', async () => {
      const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();

      mockFrom
        .mockReturnValueOnce(createChain({ data: { role: 'admin' }, error: null }))             // admin check
        .mockReturnValueOnce(createChain({ data: makeGroupInfo(), error: null }))               // group info
        .mockReturnValueOnce(createChain({ data: null, error: null, count: 1 }))               // capacity count
        .mockReturnValueOnce(createChain({ data: { token: TOKEN, expires_at: expiresAt }, error: null })); // invite insert

      const result = await service.generateInvite(GROUP_ID, REQUESTER_ID);

      expect(result.delivery).toBe('link');
      expect(result.invite_url).toContain(TOKEN);
      expect(result.expires_at).toBe(expiresAt);
    });

    it('grupo cheio lança BadRequestException antes de qualquer outra validação', async () => {
      mockFrom
        .mockReturnValueOnce(createChain({ data: { role: 'admin' }, error: null }))   // admin check
        .mockReturnValueOnce(createChain({ data: makeGroupInfo(2), error: null }))     // group info
        .mockReturnValueOnce(createChain({ data: null, error: null, count: 2 }));      // capacity = max

      await expect(
        service.generateInvite(GROUP_ID, REQUESTER_ID, { email: TARGET_EMAIL }),
      ).rejects.toThrow(BadRequestException);

      // não deve chegar a buscar usuário por email
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it('email de usuário existente → delivery = notification, cria notificação', async () => {
      const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();

      mockFrom
        .mockReturnValueOnce(createChain({ data: { role: 'admin' }, error: null }))        // admin check
        .mockReturnValueOnce(createChain({ data: makeGroupInfo(), error: null }))           // group info
        .mockReturnValueOnce(createChain({ data: null, error: null, count: 1 }))           // capacity
        .mockReturnValueOnce(createChain({ data: null, error: null }))                     // already member? → null
        .mockReturnValueOnce(createChain({ data: { id: INVITE_ID, expires_at: expiresAt }, error: null })) // invite insert
        .mockReturnValueOnce(createChain({ data: { name: 'Ana' }, error: null }));          // inviter name

      mockRpc.mockResolvedValueOnce({
        data:  [{ id: TARGET_ID, name: 'Bruno' }],
        error: null,
      });

      const result = await service.generateInvite(GROUP_ID, REQUESTER_ID, { email: TARGET_EMAIL });

      expect(result.delivery).toBe('notification');
      expect(result.message).toContain(TARGET_EMAIL);
      expect(mockNotificationsService.create).toHaveBeenCalledWith(
        TARGET_ID,
        'group_invite',
        expect.stringContaining('Casal Teste'),
        expect.any(String),
        expect.objectContaining({ invite_id: INVITE_ID, group_id: GROUP_ID }),
      );
    });

    it('email de usuário inexistente → delivery = link com fallback automático', async () => {
      const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();

      mockFrom
        .mockReturnValueOnce(createChain({ data: { role: 'admin' }, error: null }))
        .mockReturnValueOnce(createChain({ data: makeGroupInfo(), error: null }))
        .mockReturnValueOnce(createChain({ data: null, error: null, count: 1 }))
        .mockReturnValueOnce(createChain({ data: { token: TOKEN, expires_at: expiresAt }, error: null }));

      mockRpc.mockResolvedValueOnce({ data: [], error: null }); // user not found

      const result = await service.generateInvite(GROUP_ID, REQUESTER_ID, { email: 'inexistente@x.com' });

      expect(result.delivery).toBe('link');
      expect(mockNotificationsService.create).not.toHaveBeenCalled();
    });

    it('use_link = true gera link independente do email', async () => {
      const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();

      mockFrom
        .mockReturnValueOnce(createChain({ data: { role: 'admin' }, error: null }))
        .mockReturnValueOnce(createChain({ data: makeGroupInfo(), error: null }))
        .mockReturnValueOnce(createChain({ data: null, error: null, count: 1 }))
        .mockReturnValueOnce(createChain({ data: { token: TOKEN, expires_at: expiresAt }, error: null }));

      const result = await service.generateInvite(GROUP_ID, REQUESTER_ID, {
        email:    TARGET_EMAIL,
        use_link: true,
      });

      expect(result.delivery).toBe('link');
      // não deve buscar usuário por email
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it('usuário já é membro lança ConflictException', async () => {
      mockFrom
        .mockReturnValueOnce(createChain({ data: { role: 'admin' }, error: null }))
        .mockReturnValueOnce(createChain({ data: makeGroupInfo(), error: null }))
        .mockReturnValueOnce(createChain({ data: null, error: null, count: 1 }))
        .mockReturnValueOnce(createChain({ data: { user_id: TARGET_ID }, error: null })); // already member

      mockRpc.mockResolvedValueOnce({ data: [{ id: TARGET_ID, name: 'Bruno' }], error: null });

      await expect(
        service.generateInvite(GROUP_ID, REQUESTER_ID, { email: TARGET_EMAIL }),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ── acceptInvite ─────────────────────────────────────────────────────────

  describe('acceptInvite', () => {
    it('token expirado: RPC lança erro → BadRequestException', async () => {
      mockRpc.mockResolvedValueOnce({
        data:  null,
        error: { message: 'Este convite expirou.' },
      });

      await expect(
        service.acceptInvite(TOKEN, TARGET_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('grupo cheio: trigger lança erro → BadRequestException', async () => {
      mockRpc.mockResolvedValueOnce({
        data:  null,
        error: { message: 'O grupo "Casal Teste" atingiu o limite máximo de 2 membro(s).' },
      });

      await expect(
        service.acceptInvite(TOKEN, TARGET_ID),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── removeMember ─────────────────────────────────────────────────────────

  describe('removeMember', () => {
    it('tenta remover único admin → lança BadRequestException', async () => {
      // 1. Solicitante é admin
      mockFrom.mockReturnValueOnce(
        createChain({ data: { role: 'admin' }, error: null }),
      );
      // 2. Alvo também é admin
      mockFrom.mockReturnValueOnce(
        createChain({ data: { role: 'admin' }, error: null }),
      );
      // 3. Contagem de admins no grupo = 1
      mockFrom.mockReturnValueOnce(
        createChain({ data: null, error: null, count: 1 }),
      );

      await expect(
        service.removeMember(GROUP_ID, TARGET_ID, REQUESTER_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('solicitante sem permissão de admin lança ForbiddenException', async () => {
      mockFrom.mockReturnValueOnce(
        createChain({ data: { role: 'member' }, error: null }),
      );

      await expect(
        service.removeMember(GROUP_ID, TARGET_ID, REQUESTER_ID),
      ).rejects.toThrow(ForbiddenException);
    });

    it('alvo não encontrado no grupo lança NotFoundException', async () => {
      // Solicitante é admin
      mockFrom.mockReturnValueOnce(
        createChain({ data: { role: 'admin' }, error: null }),
      );
      // Alvo não existe
      mockFrom.mockReturnValueOnce(
        createChain({ data: null, error: { message: 'not found' } }),
      );

      await expect(
        service.removeMember(GROUP_ID, TARGET_ID, REQUESTER_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
