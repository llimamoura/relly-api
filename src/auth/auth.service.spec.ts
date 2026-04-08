import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { SUPABASE_ADMIN_CLIENT, SUPABASE_CLIENT } from '../common/supabase.provider';

// ── Mocks ──────────────────────────────────────────────────────────────────
const mockSignUp = jest.fn();
const mockSignInWithPassword = jest.fn();
const mockAdminSignOut = jest.fn();

const mockSupabaseClient = {
  auth: {
    signUp: mockSignUp,
    signInWithPassword: mockSignInWithPassword,
  },
};

const mockSupabaseAdminClient = {
  auth: {
    admin: {
      signOut: mockAdminSignOut,
    },
  },
};

// ── Helpers ────────────────────────────────────────────────────────────────
function makeSession() {
  return {
    access_token: 'access-token-123',
    refresh_token: 'refresh-token-456',
  };
}

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-uuid-001',
    email: 'user@relly.app',
    user_metadata: { name: 'Relly User' },
    ...overrides,
  };
}

// ── Suite ──────────────────────────────────────────────────────────────────
describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: SUPABASE_CLIENT, useValue: mockSupabaseClient },
        { provide: SUPABASE_ADMIN_CLIENT, useValue: mockSupabaseAdminClient },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── register ─────────────────────────────────────────────────────────────
  describe('register', () => {
    it('sucesso: retorna AuthResponse com access_token, refresh_token e user', async () => {
      const session = makeSession();
      const user = makeUser();

      mockSignUp.mockResolvedValueOnce({
        data: { user, session },
        error: null,
      });

      const result = await service.register({
        email: 'user@relly.app',
        password: 'senha1234',
        name: 'Relly User',
      });

      expect(result).toEqual({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        user: {
          id: user.id,
          email: user.email,
          name: 'Relly User',
        },
      });

      expect(mockSignUp).toHaveBeenCalledWith({
        email: 'user@relly.app',
        password: 'senha1234',
        options: { data: { name: 'Relly User' } },
      });
    });

    it('e-mail duplicado: lança BadRequestException com mensagem do Supabase', async () => {
      mockSignUp.mockResolvedValueOnce({
        data: { user: null, session: null },
        error: { message: 'User already registered' },
      });

      await expect(
        service.register({
          email: 'dup@relly.app',
          password: 'senha1234',
          name: 'Dup User',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('sem sessão (email não confirmado): lança BadRequestException orientando o usuário', async () => {
      mockSignUp.mockResolvedValueOnce({
        data: { user: makeUser(), session: null },
        error: null,
      });

      await expect(
        service.register({
          email: 'noconfirm@relly.app',
          password: 'senha1234',
          name: 'No Confirm',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── login ─────────────────────────────────────────────────────────────────
  describe('login', () => {
    it('credenciais válidas: retorna AuthResponse com nome dos metadados', async () => {
      const session = makeSession();
      const user = makeUser();

      mockSignInWithPassword.mockResolvedValueOnce({
        data: { user, session },
        error: null,
      });

      const result = await service.login({
        email: 'user@relly.app',
        password: 'senha1234',
      });

      expect(result).toEqual({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        user: {
          id: user.id,
          email: user.email,
          name: 'Relly User',
        },
      });

      expect(mockSignInWithPassword).toHaveBeenCalledWith({
        email: 'user@relly.app',
        password: 'senha1234',
      });
    });

    it('credenciais inválidas: lança UnauthorizedException', async () => {
      mockSignInWithPassword.mockResolvedValueOnce({
        data: { user: null, session: null },
        error: { message: 'Invalid login credentials' },
      });

      await expect(
        service.login({
          email: 'wrong@relly.app',
          password: 'errada',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('erro sem mensagem específica: lança UnauthorizedException genérica', async () => {
      mockSignInWithPassword.mockResolvedValueOnce({
        data: { user: null, session: null },
        error: { message: 'Email not confirmed' },
      });

      await expect(
        service.login({ email: 'x@x.com', password: '12345678' }),
      ).rejects.toThrow('Credenciais inválidas');
    });
  });

  // ── logout ─────────────────────────────────────────────────────────────────
  describe('logout', () => {
    it('chama supabase admin signOut com o token fornecido', async () => {
      mockAdminSignOut.mockResolvedValueOnce({ error: null });

      await service.logout('my-jwt-token');

      expect(mockAdminSignOut).toHaveBeenCalledWith('my-jwt-token');
    });
  });
});
