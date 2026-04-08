-- ============================================================
-- 009_fix_trigger_rls.sql
-- Relly — corrige triggers para bypassar RLS + patches de segurança
--
-- Problema original: Supabase configura SET row_security = ON para o
-- role postgres, fazendo com que mesmo funções SECURITY DEFINER fiquem
-- sujeitas ao RLS. Durante o trigger de signup (handle_new_user),
-- auth.uid() retorna NULL — bloqueando INSERTs nas tabelas com
-- políticas que dependem de auth.uid() ou de membros existentes.
--
-- Solução original: adicionar SET row_security = off nas funções de
-- trigger, desativando o RLS apenas para a execução da função.
--
-- Patches adicionais nesta migração:
--   FIX-1: check_group_capacity — race condition (TOCTOU) corrigida
--          com SELECT ... FOR UPDATE no grupo, garantindo lock
--          pessimista contra inserções concorrentes.
--   FIX-2: check_group_capacity — grupo inexistente antes retornava
--          NULL silenciosamente; agora levanta exceção explícita.
--   FIX-3: check_split_shares — trigger estendido para cobrir DELETE;
--          após remoção de membro, a soma deve permanecer 100 %%.
--          Admin precisa redistribuir cotas antes de remover.
-- ============================================================


-- ============================================================
-- Trigger 1 — handle_new_user
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public SET row_security = off
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


-- ============================================================
-- Trigger 2 — check_group_capacity
--
-- FIX-1: SELECT ... FOR UPDATE no grupo garante lock pessimista.
--        Sem isso, duas transações concorrentes podiam ler o mesmo
--        COUNT e ambas passarem na validação (TOCTOU).
--
-- FIX-2: NOT FOUND após SELECT levanta exceção explícita em vez de
--        continuar com v_group NULL (max_members NULL → COUNT >= NULL
--        avalia como FALSE → inserção passava sem validação).
-- ============================================================
CREATE OR REPLACE FUNCTION public.check_group_capacity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public SET row_security = off
AS $$
DECLARE
  v_group        public.groups%ROWTYPE;
  v_owner_plan   text;
  v_member_count int;
BEGIN
  -- FIX-1: FOR UPDATE serializa inserções concorrentes no mesmo grupo
  SELECT * INTO v_group
    FROM public.groups
   WHERE id = NEW.group_id
   FOR UPDATE;

  -- FIX-2: grupo deve existir
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Grupo % não encontrado.', NEW.group_id;
  END IF;

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


-- ============================================================
-- Trigger 3 — check_split_shares
--
-- FIX-3: função estendida para cobrir DELETE.
--
--   INSERT / UPDATE (AFTER): SUM já inclui a linha nova/atualizada.
--     Verifica se total == 100.
--
--   DELETE (AFTER): SUM já exclui a linha removida.
--     Se o admin não redistribuiu as cotas antes de remover o membro,
--     a soma ficará != 100 e a operação é rejeitada com erro.
--     Exceção: remoção do último membro (SUM = 0) é permitida para
--     dissolução do grupo.
--
-- O trigger é recriado abaixo para incluir DELETE.
-- Mantém DEFERRABLE INITIALLY DEFERRED (validação ao fim da transação,
-- evitando falso-positivo ao ajustar cotas de dois membros no mesmo
-- bloco transacional).
-- ============================================================
CREATE OR REPLACE FUNCTION public.check_split_shares()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public SET row_security = off
AS $$
DECLARE
  v_total numeric;
  v_count int;
  v_gid   uuid;
BEGIN
  -- NEW é NULL em DELETE; OLD é NULL em INSERT
  v_gid := COALESCE(NEW.group_id, OLD.group_id);

  SELECT COALESCE(SUM(split_share), 0), COUNT(*)
    INTO v_total, v_count
    FROM public.group_members
   WHERE group_id = v_gid;

  -- Permite dissolução completa do grupo (último membro removido)
  IF TG_OP = 'DELETE' AND v_count = 0 THEN
    RETURN OLD;
  END IF;

  IF v_total < 99.99 OR v_total > 100.01 THEN
    RAISE EXCEPTION
      'A soma das cotas do grupo deve ser 100%%. Soma atual: %.',
      v_total;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Recria o constraint trigger incluindo DELETE
DROP TRIGGER IF EXISTS check_split_shares_trigger ON public.group_members;
CREATE CONSTRAINT TRIGGER check_split_shares_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.group_members
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.check_split_shares();
