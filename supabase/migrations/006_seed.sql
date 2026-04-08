-- ============================================================
-- 006_seed.sql
-- Relly — categorias globais (group_id IS NULL)
-- ============================================================

INSERT INTO public.categories (name, type) VALUES
  -- Receitas
  ('Salário',      'income'),
  ('Freelance',    'income'),
  ('Investimento', 'income'),
  ('Outros',       'income'),
  -- Despesas
  ('Mercado',      'expense'),
  ('Aluguel',      'expense'),
  ('Transporte',   'expense'),
  ('Lazer',        'expense'),
  ('Saúde',        'expense'),
  ('Outros',       'expense');
