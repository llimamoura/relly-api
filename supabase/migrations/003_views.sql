-- ============================================================
-- 003_views.sql
-- Relly — views e materialized views
-- ============================================================

-- ============================================================
-- View: active_transactions
-- Transações não excluídas (soft delete)
-- ============================================================
CREATE VIEW public.active_transactions AS
SELECT *
  FROM public.transactions
 WHERE deleted_at IS NULL;


-- ============================================================
-- Materialized View: user_group_balance
-- Saldo individual por (group_id, user_id) agregando ledger_entries.
--
-- total_in    → entradas: income + expense_paid (quem pagou adiantado)
-- total_owed  → saídas:   expense + expense_owed (o que deve)
-- net_balance → total_in - total_owed
-- ============================================================
CREATE MATERIALIZED VIEW public.user_group_balance AS
SELECT
  group_id,
  user_id,
  COALESCE(SUM(amount) FILTER (WHERE type IN ('income', 'expense_paid')), 0) AS total_in,
  COALESCE(SUM(amount) FILTER (WHERE type IN ('expense', 'expense_owed')), 0) AS total_owed,
  COALESCE(SUM(amount) FILTER (WHERE type IN ('income', 'expense_paid')), 0)
    - COALESCE(SUM(amount) FILTER (WHERE type IN ('expense', 'expense_owed')), 0) AS net_balance
FROM public.ledger_entries
WHERE user_id IS NOT NULL
GROUP BY group_id, user_id;

CREATE UNIQUE INDEX user_group_balance_idx
  ON public.user_group_balance (group_id, user_id);


-- ============================================================
-- Materialized View: group_pool_balance
-- Saldo do pool compartilhado por grupo (user_id IS NULL).
--
-- total_in     → receitas que entraram no pool
-- total_out    → despesas debitadas do pool
-- pool_balance → total_in - total_out
-- ============================================================
CREATE MATERIALIZED VIEW public.group_pool_balance AS
SELECT
  group_id,
  COALESCE(SUM(amount) FILTER (WHERE type = 'income'), 0)   AS total_in,
  COALESCE(SUM(amount) FILTER (WHERE type = 'expense'), 0)  AS total_out,
  COALESCE(SUM(amount) FILTER (WHERE type = 'income'), 0)
    - COALESCE(SUM(amount) FILTER (WHERE type = 'expense'), 0) AS pool_balance
FROM public.ledger_entries
WHERE user_id IS NULL
GROUP BY group_id;

CREATE UNIQUE INDEX group_pool_balance_idx
  ON public.group_pool_balance (group_id);
