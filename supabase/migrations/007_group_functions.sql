-- ============================================================
-- 007_group_functions.sql
-- Relly — funções atômicas para operações de grupo
-- ============================================================

-- ============================================================
-- Função: create_group_atomic
--
-- Cria um grupo e insere o owner como admin em uma única transação.
-- Necessário porque o trigger check_split_shares é DEFERRABLE —
-- o INSERT do membro precisa acontecer no mesmo bloco transacional.
--
-- Retorna: uuid do grupo criado.
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_group_atomic(
  p_name        text,
  p_type        text,
  p_owner_id    uuid,
  p_max_members int,
  p_split_share numeric
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_group_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.groups (id, name, type, max_members, owner_id)
  VALUES (v_group_id, p_name, p_type, p_max_members, p_owner_id);

  INSERT INTO public.group_members (group_id, user_id, role, split_share)
  VALUES (v_group_id, p_owner_id, 'admin', p_split_share);

  RETURN v_group_id;
END;
$$;


-- ============================================================
-- Função: accept_invite_atomic
--
-- Valida o token de convite e adiciona o usuário ao grupo em
-- uma única transação, redistribuindo split_share entre membros:
--
--   couple → todos ficam com 50.00
--   shared → divisão igualitária; último membro absorve resto do arredondamento
--
-- Usa FOR UPDATE no invite para evitar race condition (dois usuários
-- aceitando o mesmo convite simultaneamente).
--
-- Retorna: uuid do grupo ingressado.
-- Lança exceção com mensagem legível para cada caso de erro.
-- ============================================================
CREATE OR REPLACE FUNCTION public.accept_invite_atomic(
  p_token   text,
  p_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_invite       public.invites%ROWTYPE;
  v_group        public.groups%ROWTYPE;
  v_member_count int;
  v_each_share   numeric(5,2);
  v_new_share    numeric(5,2);
BEGIN
  -- Busca e trava o convite contra race condition
  SELECT * INTO v_invite
    FROM public.invites
   WHERE token = p_token
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Convite não encontrado.';
  END IF;

  IF v_invite.status != 'pending' THEN
    RAISE EXCEPTION 'Este convite já foi utilizado ou está inativo.';
  END IF;

  IF v_invite.expires_at < now() THEN
    RAISE EXCEPTION 'Este convite expirou.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.group_members
     WHERE group_id = v_invite.group_id
       AND user_id  = p_user_id
  ) THEN
    RAISE EXCEPTION 'Você já é membro deste grupo.';
  END IF;

  SELECT * INTO v_group FROM public.groups WHERE id = v_invite.group_id;

  SELECT COUNT(*) INTO v_member_count
    FROM public.group_members
   WHERE group_id = v_invite.group_id;

  -- Calcula split_share com base no tipo de grupo
  IF v_group.type = 'couple' THEN
    v_each_share := 50.00;
    v_new_share  := 50.00;
    UPDATE public.group_members
       SET split_share = v_each_share
     WHERE group_id = v_invite.group_id;

  ELSIF v_group.type = 'shared' THEN
    -- Divisão igualitária; último membro absorve o resto do arredondamento
    v_each_share := ROUND(100.0 / (v_member_count + 1), 2);
    v_new_share  := 100.0 - (v_each_share * v_member_count);
    UPDATE public.group_members
       SET split_share = v_each_share
     WHERE group_id = v_invite.group_id;

  ELSE
    RAISE EXCEPTION 'Tipo de grupo inválido para convite.';
  END IF;

  INSERT INTO public.group_members (group_id, user_id, role, split_share)
  VALUES (v_invite.group_id, p_user_id, 'member', v_new_share);

  UPDATE public.invites
     SET status = 'accepted'
   WHERE id = v_invite.id;

  RETURN v_invite.group_id;
END;
$$;
