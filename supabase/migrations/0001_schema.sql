-- =====================================================================
-- Financeiro CDL Marília — schema base
-- Execute no SQL Editor do Supabase, na ordem dos arquivos (0001 → 0004)
-- =====================================================================

create extension if not exists "pgcrypto";
create extension if not exists "unaccent";

-- ---------------------------------------------------------------- perfis
do $$ begin
  create type app_role as enum ('admin', 'lancador', 'leitura');
exception when duplicate_object then null; end $$;

create table if not exists profiles (
  id          uuid primary key references auth.users on delete cascade,
  email       text,
  full_name   text,
  role        app_role not null default 'leitura',
  created_at  timestamptz not null default now()
);

-- cria o profile automaticamente no primeiro login
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    -- o primeiro usuário do sistema entra como admin; os demais como leitura
    case when (select count(*) from public.profiles) = 0 then 'admin'::app_role
         else 'leitura'::app_role end
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- -------------------------------------------------------------- contas
create table if not exists accounts (
  id              uuid primary key default gen_random_uuid(),
  name            text not null unique,
  bank            text,
  opening_balance numeric(14,2) not null default 0,
  opening_date    date,
  color           text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);

-- ----------------------------------------------------------- categorias
create table if not exists categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  kind       text not null default 'ambos' check (kind in ('receita','despesa','ambos')),
  color      text,
  parent_id  uuid references categories(id) on delete set null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

-- regras de categorização automática (substituem o if/else hardcoded)
create table if not exists category_rules (
  id          uuid primary key default gen_random_uuid(),
  pattern     text not null,
  is_regex    boolean not null default false,
  category_id uuid not null references categories(id) on delete cascade,
  priority    int  not null default 100,   -- menor = avaliado antes
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists idx_category_rules_priority on category_rules (priority) where is_active;

-- ------------------------------------------------------- importações
create table if not exists statement_imports (
  id              uuid primary key default gen_random_uuid(),
  file_name       text not null,
  file_url        text,
  file_hash       text,
  format          text check (format in ('csv','xlsx','pdf','manual')),
  account_id      uuid references accounts(id) on delete set null,
  period_start    date,
  period_end      date,
  rows_total      int not null default 0,
  rows_imported   int not null default 0,
  rows_duplicated int not null default 0,
  status          text not null default 'concluido'
                  check (status in ('rascunho','concluido','revertido','erro')),
  created_by      uuid references profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists idx_imports_created on statement_imports (created_at desc);
-- índice comum (não único): o mesmo arquivo pode ser importado de novo se preciso
create index if not exists idx_imports_hash on statement_imports (file_hash);

-- -------------------------------------------------------- transações
-- Chave de deduplicação: data + descrição normalizada + valor.
-- A data é formatada campo a campo para a função ser realmente IMMUTABLE
-- (date::text depende do DateStyle da sessão e não serve em coluna gerada).
create or replace function tx_fingerprint(d date, descr text, amt numeric)
returns text language sql immutable as $$
  select md5(
    lpad(extract(year  from d)::int::text, 4, '0') || '-' ||
    lpad(extract(month from d)::int::text, 2, '0') || '-' ||
    lpad(extract(day   from d)::int::text, 2, '0') || '|' ||
    lower(btrim(coalesce(descr, ''))) || '|' ||
    to_char(round(coalesce(amt, 0), 2), 'FM9999999999990.00')
  );
$$;

create table if not exists transactions (
  id             uuid primary key default gen_random_uuid(),
  date           date not null,
  description    text not null,
  amount         numeric(14,2) not null check (amount >= 0),  -- sempre absoluto
  type           text not null check (type in ('receita','despesa')),
  category_id    uuid references categories(id) on delete set null,
  account_id     uuid references accounts(id) on delete set null,
  import_id      uuid references statement_imports(id) on delete set null,
  source         text not null default 'manual' check (source in ('manual','upload')),
  attachment_url text,
  notes          text,
  reconciled     boolean not null default false,
  fingerprint    text generated always as (tx_fingerprint(date, description, amount)) stored,
  created_by     uuid references profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_tx_date        on transactions (date desc);
create index if not exists idx_tx_category    on transactions (category_id);
create index if not exists idx_tx_account     on transactions (account_id);
create index if not exists idx_tx_type_date   on transactions (type, date desc);
create index if not exists idx_tx_import      on transactions (import_id);
create index if not exists idx_tx_fingerprint on transactions (fingerprint);
create index if not exists idx_tx_desc_fts    on transactions
  using gin (to_tsvector('portuguese', description));

create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists trg_tx_updated on transactions;
create trigger trg_tx_updated before update on transactions
  for each row execute function touch_updated_at();

-- ---------------------------------------------------------- auditoria
create table if not exists activity_logs (
  id            uuid primary key default gen_random_uuid(),
  entity_type   text not null,
  entity_ids    uuid[] not null default '{}',
  action_type   text not null check (action_type in
                  ('create','update','delete','bulk_create','bulk_update',
                   'import','export','revert')),
  previous_data jsonb,
  new_data      jsonb,
  description   text,
  details       text,
  reverted      boolean not null default false,
  reverted_at   timestamptz,
  created_by    uuid references profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists idx_logs_created on activity_logs (created_at desc);
create index if not exists idx_logs_action  on activity_logs (action_type);

-- ------------------------------------------- agregação para o dashboard
create materialized view if not exists monthly_summary as
select date_trunc('month', t.date)::date as month,
       t.account_id,
       t.category_id,
       t.type,
       sum(t.amount)::numeric(14,2) as total,
       count(*)::int as qtd
from transactions t
group by 1, 2, 3, 4;

-- índice em colunas simples (requisito do REFRESH ... CONCURRENTLY);
-- NULLS NOT DISTINCT porque conta/categoria podem ser nulas
create unique index if not exists idx_monthly_summary_key
  on monthly_summary (month, account_id, category_id, type) nulls not distinct;

create or replace function refresh_monthly_summary()
returns void language plpgsql security definer as $$
begin
  refresh materialized view concurrently monthly_summary;
exception when others then
  -- primeira execução (view ainda não populada) cai no refresh normal
  refresh materialized view monthly_summary;
end $$;
