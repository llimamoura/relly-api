-- ============================================================
-- 005_functions.sql
-- Relly — funções de negócio
-- ============================================================

-- ============================================================
-- Função: populate_ledger(p_transaction_id uuid)
--
-- Popula ledger_entries a partir de uma transação já criada,
-- aplicando as regras de contabilidade por tipo de grupo:
--
-- PERSONAL:
--   income  → ledger: user_id = payer, type = 'income'
--   expense → ledger: user_id = NULL,  type = 'expense'  (pool pessoal)
--
-- COUPLE / SHARED:
--   income               → ledger: user_id = NULL, type = 'income'
--   expense (normal)     → ledger: user_id = NULL, type = 'expense'
--   expense (is_advance) → ledger: payer = 'expense_paid' (total)
--                          + cada split = 'expense_owed'
--
-- Ao final: refresha as materialized views de saldo.
-- ============================================================
CREATE OR REPLACE FUNCTION public.populate_ledger(p_transaction_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tx    public.transactions%ROWTYPE;
  v_group public.groups%ROWTYPE;
  v_split RECORD;
BEGIN
  SELECT * INTO v_tx    FROM public.transactions WHERE id = p_transaction_id;
  SELECT * INTO v_group FROM public.groups       WHERE id = v_tx.group_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transação % não encontrada.', p_transaction_id;
  END IF;

  -- -------------------------------------------------------
  -- PERSONAL
  -- -------------------------------------------------------
  IF v_group.type = 'personal' THEN

    IF v_tx.type = 'income' THEN
      INSERT INTO public.ledger_entries
        (transaction_id, group_id, user_id, type, amount)
      VALUES
        (p_transaction_id, v_tx.group_id, v_tx.payer_id, 'income', v_tx.amount);

    ELSIF v_tx.type = 'expense' THEN
      INSERT INTO public.ledger_entries
        (transaction_id, group_id, user_id, type, amount)
      VALUES
        (p_transaction_id, v_tx.group_id, NULL, 'expense', v_tx.amount);
    END IF;

  -- -------------------------------------------------------
  -- COUPLE / SHARED
  -- -------------------------------------------------------
  ELSIF v_group.type IN ('couple', 'shared') THEN

    IF v_tx.type = 'income' THEN
      INSERT INTO public.ledger_entries
        (transaction_id, group_id, user_id, type, amount)
      VALUES
        (p_transaction_id, v_tx.group_id, NULL, 'income', v_tx.amount);

    ELSIF v_tx.type = 'expense' AND v_tx.is_advance = false THEN
      INSERT INTO public.ledger_entries
        (transaction_id, group_id, user_id, type, amount)
      VALUES
        (p_transaction_id, v_tx.group_id, NULL, 'expense', v_tx.amount);

    ELSIF v_tx.type = 'expense' AND v_tx.is_advance = true THEN
      -- Pagador adiantou o valor total pelo grupo
      INSERT INTO public.ledger_entries
        (transaction_id, group_id, user_id, type, amount)
      VALUES
        (p_transaction_id, v_tx.group_id, v_tx.payer_id, 'expense_paid', v_tx.amount);

      -- Cada membro deve a sua cota
      FOR v_split IN
        SELECT * FROM public.transaction_splits
         WHERE transaction_id = p_transaction_id
      LOOP
        INSERT INTO public.ledger_entries
          (transaction_id, group_id, user_id, type, amount)
        VALUES
          (p_transaction_id, v_tx.group_id, v_split.user_id, 'expense_owed', v_split.amount);
      END LOOP;
    END IF;

  END IF;

  -- Atualiza saldos
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.user_group_balance;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.group_pool_balance;
END;
$$;


-- ============================================================
-- Função: delete_transaction(p_transaction_id uuid, p_user_id uuid)
--
-- 1. Verifica que p_user_id é membro do grupo da transação
-- 2. Soft-delete na transação (deleted_at = now())
-- 3. Remove as entradas do ledger associadas
-- 4. Refresha as materialized views
-- ============================================================
CREATE OR REPLACE FUNCTION public.delete_transaction(
  p_transaction_id uuid,
  p_user_id        uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tx public.transactions%ROWTYPE;
BEGIN
  SELECT * INTO v_tx FROM public.transactions WHERE id = p_transaction_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transação % não encontrada.', p_transaction_id;
  END IF;

  -- Garante que o solicitante é membro do grupo
  IF NOT EXISTS (
    SELECT 1 FROM public.group_members
     WHERE group_id = v_tx.group_id
       AND user_id  = p_user_id
  ) THEN
    RAISE EXCEPTION
      'Usuário % não é membro do grupo desta transação.', p_user_id;
  END IF;

  -- Soft-delete
  UPDATE public.transactions
     SET deleted_at = now()
   WHERE id = p_transaction_id;

  -- Remove entradas do ledger (esta é a única operação de DELETE permitida)
  DELETE FROM public.ledger_entries
   WHERE transaction_id = p_transaction_id;

  -- Atualiza saldos
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.user_group_balance;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.group_pool_balance;
END;
$$;
