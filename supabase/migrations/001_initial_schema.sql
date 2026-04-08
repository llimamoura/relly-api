-- ============================================================
-- 001_initial_schema.sql
-- Relly — schema base
-- ============================================================

-- --------------------------------------------------------
-- users (espelha auth.users do Supabase)
-- --------------------------------------------------------
CREATE TABLE public.users (
  id             uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name           text        NOT NULL,
  plan           text        NOT NULL DEFAULT 'trial'
                               CHECK (plan IN ('trial', 'premium')),
  trial_ends_at  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- --------------------------------------------------------
-- groups
-- --------------------------------------------------------
CREATE TABLE public.groups (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  type        text        NOT NULL CHECK (type IN ('personal', 'couple', 'shared')),
  max_members int         NOT NULL DEFAULT 1,
  owner_id    uuid        NOT NULL REFERENCES public.users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),

  -- personal → sempre 1 membro
  CONSTRAINT groups_personal_max_members
    CHECK (type != 'personal' OR max_members = 1),

  -- couple → sempre 2 membros
  CONSTRAINT groups_couple_max_members
    CHECK (type != 'couple' OR max_members = 2)
);

-- --------------------------------------------------------
-- group_members
-- --------------------------------------------------------
CREATE TABLE public.group_members (
  id          uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    uuid           NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  user_id     uuid           NOT NULL REFERENCES public.users(id),
  role        text           NOT NULL DEFAULT 'member'
                               CHECK (role IN ('admin', 'member')),
  split_share numeric(5,2)  NOT NULL DEFAULT 50.00
                               CHECK (split_share > 0 AND split_share <= 100),
  joined_at   timestamptz    NOT NULL DEFAULT now(),

  UNIQUE (group_id, user_id)
);

-- --------------------------------------------------------
-- invites
-- --------------------------------------------------------
CREATE TABLE public.invites (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    uuid        NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  invited_by  uuid        NOT NULL REFERENCES public.users(id),
  token       text        UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
  status      text        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'accepted', 'expired')),
  expires_at  timestamptz NOT NULL DEFAULT now() + interval '7 days',
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- --------------------------------------------------------
-- categories
-- --------------------------------------------------------
CREATE TABLE public.categories (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id   uuid        REFERENCES public.groups(id) ON DELETE CASCADE,  -- NULL = global
  name       text        NOT NULL,
  type       text        NOT NULL CHECK (type IN ('income', 'expense')),
  icon       text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- --------------------------------------------------------
-- transactions
-- --------------------------------------------------------
CREATE TABLE public.transactions (
  id          uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    uuid           NOT NULL REFERENCES public.groups(id),
  payer_id    uuid           NOT NULL REFERENCES public.users(id),
  category_id uuid           REFERENCES public.categories(id),
  amount      numeric(12,2)  NOT NULL CHECK (amount > 0),
  type        text           NOT NULL CHECK (type IN ('income', 'expense')),
  is_advance  boolean        NOT NULL DEFAULT false,
  description text,
  occurred_at timestamptz    NOT NULL DEFAULT now(),
  created_at  timestamptz    NOT NULL DEFAULT now(),
  deleted_at  timestamptz,

  -- adiantamento só faz sentido para despesas
  CONSTRAINT transactions_advance_only_expense
    CHECK (is_advance = false OR type = 'expense')
);

-- --------------------------------------------------------
-- transaction_splits
-- --------------------------------------------------------
CREATE TABLE public.transaction_splits (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid          NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
  user_id        uuid          NOT NULL REFERENCES public.users(id),
  amount         numeric(5,2)  NOT NULL CHECK (amount > 0),
  settled        boolean       NOT NULL DEFAULT false,
  settled_at     timestamptz
);

-- --------------------------------------------------------
-- ledger_entries (append-only — nunca deletar diretamente)
-- --------------------------------------------------------
CREATE TABLE public.ledger_entries (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid          NOT NULL REFERENCES public.transactions(id),
  group_id       uuid          NOT NULL REFERENCES public.groups(id),
  user_id        uuid,  -- NULL = pool do grupo
  type           text          NOT NULL
                                 CHECK (type IN ('income', 'expense', 'expense_paid', 'expense_owed')),
  amount         numeric(12,2) NOT NULL CHECK (amount > 0),
  created_at     timestamptz   NOT NULL DEFAULT now(),

  -- expense_paid e expense_owed exigem user_id NOT NULL
  CONSTRAINT ledger_entries_personal_types_require_user
    CHECK (type NOT IN ('expense_paid', 'expense_owed') OR user_id IS NOT NULL)
);
