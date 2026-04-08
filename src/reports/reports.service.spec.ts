import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { SUPABASE_ADMIN_CLIENT } from '../common/supabase.provider';

// ── Mock helpers ───────────────────────────────────────────────────────────

function createChain(result: { data: unknown; error: unknown; count?: number | null }) {
  const resolve = () => Promise.resolve(result);

  const chain: Record<string, unknown> = {
    select:  jest.fn().mockReturnThis(),
    eq:      jest.fn().mockReturnThis(),
    gte:     jest.fn().mockReturnThis(),
    lte:     jest.fn().mockReturnThis(),
    single:  jest.fn().mockResolvedValue(result),
    then:    (ok: (v: unknown) => void, fail: (e: unknown) => void) =>
               resolve().then(ok, fail),
    catch:   (fail: (e: unknown) => void) => resolve().catch(fail),
  };

  return chain;
}

// ── Fixtures ───────────────────────────────────────────────────────────────

const GROUP_ID   = 'group-uuid';
const USER_ID    = 'user-uuid';
const OTHER_USER = 'other-uuid';

const personalGroup = { id: GROUP_ID, name: 'Pessoal', type: 'personal' };
const sharedGroup   = { id: GROUP_ID, name: 'Família', type: 'shared'   };

// Ledger entries for a personal group: income (user) + expense (user)
const personalLedger = [
  { entry_type: 'income',  amount: 3000, user_id: USER_ID,    transaction: { category: { id: 'c1', name: 'Salário' } } },
  { entry_type: 'expense', amount:  500, user_id: USER_ID,    transaction: { category: { id: 'c2', name: 'Mercado' } } },
  { entry_type: 'expense', amount:  200, user_id: OTHER_USER, transaction: { category: { id: 'c2', name: 'Mercado' } } },
];

// Ledger entries for a shared group (no advances)
const sharedLedgerNoAdvances = [
  { entry_type: 'income',  amount: 5000, user_id: null, transaction: { category: { id: 'c1', name: 'Salário' } } },
  { entry_type: 'expense', amount: 1200, user_id: null, transaction: { category: { id: 'c3', name: 'Aluguel' } } },
];

// Ledger entries for a shared group (with advances)
const sharedLedgerWithAdvances = [
  ...sharedLedgerNoAdvances,
  { entry_type: 'expense_paid', amount: 400, user_id: USER_ID,    transaction: { category: { id: 'c2', name: 'Mercado' } } },
  { entry_type: 'expense_owed', amount: 200, user_id: OTHER_USER, transaction: { category: { id: 'c2', name: 'Mercado' } } },
  { entry_type: 'expense_owed', amount: 200, user_id: USER_ID,    transaction: { category: { id: 'c2', name: 'Mercado' } } },
];

// ── Setup ──────────────────────────────────────────────────────────────────

const mockFrom = jest.fn();
const mockDb   = { from: mockFrom };

describe('ReportsService', () => {
  let service: ReportsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: SUPABASE_ADMIN_CLIENT, useValue: mockDb },
      ],
    }).compile();

    service = module.get<ReportsService>(ReportsService);
    jest.useFakeTimers().setSystemTime(new Date('2024-06-15T12:00:00Z').getTime());
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  // ── getSummary — personal ─────────────────────────────────────────────────

  describe('getSummary — personal group', () => {
    it('retorna personal section com income/expense filtrados pelo userId', async () => {
      // 1. assertMember
      mockFrom.mockReturnValueOnce(createChain({ data: { user_id: USER_ID }, error: null }));
      // 2. group
      mockFrom.mockReturnValueOnce(createChain({ data: personalGroup, error: null }));
      // 3. ledger
      mockFrom.mockReturnValueOnce(createChain({ data: personalLedger, error: null }));

      const result = await service.getSummary(GROUP_ID, USER_ID, {});

      expect(result.personal).toBeDefined();
      expect(result.pool).toBeUndefined();
      expect(result.personal!.totalIncome).toBe(3000);
      expect(result.personal!.totalExpenses).toBe(500);  // only USER_ID
      expect(result.personal!.balance).toBeCloseTo(2500);
    });
  });

  // ── getSummary — shared sem advances ─────────────────────────────────────

  describe('getSummary — shared group sem advances', () => {
    it('retorna pool section sem members quando não há advances', async () => {
      mockFrom.mockReturnValueOnce(createChain({ data: { user_id: USER_ID }, error: null }));
      mockFrom.mockReturnValueOnce(createChain({ data: sharedGroup, error: null }));
      mockFrom.mockReturnValueOnce(createChain({ data: sharedLedgerNoAdvances, error: null }));

      const result = await service.getSummary(GROUP_ID, USER_ID, {});

      expect(result.pool).toBeDefined();
      expect(result.personal).toBeUndefined();
      expect(result.members).toBeUndefined();
      expect(result.pool!.totalIncome).toBe(5000);
      expect(result.pool!.totalExpenses).toBe(1200);
      expect(result.pool!.balance).toBeCloseTo(3800);
    });
  });

  // ── getSummary — shared com advances ─────────────────────────────────────

  describe('getSummary — shared group com advances', () => {
    it('retorna pool + members quando há expense_paid/expense_owed', async () => {
      mockFrom.mockReturnValueOnce(createChain({ data: { user_id: USER_ID }, error: null }));
      mockFrom.mockReturnValueOnce(createChain({ data: sharedGroup, error: null }));
      mockFrom.mockReturnValueOnce(createChain({ data: sharedLedgerWithAdvances, error: null }));

      const result = await service.getSummary(GROUP_ID, USER_ID, {});

      expect(result.members).toBeDefined();
      expect(result.members!.length).toBeGreaterThan(0);

      const userAdvance = result.members!.find((m) => m.userId === USER_ID);
      expect(userAdvance).toBeDefined();
      expect(userAdvance!.paid).toBe(400);
      expect(userAdvance!.owed).toBe(200);
      expect(userAdvance!.net).toBeCloseTo(200);
    });
  });

  // ── ForbiddenException ────────────────────────────────────────────────────

  describe('assertMember', () => {
    it('lança ForbiddenException se usuário não é membro', async () => {
      mockFrom.mockReturnValueOnce(createChain({ data: null, error: null }));

      await expect(service.getSummary(GROUP_ID, 'stranger', {})).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // ── período padrão ────────────────────────────────────────────────────────

  describe('período padrão', () => {
    it('usa início do mês atual e fim de hoje quando from/to não são fornecidos', async () => {
      mockFrom.mockReturnValueOnce(createChain({ data: { user_id: USER_ID }, error: null }));
      mockFrom.mockReturnValueOnce(createChain({ data: personalGroup, error: null }));
      const chainSpy = createChain({ data: [], error: null });
      mockFrom.mockReturnValueOnce(chainSpy);

      await service.getSummary(GROUP_ID, USER_ID, {});

      // gte should be called with start of 2024-06-01
      expect(chainSpy.gte as jest.Mock).toHaveBeenCalledWith(
        'created_at',
        expect.stringContaining('2024-06-01'),
      );
      // lte should be called with a timestamp on or shortly after 2024-06-15 (timezone-safe)
      expect(chainSpy.lte as jest.Mock).toHaveBeenCalledWith(
        'created_at',
        expect.stringMatching(/^2024-06-1[56]/),
      );
    });
  });
});
