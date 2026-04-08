import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Cria um Supabase client autenticado com o JWT do usuário.
 * Use em operações que devem respeitar as RLS policies do banco.
 */
export function createUserClient(
  supabaseUrl: string,
  supabaseAnonKey: string,
  userToken: string,
): SupabaseClient {
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${userToken}` } },
    auth:   { autoRefreshToken: false, persistSession: false },
  });
}

export const SUPABASE_CLIENT = 'SUPABASE_CLIENT';
export const SUPABASE_ADMIN_CLIENT = 'SUPABASE_ADMIN_CLIENT';

/** Client com anon key — usado para operações em nome do usuário autenticado. */
export const SupabaseProvider: Provider = {
  provide: SUPABASE_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService): SupabaseClient => {
    const url = config.getOrThrow<string>('SUPABASE_URL');
    const key = config.getOrThrow<string>('SUPABASE_ANON_KEY');
    return createClient(url, key);
  },
};

/** Client com service_role key — usado apenas para operações administrativas (ex: signOut forçado). */
export const SupabaseAdminProvider: Provider = {
  provide: SUPABASE_ADMIN_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService): SupabaseClient => {
    const url = config.getOrThrow<string>('SUPABASE_URL');
    const key = config.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY');
    return createClient(url, key, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  },
};
