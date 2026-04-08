-- ============================================================
-- 011_invite_status.sql
-- Relly — adiciona status 'declined' à tabela invites
-- ============================================================

-- Remove o CHECK existente (que só permite pending/accepted/expired)
-- e substitui por um que inclui 'declined'.
ALTER TABLE public.invites DROP CONSTRAINT invites_status_check;

ALTER TABLE public.invites
  ADD CONSTRAINT invites_status_check
    CHECK (status IN ('pending', 'accepted', 'declined', 'expired'));
