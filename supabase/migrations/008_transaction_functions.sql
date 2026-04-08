-- ============================================================
-- 008_transaction_functions.sql
-- Relly — criação atômica de transação
-- ============================================================

-- ============================================================
-- Função: create_transaction_atomic
--
-- Persiste transação + splits + ledger entries em uma única
-- transação PostgreSQL, garantindo atomicidade completa.
--
-- Fluxo interno:
--   1. INSERT transactions
--   2. INSERT transaction_splits (se p_splits não for vazio)
--   3. PERFORM populate_ledger (que também dá REFRESH nas views)
--
-- p_splits: array JSON no formato [{"user_id":"uuid","amount":49.99}, ...]
--   Passado vazio ([]) quando is_advance=false ou type='income'.
--
-- Retorna: uuid da transação criada.
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_transaction_atomic(
  p_group_id    uuid,
  p_payer_id    uuid,
  p_category_id uuid,
  p_amount      numeric,
  p_type        text,
  p_is_advance  boolean,
  p_description text,
  p_occurred_at timestamptz,
  p_splits      jsonb DEFAULT '[]'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tx_id uuid := gen_random_uuid();
  v_split jsonb;
BEGIN
  -- 1. Registra a transação
  INSERT INTO public.transactions
    (id, group_id, payer_id, category_id, amount, type, is_advance, description, occurred_at)
  VALUES
    (v_tx_id, p_group_id, p_payer_id, p_category_id,
     p_amount, p_type, p_is_advance, p_description,
     COALESCE(p_occurred_at, now()));

  -- 2. Insere splits (somente para expense + is_advance=true)
  FOR v_split IN SELECT * FROM jsonb_array_elements(p_splits)
  LOOP
    INSERT INTO public.transaction_splits (transaction_id, user_id, amount)
    VALUES (
      v_tx_id,
      (v_split->>'user_id')::uuid,
      (v_split->>'amount')::numeric
    );
  END LOOP;

  -- 3. Popula ledger e atualiza materialized views
  PERFORM public.populate_ledger(v_tx_id);

  RETURN v_tx_id;
END;
$$;
