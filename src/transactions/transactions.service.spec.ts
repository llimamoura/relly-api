import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { LedgerService } from '../ledger/ledger.service';
import { SUPABASE_ADMIN_CLIENT } from '../common/supabase.provider';

// ── Mock helpers ───────────────────────────────────────────────────────────

/**
 * Cria um builder encadeável do Supabase que é também awaitable diretamente.
 * Isso permite tanto `await db.from('x').select().eq().single()`
 * quanto `await db.from('x').select().eq()` (usado em listagens sem .single()).
 */
function createChain(result: { data: unknown; error: unknown }) {
  const resolve = () => Promise.resolve(result);

  const chain: Record<string, unknown> = {
    select:      jest.fn().mockReturnThis(),
    insert:      jest.fn().mockReturnThis(),
    update:      jest.fn().mockReturnThis(),
    delete:      jest.fn().mockReturnThis(),
    eq:          jest.fn().mockReturnThis(),
    is:          jest.fn().mockReturnThis(),
    gte:         jest.fn().mockReturnThis(),
    lte:         jest.fn().mockReturnThis(),
    order:       jest.fn().mockReturnThis(),
    range:       jest.fn().mockReturnThis(),
    single:      jest.fn().mockResolvedValue(result),
    then:        (ok: (v: unknown) => void, fail: (e: unknown) => void) =>
                   resolve().then(ok, fail),
    catch:       (fail: (e: unknown) => void) => resolve().catch(fail),
  };

  return chain;
}

// ── Fixtures ───────────────────────────────────────────────────────────────

const GROUP_ID    = 'group-uuid';
const PAYER_ID    = 'payer-uuid';
const MEMBER2_ID  = 'member2-uuid';
const TX_ID       = 'tx-uuid-001';
const CAT_ID      = 'cat-uuid-001';

function makeTxRow(overrides: Record<string, unknown> = {}) {
  return {
    id:          TX_ID,
    group_id:    GROUP_ID,
    payer_id:    PAYER_ID,
    category_id: CAT_ID,
    amount:      100.00,
    type:        'expense',
    is_advance:  false,
    description: null,
    occurred_at: new Date().toISOString(),
    created_at:  new Date().toISOString(),
    deleted_at:  null,
    categories:  { name: 'Mercado', type: 'expense' },
    ...overrides,
  };
}

// ── Setup ──────────────────────────────────────────────────────────────────

const mockRpc  = jest.fn();
const mockFrom = jest.fn();

const mockDb = { rpc: mockRpc, from: mockFrom };

const mockLedger = {
  deleteEntries: jest.fn(),
  populate:      jest.fn(),
};

describe('TransactionsService', () => {
  let service: TransactionsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionsService,
        { provide: SUPABASE_ADMIN_CLIENT, useValue: mockDb },
        { provide: LedgerService,         useValue: mockLedger },
      ],
    }).compile();

    service = module.get<TransactionsService>(TransactionsService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── Helpers ──────────────────────────────────────────────────────────────

  /** Configura mocks para o fluxo feliz de create sem splits. */
  function setupCreateMocks(txOverrides: Record<string, unknown> = {}) {
    // 1. assertMember → ok
    mockFrom.mockReturnValueOnce(createChain({ data: { user_id: PAYER_ID }, error: null }));
    // 2. category check → global (group_id = null)
    mockFrom.mockReturnValueOnce(createChain({ data: { group_id: null }, error: null }));
    // 3. RPC create_transaction_atomic → txId
    mockRpc.mockResolvedValueOnce({ data: TX_ID, error: null });
    // 4. fetchTransaction → transaction row
    mockFrom.mockReturnValueOnce(createChain({ data: makeTxRow(txOverrides), error: null }));
  }

  // ── create ───────────────────────────────────────────────────────────────

  describe('create', () => {
    it('income personal: chama RPC sem splits (ledger criará entry com user_id=payer)', async () => {
      setupCreateMocks({ type: 'income', is_advance: false });

      await service.create(GROUP_ID, PAYER_ID, {
        amount: 1000,
        type: 'income',
        category_id: CAT_ID,
        is_advance: false,
      });

      expect(mockRpc).toHaveBeenCalledWith(
        'create_transaction_atomic',
        expect.objectContaining({
          p_type:       'income',
          p_is_advance: false,
          p_splits:     [],
        }),
      );
    });

    it('income shared: chama RPC sem splits (ledger criará entry com user_id=NULL)', async () => {
      setupCreateMocks({ type: 'income', is_advance: false });

      await service.create(GROUP_ID, PAYER_ID, {
        amount: 2000,
        type: 'income',
        category_id: CAT_ID,
      });

      const args = mockRpc.mock.calls[0][1] as Record<string, unknown>;
      expect(args['p_splits']).toEqual([]);
    });

    it('expense is_advance=false: RPC sem splits (expense vai ao pool)', async () => {
      setupCreateMocks({ type: 'expense', is_advance: false });

      await service.create(GROUP_ID, PAYER_ID, {
        amount: 150,
        type: 'expense',
        is_advance: false,
        category_id: CAT_ID,
      });

      const args = mockRpc.mock.calls[0][1] as Record<string, unknown>;
      expect(args['p_splits']).toEqual([]);
    });

    it('expense is_advance=true: calcula splits e chama RPC com expense_paid+owed', async () => {
      // 1. assertMember
      mockFrom.mockReturnValueOnce(createChain({ data: { user_id: PAYER_ID }, error: null }));
      // 2. category check
      mockFrom.mockReturnValueOnce(createChain({ data: { group_id: null }, error: null }));
      // 3. group members list
      mockFrom.mockReturnValueOnce(
        createChain({
          data: [{ user_id: PAYER_ID }, { user_id: MEMBER2_ID }],
          error: null,
        }),
      );
      // 4. RPC
      mockRpc.mockResolvedValueOnce({ data: TX_ID, error: null });
      // 5. fetchTransaction
      mockFrom.mockReturnValueOnce(
        createChain({ data: makeTxRow({ is_advance: true }), error: null }),
      );

      await service.create(GROUP_ID, PAYER_ID, {
        amount: 100,
        type: 'expense',
        is_advance: true,
        category_id: CAT_ID,
      });

      const args = mockRpc.mock.calls[0][1] as Record<string, unknown>;
      const splits = args['p_splits'] as Array<{
        user_id: string;
        amount: number;
      }>;

      expect(splits).toHaveLength(2);
      expect(splits.find((s) => s.user_id === PAYER_ID)?.amount).toBe(50);
      expect(splits.find((s) => s.user_id === MEMBER2_ID)?.amount).toBe(50);
    });

    it('arredondamento: R$99,99 ÷ 2 pessoas → payer=50.00, outro=49.99', async () => {
      // 1. assertMember
      mockFrom.mockReturnValueOnce(createChain({ data: { user_id: PAYER_ID }, error: null }));
      // 2. category
      mockFrom.mockReturnValueOnce(createChain({ data: { group_id: null }, error: null }));
      // 3. members
      mockFrom.mockReturnValueOnce(
        createChain({
          data: [{ user_id: PAYER_ID }, { user_id: MEMBER2_ID }],
          error: null,
        }),
      );
      // 4. RPC
      mockRpc.mockResolvedValueOnce({ data: TX_ID, error: null });
      // 5. fetchTransaction
      mockFrom.mockReturnValueOnce(
        createChain({ data: makeTxRow({ amount: 99.99 }), error: null }),
      );

      await service.create(GROUP_ID, PAYER_ID, {
        amount: 99.99,
        type: 'expense',
        is_advance: true,
        category_id: CAT_ID,
      });

      const args = mockRpc.mock.calls[0][1] as Record<string, unknown>;
      const splits = args['p_splits'] as Array<{
        user_id: string;
        amount: number;
      }>;

      const payerSplit  = splits.find((s) => s.user_id === PAYER_ID)!;
      const memberSplit = splits.find((s) => s.user_id === MEMBER2_ID)!;

      expect(payerSplit.amount).toBe(50.00);
      expect(memberSplit.amount).toBe(49.99);
      // Soma deve ser exatamente igual ao total
      expect(payerSplit.amount + memberSplit.amount).toBeCloseTo(99.99, 2);
    });

    it('categoria de outro grupo: lança BadRequestException', async () => {
      const OTHER_GROUP = 'other-group-uuid';

      // 1. assertMember → ok
      mockFrom.mockReturnValueOnce(createChain({ data: { user_id: PAYER_ID }, error: null }));
      // 2. category → pertence a outro grupo
      mockFrom.mockReturnValueOnce(
        createChain({ data: { group_id: OTHER_GROUP }, error: null }),
      );

      await expect(
        service.create(GROUP_ID, PAYER_ID, {
          amount: 50,
          type: 'expense',
          category_id: CAT_ID,
        }),
      ).rejects.toThrow(BadRequestException);

      expect(mockRpc).not.toHaveBeenCalled();
    });

    it('categoria não encontrada: lança NotFoundException', async () => {
      // 1. assertMember → ok
      mockFrom.mockReturnValueOnce(createChain({ data: { user_id: PAYER_ID }, error: null }));
      // 2. category → not found
      mockFrom.mockReturnValueOnce(
        createChain({ data: null, error: { message: 'not found' } }),
      );

      await expect(
        service.create(GROUP_ID, PAYER_ID, {
          amount: 50,
          type: 'expense',
          category_id: 'nonexistent-uuid',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── remove ────────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('soft delete: chama ledger.deleteEntries com transactionId e userId', async () => {
      mockFrom.mockReturnValueOnce(createChain({ data: { user_id: PAYER_ID }, error: null }));
      mockLedger.deleteEntries.mockResolvedValueOnce(undefined);

      await service.remove(GROUP_ID, TX_ID, PAYER_ID);

      expect(mockLedger.deleteEntries).toHaveBeenCalledWith(TX_ID, PAYER_ID);
    });

    it('usuário fora do grupo: lança ForbiddenException sem chamar ledger', async () => {
      mockFrom.mockReturnValueOnce(createChain({ data: null, error: null }));

      await expect(service.remove(GROUP_ID, TX_ID, 'outsider-uuid')).rejects.toThrow(
        ForbiddenException,
      );

      expect(mockLedger.deleteEntries).not.toHaveBeenCalled();
    });
  });
});
