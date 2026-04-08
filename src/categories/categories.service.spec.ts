import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { SUPABASE_ADMIN_CLIENT } from '../common/supabase.provider';

// ── Mock helpers ───────────────────────────────────────────────────────────

function createChain(result: { data: unknown; error: unknown; count?: number | null }) {
  const resolve = () => Promise.resolve(result);

  const chain: Record<string, unknown> = {
    select:  jest.fn().mockReturnThis(),
    insert:  jest.fn().mockReturnThis(),
    update:  jest.fn().mockReturnThis(),
    delete:  jest.fn().mockReturnThis(),
    eq:      jest.fn().mockReturnThis(),
    is:      jest.fn().mockReturnThis(),
    or:      jest.fn().mockReturnThis(),
    order:   jest.fn().mockReturnThis(),
    single:  jest.fn().mockResolvedValue(result),
    then:    (ok: (v: unknown) => void, fail: (e: unknown) => void) =>
               resolve().then(ok, fail),
    catch:   (fail: (e: unknown) => void) => resolve().catch(fail),
  };

  return chain;
}

// ── Fixtures ───────────────────────────────────────────────────────────────

const GROUP_ID    = 'group-uuid';
const USER_ID     = 'user-uuid';
const CAT_ID      = 'cat-uuid';

const globalCat = { id: 'global-1', name: 'Salário',  type: 'income',  icon: null, group_id: null,     created_at: '' };
const groupCat  = { id: CAT_ID,     name: 'Mercado',  type: 'expense', icon: null, group_id: GROUP_ID, created_at: '' };
const otherCat  = { id: 'other-1',  name: 'Lazer',    type: 'expense', icon: null, group_id: 'other',  created_at: '' };

// ── Setup ──────────────────────────────────────────────────────────────────

const mockFrom = jest.fn();
const mockDb   = { from: mockFrom };

describe('CategoriesService', () => {
  let service: CategoriesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategoriesService,
        { provide: SUPABASE_ADMIN_CLIENT, useValue: mockDb },
      ],
    }).compile();

    service = module.get<CategoriesService>(CategoriesService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── findAll ───────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('retorna globais + do grupo, nunca de outros grupos', async () => {
      // 1. assertMember → ok
      mockFrom.mockReturnValueOnce(createChain({ data: { user_id: USER_ID }, error: null }));
      // 2. query com .or() → retorna global + group (banco já filtra com .or())
      mockFrom.mockReturnValueOnce(
        createChain({ data: [globalCat, groupCat], error: null }),
      );

      const result = await service.findAll(GROUP_ID, USER_ID);

      expect(result).toHaveLength(2);
      expect(result.some((c) => c.id === 'global-1')).toBe(true);
      expect(result.some((c) => c.id === CAT_ID)).toBe(true);
      // Categoria de outro grupo nunca aparece
      expect(result.some((c) => c.id === otherCat.id)).toBe(false);
    });

    it('o filtro .or() é aplicado com group_id do grupo correto', async () => {
      mockFrom.mockReturnValueOnce(createChain({ data: { user_id: USER_ID }, error: null }));
      const chainSpy = createChain({ data: [], error: null });
      mockFrom.mockReturnValueOnce(chainSpy);

      await service.findAll(GROUP_ID, USER_ID);

      // Verifica que .or() foi chamado com o filtro correto
      expect(chainSpy.or as jest.Mock).toHaveBeenCalledWith(
        `group_id.is.null,group_id.eq.${GROUP_ID}`,
      );
    });
  });

  // ── create ────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('membro cria categoria do grupo com sucesso', async () => {
      mockFrom.mockReturnValueOnce(createChain({ data: { user_id: USER_ID }, error: null }));
      mockFrom.mockReturnValueOnce(createChain({ data: groupCat, error: null }));

      const result = await service.create(GROUP_ID, USER_ID, {
        name: 'Mercado',
        type: 'expense',
      });

      expect(result.group_id).toBe(GROUP_ID);
      expect(result.name).toBe('Mercado');
    });
  });

  // ── update ────────────────────────────────────────────────────────────────

  describe('update', () => {
    it('categoria global lança ForbiddenException', async () => {
      // 1. assertMember → ok
      mockFrom.mockReturnValueOnce(createChain({ data: { user_id: USER_ID }, error: null }));
      // 2. fetch category → global (group_id = null)
      mockFrom.mockReturnValueOnce(createChain({ data: { group_id: null }, error: null }));

      await expect(
        service.update(GROUP_ID, 'global-cat-id', USER_ID, { name: 'Novo Nome' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('membro atualiza categoria do grupo com sucesso', async () => {
      const updated = { ...groupCat, name: 'Supermercado' };
      // 1. assertMember
      mockFrom.mockReturnValueOnce(createChain({ data: { user_id: USER_ID }, error: null }));
      // 2. fetch category → group-owned
      mockFrom.mockReturnValueOnce(createChain({ data: { group_id: GROUP_ID }, error: null }));
      // 3. update → updated row
      mockFrom.mockReturnValueOnce(createChain({ data: updated, error: null }));

      const result = await service.update(GROUP_ID, CAT_ID, USER_ID, { name: 'Supermercado' });

      expect(result.name).toBe('Supermercado');
    });
  });

  // ── remove ────────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('categoria global lança ForbiddenException', async () => {
      mockFrom.mockReturnValueOnce(createChain({ data: { user_id: USER_ID }, error: null }));
      mockFrom.mockReturnValueOnce(createChain({ data: { group_id: null }, error: null }));

      await expect(service.remove(GROUP_ID, 'global-cat-id', USER_ID)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('categoria em uso por transações lança ConflictException com contagem', async () => {
      // 1. assertMember → ok
      mockFrom.mockReturnValueOnce(createChain({ data: { user_id: USER_ID }, error: null }));
      // 2. fetch category → group-owned
      mockFrom.mockReturnValueOnce(createChain({ data: { group_id: GROUP_ID }, error: null }));
      // 3. count transactions → 3 em uso
      mockFrom.mockReturnValueOnce(createChain({ data: null, error: null, count: 3 }));

      await expect(service.remove(GROUP_ID, CAT_ID, USER_ID)).rejects.toThrow(
        ConflictException,
      );
    });

    it('mensagem do ConflictException inclui a quantidade de transações', async () => {
      mockFrom.mockReturnValueOnce(createChain({ data: { user_id: USER_ID }, error: null }));
      mockFrom.mockReturnValueOnce(createChain({ data: { group_id: GROUP_ID }, error: null }));
      mockFrom.mockReturnValueOnce(createChain({ data: null, error: null, count: 5 }));

      await expect(service.remove(GROUP_ID, CAT_ID, USER_ID)).rejects.toThrow(
        /5 transação/,
      );
    });

    it('categoria sem uso é removida com sucesso', async () => {
      mockFrom.mockReturnValueOnce(createChain({ data: { user_id: USER_ID }, error: null }));
      mockFrom.mockReturnValueOnce(createChain({ data: { group_id: GROUP_ID }, error: null }));
      // count = 0 → sem uso
      mockFrom.mockReturnValueOnce(createChain({ data: null, error: null, count: 0 }));
      // delete → ok
      mockFrom.mockReturnValueOnce(createChain({ data: null, error: null }));

      await expect(service.remove(GROUP_ID, CAT_ID, USER_ID)).resolves.toBeUndefined();
    });
  });
});
