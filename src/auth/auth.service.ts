import {
  BadRequestException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN_CLIENT, SUPABASE_CLIENT } from '../common/supabase.provider';
import { LoginDto, RegisterDto } from './auth.dto';
import { AuthResponse } from './auth.types';

@Injectable()
export class AuthService {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
    @Inject(SUPABASE_ADMIN_CLIENT) private readonly supabaseAdmin: SupabaseClient,
  ) {}

  /**
   * Cria uma nova conta via Supabase Auth.
   * O nome do usuário é passado em `options.data` e persistido nos metadados
   * do auth.user, sendo capturado pelo trigger `handle_new_user` para popular
   * a tabela `public.users`.
   *
   * @throws {BadRequestException} Se o Supabase retornar erro (ex: e-mail já cadastrado).
   * @throws {BadRequestException} Se não houver sessão — indica que confirmação de e-mail está ativa.
   */
  async register(dto: RegisterDto): Promise<AuthResponse> {
    const { data, error } = await this.supabase.auth.signUp({
      email: dto.email,
      password: dto.password,
      options: { data: { name: dto.name } },
    });

    if (error) {
      throw new BadRequestException(error.message);
    }

    if (!data.session || !data.user) {
      throw new BadRequestException(
        'Conta criada. Verifique seu e-mail para confirmar o cadastro antes de fazer login.',
      );
    }

    return {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      user: {
        id: data.user.id,
        email: data.user.email ?? dto.email,
        name: dto.name,
      },
    };
  }

  /**
   * Autentica o usuário com e-mail e senha.
   * Mapeia qualquer erro do Supabase para UnauthorizedException para
   * não vazar informações sobre quais e-mails estão cadastrados.
   *
   * @throws {UnauthorizedException} Se as credenciais forem inválidas.
   */
  async login(dto: LoginDto): Promise<AuthResponse> {
    const { data, error } = await this.supabase.auth.signInWithPassword({
      email: dto.email,
      password: dto.password,
    });

    if (error ?? !data.session) {
      throw new UnauthorizedException('Credenciais inválidas');
    }

    const name = (data.user.user_metadata['name'] as string | undefined) ?? data.user.email ?? '';

    return {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      user: {
        id: data.user.id,
        email: data.user.email ?? dto.email,
        name,
      },
    };
  }

  /**
   * Invalida o JWT fornecido via Supabase Admin API.
   * Usa o client service_role para forçar o logout mesmo que o token
   * ainda esteja dentro do período de validade.
   *
   * @param token - Bearer token extraído do header Authorization.
   */
  async logout(token: string): Promise<void> {
    await this.supabaseAdmin.auth.admin.signOut(token);
  }
}
