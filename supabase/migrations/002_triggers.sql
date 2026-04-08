-- ============================================================
-- 002_triggers.sql
-- Relly — triggers de negócio
-- ============================================================

-- ============================================================
-- Trigger 1: handle_new_user
-- Ao criar usuário no Supabase Auth:
--   1. Cria registro em public.users (trial por 30 dias)
--   2. Cria grupo personal "Pessoal"
--   3. Adiciona o usuário como admin com split_share = 100
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_group_id uuid := gen_random_uuid();
BEGIN
  -- 1. Cria perfil público
  INSERT INTO public.users (id, name, trial_ends_at)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.email),
    now() + interval '30 days'
  );

  -- 2. Cria grupo personal do usuário
  INSERT INTO public.groups (id, name, type, max_members, owner_id)
  VALUES (v_group_id, 'Pessoal', 'personal', 1, NEW.id);

  -- 3. Insere como admin com cota total
  INSERT INTO public.group_members (group_id, user_id, role, split_share)
  VALUES (v_group_id, NEW.id, 'admin', 100.00);

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();


-- ============================================================
-- Trigger 2: check_group_capacity
-- Antes de adicionar membro: verifica se o grupo atingiu max_members.
-- Exceção: owner premium em grupo shared → sem limite.
-- ============================================================
CREATE OR REPLACE FUNCTION public.check_group_capacity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_group       public.groups%ROWTYPE;
  v_owner_plan  text;
  v_member_count int;
BEGIN
  SELECT * INTO v_group FROM public.groups WHERE id = NEW.group_id;
  SELECT plan INTO v_owner_plan FROM public.users WHERE id = v_group.owner_id;

  -- Premium + shared: sem restrição de capacidade
  IF v_owner_plan = 'premium' AND v_group.type = 'shared' THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_member_count
  FROM public.group_members
  WHERE group_id = NEW.group_id;

  IF v_member_count >= v_group.max_members THEN
    RAISE EXCEPTION
      'O grupo "%" atingiu o limite máximo de % membro(s).',
      v_group.name, v_group.max_members;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER before_group_member_insert
  BEFORE INSERT ON public.group_members
  FOR EACH ROW
  EXECUTE FUNCTION public.check_group_capacity();


-- ============================================================
-- Trigger 3: check_split_shares
-- Após INSERT ou UPDATE em group_members:
--   Verifica se a soma das cotas do grupo é 100 (± 0.01).
--
-- Usa DEFERRABLE INITIALLY DEFERRED para validar ao final da
-- transação — evita falso-positivo ao ajustar cotas de dois
-- membros no mesmo bloco transacional.
-- ============================================================
CREATE OR REPLACE FUNCTION public.check_split_shares()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_total numeric;
BEGIN
  SELECT COALESCE(SUM(split_share), 0)
    INTO v_total
    FROM public.group_members
   WHERE group_id = NEW.group_id;

  IF v_total < 99.99 OR v_total > 100.01 THEN
    RAISE EXCEPTION
      'A soma das cotas do grupo deve ser 100%%. Soma atual: %.',
      v_total;
  END IF;

  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER check_split_shares_trigger
  AFTER INSERT OR UPDATE ON public.group_members
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.check_split_shares();
