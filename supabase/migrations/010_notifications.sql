-- ============================================================
-- 010_notifications.sql
-- Relly — tabela de notificações internas + função auxiliar
-- ============================================================

-- ── Tabela ─────────────────────────────────────────────────────────────────

CREATE TABLE public.notifications (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type       text        NOT NULL
               CHECK (type IN ('group_invite', 'invite_accepted')),
  title      text        NOT NULL,
  body       text,
  data       jsonb       NOT NULL DEFAULT '{}',
  read       boolean     NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── RLS ────────────────────────────────────────────────────────────────────

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Usuário vê e gerencia apenas as próprias notificações.
-- INSERT é feito via service_role (admin client) — bypass automático.
CREATE POLICY "notifications_all_own" ON public.notifications
  FOR ALL
  USING     (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ── Índices ─────────────────────────────────────────────────────────────────

-- Badge de não lidas (user_id + read = false)
CREATE INDEX idx_notifications_user_read
  ON public.notifications (user_id, read);

-- Listagem cronológica
CREATE INDEX idx_notifications_user_created
  ON public.notifications (user_id, created_at DESC);

-- ── Função auxiliar: busca usuário por e-mail ───────────────────────────────
--
-- Usada pelo fluxo interno de convite: o admin informa o e-mail de um
-- usuário já cadastrado → o backend localiza o UUID e cria a notificação.
--
-- Retorna TABLE para ser chamada via supabase.rpc() — o cliente JS retorna
-- um array, mesmo que haja 0 ou 1 linha.
--
-- SECURITY DEFINER + row_security = off: acessa auth.users (schema auth)
-- sem restrição de RLS, tal como handle_new_user e demais funções internas.
-- ──────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.find_user_by_email(p_email text)
RETURNS TABLE(id uuid, name text)
LANGUAGE sql
SECURITY DEFINER SET search_path = public SET row_security = off
AS $$
  SELECT u.id, u.name
    FROM public.users u
    JOIN auth.users au ON au.id = u.id
   WHERE lower(au.email) = lower(p_email)
   LIMIT 1;
$$;
