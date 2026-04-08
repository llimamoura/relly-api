-- ============================================================
-- 004_rls.sql
-- Relly — Row Level Security
-- ============================================================

-- ============================================================
-- Habilitar RLS em todas as tabelas
-- ============================================================
ALTER TABLE public.users             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invites           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transaction_splits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_entries    ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- users
-- Cada usuário vê e edita apenas o próprio registro.
-- INSERT é tratado pelo trigger handle_new_user (SECURITY DEFINER).
-- ============================================================
CREATE POLICY "users_select_own" ON public.users
  FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "users_update_own" ON public.users
  FOR UPDATE
  USING (auth.uid() = id);


-- ============================================================
-- groups
-- Visível apenas para membros do grupo.
-- Apenas o owner pode atualizar ou excluir.
-- ============================================================
CREATE POLICY "groups_select_member" ON public.groups
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.group_members
       WHERE group_members.group_id = groups.id
         AND group_members.user_id  = auth.uid()
    )
  );

CREATE POLICY "groups_insert_owner" ON public.groups
  FOR INSERT
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "groups_update_owner" ON public.groups
  FOR UPDATE
  USING (owner_id = auth.uid());

CREATE POLICY "groups_delete_owner" ON public.groups
  FOR DELETE
  USING (owner_id = auth.uid());


-- ============================================================
-- group_members
-- Visível apenas para membros do mesmo grupo.
-- Inserção: admin do grupo.
-- Remoção: admin do grupo ou o próprio membro (saída voluntária).
-- ============================================================
CREATE POLICY "group_members_select" ON public.group_members
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.group_members gm
       WHERE gm.group_id = group_members.group_id
         AND gm.user_id  = auth.uid()
    )
  );

CREATE POLICY "group_members_insert_admin" ON public.group_members
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.group_members gm
       WHERE gm.group_id = group_id
         AND gm.user_id  = auth.uid()
         AND gm.role     = 'admin'
    )
  );

CREATE POLICY "group_members_update_admin" ON public.group_members
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.group_members gm
       WHERE gm.group_id = group_members.group_id
         AND gm.user_id  = auth.uid()
         AND gm.role     = 'admin'
    )
  );

CREATE POLICY "group_members_delete_admin_or_self" ON public.group_members
  FOR DELETE
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.group_members gm
       WHERE gm.group_id = group_members.group_id
         AND gm.user_id  = auth.uid()
         AND gm.role     = 'admin'
    )
  );


-- ============================================================
-- invites
-- Visível para membros do grupo que gerou o convite.
-- Criação: apenas admins.
-- ============================================================
CREATE POLICY "invites_select_member" ON public.invites
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.group_members gm
       WHERE gm.group_id = invites.group_id
         AND gm.user_id  = auth.uid()
    )
  );

CREATE POLICY "invites_insert_admin" ON public.invites
  FOR INSERT
  WITH CHECK (
    invited_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.group_members gm
       WHERE gm.group_id = group_id
         AND gm.user_id  = auth.uid()
         AND gm.role     = 'admin'
    )
  );

CREATE POLICY "invites_update_admin" ON public.invites
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.group_members gm
       WHERE gm.group_id = invites.group_id
         AND gm.user_id  = auth.uid()
         AND gm.role     = 'admin'
    )
  );


-- ============================================================
-- categories
-- Visível se: group_id IS NULL (global) OU usuário é membro do grupo.
-- ============================================================
CREATE POLICY "categories_select" ON public.categories
  FOR SELECT
  USING (
    group_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.group_members gm
       WHERE gm.group_id = categories.group_id
         AND gm.user_id  = auth.uid()
    )
  );

CREATE POLICY "categories_insert_admin" ON public.categories
  FOR INSERT
  WITH CHECK (
    group_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.group_members gm
       WHERE gm.group_id = group_id
         AND gm.user_id  = auth.uid()
         AND gm.role     = 'admin'
    )
  );

CREATE POLICY "categories_update_admin" ON public.categories
  FOR UPDATE
  USING (
    group_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.group_members gm
       WHERE gm.group_id = categories.group_id
         AND gm.user_id  = auth.uid()
         AND gm.role     = 'admin'
    )
  );

CREATE POLICY "categories_delete_admin" ON public.categories
  FOR DELETE
  USING (
    group_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.group_members gm
       WHERE gm.group_id = categories.group_id
         AND gm.user_id  = auth.uid()
         AND gm.role     = 'admin'
    )
  );


-- ============================================================
-- transactions
-- Visível apenas para membros do grupo.
-- ============================================================
CREATE POLICY "transactions_select_member" ON public.transactions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.group_members gm
       WHERE gm.group_id = transactions.group_id
         AND gm.user_id  = auth.uid()
    )
  );

CREATE POLICY "transactions_insert_member" ON public.transactions
  FOR INSERT
  WITH CHECK (
    payer_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.group_members gm
       WHERE gm.group_id = group_id
         AND gm.user_id  = auth.uid()
    )
  );

CREATE POLICY "transactions_update_payer" ON public.transactions
  FOR UPDATE
  USING (payer_id = auth.uid());

-- Soft delete: apenas quem criou pode marcar deleted_at
CREATE POLICY "transactions_soft_delete" ON public.transactions
  FOR UPDATE
  USING (payer_id = auth.uid())
  WITH CHECK (deleted_at IS NOT NULL);


-- ============================================================
-- transaction_splits
-- Visível se a transaction pertence a um grupo do usuário.
-- ============================================================
CREATE POLICY "transaction_splits_select" ON public.transaction_splits
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
        FROM public.transactions t
        JOIN public.group_members gm ON gm.group_id = t.group_id
       WHERE t.id          = transaction_splits.transaction_id
         AND gm.user_id    = auth.uid()
    )
  );

CREATE POLICY "transaction_splits_insert_member" ON public.transaction_splits
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
        FROM public.transactions t
        JOIN public.group_members gm ON gm.group_id = t.group_id
       WHERE t.id       = transaction_id
         AND gm.user_id = auth.uid()
    )
  );


-- ============================================================
-- ledger_entries
-- Visível apenas para membros do grupo.
-- Inserção/exclusão gerenciadas pelas funções populate_ledger
-- e delete_transaction (SECURITY DEFINER) — sem política de escrita.
-- ============================================================
CREATE POLICY "ledger_entries_select_member" ON public.ledger_entries
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.group_members gm
       WHERE gm.group_id = ledger_entries.group_id
         AND gm.user_id  = auth.uid()
    )
  );
