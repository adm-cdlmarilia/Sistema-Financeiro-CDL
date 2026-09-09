-- =====================================================================
-- Financeiro CDL Marilia - estrutura completa do banco
-- Gerado em 09/09/2026
--
-- Cole TUDO no SQL Editor de um projeto Supabase novo e execute uma vez.
-- Ja inclui todas as correcoes aplicadas ate agora (conta por linha,
-- duplicadas permitidas, protecao de admin e exclusao de conta zerada).
-- =====================================================================


-- ############ 0001_schema.sql ############

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


-- ############ 0002_rls.sql ############

-- =====================================================================
-- RLS — papéis: admin (tudo), lancador (lança e edita), leitura (só vê)
-- =====================================================================

alter table profiles          enable row level security;
alter table accounts          enable row level security;
alter table categories        enable row level security;
alter table category_rules    enable row level security;
alter table statement_imports enable row level security;
alter table transactions      enable row level security;
alter table activity_logs     enable row level security;

-- helpers -------------------------------------------------------------
create or replace function my_role()
returns app_role language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function can_write()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(my_role() in ('admin','lancador'), false);
$$;

create or replace function is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(my_role() = 'admin', false);
$$;

-- profiles ------------------------------------------------------------
drop policy if exists profiles_select on profiles;
create policy profiles_select on profiles
  for select to authenticated using (true);

drop policy if exists profiles_update_self on profiles;
create policy profiles_update_self on profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid() and role = my_role());

drop policy if exists profiles_admin_all on profiles;
create policy profiles_admin_all on profiles
  for all to authenticated using (is_admin()) with check (is_admin());

-- leitura para todos os autenticados ----------------------------------
do $$
declare t text;
begin
  foreach t in array array['accounts','categories','category_rules','statement_imports','transactions','activity_logs']
  loop
    execute format('drop policy if exists %I_select on %I', t, t);
    execute format('create policy %I_select on %I for select to authenticated using (true)', t, t);

    execute format('drop policy if exists %I_insert on %I', t, t);
    execute format('create policy %I_insert on %I for insert to authenticated with check (can_write())', t, t);

    execute format('drop policy if exists %I_update on %I', t, t);
    execute format('create policy %I_update on %I for update to authenticated using (can_write()) with check (can_write())', t, t);

    execute format('drop policy if exists %I_delete on %I', t, t);
    execute format('create policy %I_delete on %I for delete to authenticated using (can_write())', t, t);
  end loop;
end $$;

-- contas e regras só o admin altera ------------------------------------
drop policy if exists accounts_insert on accounts;
create policy accounts_insert on accounts for insert to authenticated with check (is_admin());
drop policy if exists accounts_update on accounts;
create policy accounts_update on accounts for update to authenticated using (is_admin()) with check (is_admin());
drop policy if exists accounts_delete on accounts;
create policy accounts_delete on accounts for delete to authenticated using (is_admin());

-- logs nunca são editados nem apagados pela aplicação -------------------
drop policy if exists activity_logs_update on activity_logs;
create policy activity_logs_update on activity_logs
  for update to authenticated using (can_write()) with check (can_write());
drop policy if exists activity_logs_delete on activity_logs;
create policy activity_logs_delete on activity_logs for delete to authenticated using (is_admin());

grant select on monthly_summary to authenticated;


-- ############ 0003_functions.sql ############

-- =====================================================================
-- RPCs: agregação do dashboard, importação com dedupe e undo
-- =====================================================================

-- ---------------------------------------------------- KPIs do período
-- Devolve receitas, despesas, saldo do período e saldo acumulado
-- (tudo calculado no banco — o cliente não baixa transação nenhuma).
create or replace function dashboard_summary(
  p_start date,
  p_end   date,
  p_account uuid default null
)
returns table (
  total_receitas  numeric,
  total_despesas  numeric,
  saldo_periodo   numeric,
  saldo_anterior  numeric,
  saldo_acumulado numeric,
  qtd             int
)
language sql stable security invoker as $$
  with periodo as (
    select
      coalesce(sum(amount) filter (where type = 'receita'), 0) as rec,
      coalesce(sum(amount) filter (where type = 'despesa'), 0) as des,
      count(*)::int as qtd
    from transactions
    where date between p_start and p_end
      and (p_account is null or account_id = p_account)
  ),
  anterior as (
    select coalesce(sum(case when type = 'receita' then amount else -amount end), 0) as saldo
    from transactions
    where date < p_start
      and (p_account is null or account_id = p_account)
  ),
  abertura as (
    select coalesce(sum(opening_balance), 0) as saldo
    from accounts
    where p_account is null or id = p_account
  )
  select p.rec,
         p.des,
         p.rec - p.des,
         a.saldo + ab.saldo,
         a.saldo + ab.saldo + (p.rec - p.des),
         p.qtd
  from periodo p, anterior a, abertura ab;
$$;

-- ------------------------------------------- quebra por categoria
create or replace function category_breakdown(
  p_start date,
  p_end   date,
  p_type  text default null,
  p_account uuid default null
)
returns table (
  category_id uuid,
  category    text,
  receitas    numeric,
  despesas    numeric,
  saldo       numeric,
  qtd         int
)
language sql stable security invoker as $$
  select t.category_id,
         coalesce(c.name, 'Sem categoria') as category,
         coalesce(sum(t.amount) filter (where t.type = 'receita'), 0) as receitas,
         coalesce(sum(t.amount) filter (where t.type = 'despesa'), 0) as despesas,
         coalesce(sum(t.amount) filter (where t.type = 'receita'), 0)
           - coalesce(sum(t.amount) filter (where t.type = 'despesa'), 0) as saldo,
         count(*)::int
  from transactions t
  left join categories c on c.id = t.category_id
  where t.date between p_start and p_end
    and (p_type is null or t.type = p_type)
    and (p_account is null or t.account_id = p_account)
  group by 1, 2
  order by 4 desc, 3 desc;
$$;

-- ------------------------------------------------ série mensal
create or replace function monthly_series(
  p_months int default 12,
  p_account uuid default null
)
returns table (month date, receitas numeric, despesas numeric, saldo numeric)
language sql stable security invoker as $$
  select date_trunc('month', date)::date as month,
         coalesce(sum(amount) filter (where type = 'receita'), 0) as receitas,
         coalesce(sum(amount) filter (where type = 'despesa'), 0) as despesas,
         coalesce(sum(amount) filter (where type = 'receita'), 0)
           - coalesce(sum(amount) filter (where type = 'despesa'), 0) as saldo
  from transactions
  where date >= (date_trunc('month', current_date) - ((p_months - 1) || ' months')::interval)::date
    and (p_account is null or account_id = p_account)
  group by 1
  order by 1;
$$;

-- ------------------------------------- meses que possuem lançamento
create or replace function available_months()
returns table (month date)
language sql stable security invoker as $$
  select distinct date_trunc('month', date)::date
  from transactions
  order by 1 desc;
$$;

-- ------------------------------- categorização automática por regras
create or replace function suggest_category(p_description text)
returns uuid language sql stable security invoker as $$
  select r.category_id
  from category_rules r
  where r.is_active
    and case
          when r.is_regex then unaccent(lower(p_description)) ~ unaccent(lower(r.pattern))
          else unaccent(lower(p_description)) like '%' || unaccent(lower(r.pattern)) || '%'
        end
  order by r.priority, r.created_at
  limit 1;
$$;

-- ---------------------------------------- importação com deduplicação
-- p_rows: jsonb array de {date, description, amount, type, category_id, notes}
-- Grava o lote inteiro numa transação SQL; linhas já existentes (mesmo
-- fingerprint) são contadas como duplicadas e NÃO são inseridas.
create or replace function import_transactions(
  p_file_name text,
  p_format    text,
  p_account   uuid,
  p_rows      jsonb,
  p_file_hash text default null
)
returns jsonb
language plpgsql security invoker as $$
declare
  v_import uuid;
  v_total  int := jsonb_array_length(p_rows);
  v_ins    int := 0;
  v_dup    int := 0;
  v_ids    uuid[];
begin
  if not can_write() then
    raise exception 'Sem permissão para importar transações';
  end if;

  insert into statement_imports (file_name, format, account_id, file_hash,
                                 rows_total, status, created_by)
  values (p_file_name, p_format, p_account, p_file_hash, v_total, 'concluido', auth.uid())
  returning id into v_import;

  with bruto as (
    select (r->>'date')::date                         as date,
           btrim(r->>'description')                   as description,
           abs((r->>'amount')::numeric)               as amount,
           coalesce(r->>'type',
                    case when (r->>'amount')::numeric >= 0 then 'receita' else 'despesa' end) as type,
           nullif(r->>'category_id','')::uuid         as category_id,
           nullif(r->>'account_id','')::uuid          as account_id,
           nullif(r->>'notes','')                     as notes
    from jsonb_array_elements(p_rows) r
  ),
  -- todas as linhas entram: lançamentos repetidos (mesma data, descrição e valor)
  -- são comuns e legítimos, então não há filtro de duplicidade aqui
  gravados as (
    insert into transactions (date, description, amount, type, category_id,
                              account_id, import_id, source, notes, created_by)
    select n.date, n.description, n.amount, n.type,
           coalesce(n.category_id, suggest_category(n.description)),
           coalesce(n.account_id, p_account),   -- conta da própria linha; p_account é o padrão
           v_import, 'upload', n.notes, auth.uid()
    from bruto n
    returning id
  )
  select array_agg(id), count(*)::int into v_ids, v_ins from gravados;

  v_dup := 0;

  update statement_imports
     set rows_imported = coalesce(v_ins, 0),
         rows_duplicated = v_dup,
         period_start = (select min(date) from transactions where import_id = v_import),
         period_end   = (select max(date) from transactions where import_id = v_import)
   where id = v_import;

  insert into activity_logs (entity_type, entity_ids, action_type, description, details,
                             new_data, created_by)
  values ('Importação', coalesce(v_ids, '{}'), 'import',
          'Extrato importado: ' || p_file_name,
          coalesce(v_ins,0) || ' transação(ões) importada(s)',
          jsonb_build_object('import_id', v_import), auth.uid());

  return jsonb_build_object('import_id', v_import,
                            'imported', coalesce(v_ins, 0),
                            'duplicated', v_dup,
                            'total', v_total);
end $$;

-- --------------------------------- reverter um lote de importação
create or replace function revert_import(p_import uuid)
returns jsonb language plpgsql security invoker as $$
declare v_count int;
begin
  if not can_write() then raise exception 'Sem permissão'; end if;

  delete from transactions where import_id = p_import;
  get diagnostics v_count = row_count;

  update statement_imports set status = 'revertido' where id = p_import;

  insert into activity_logs (entity_type, entity_ids, action_type, description, details, created_by)
  values ('Importação', array[p_import], 'revert', 'Importação revertida',
          v_count || ' transação(ões) removida(s)', auth.uid());

  return jsonb_build_object('deleted', v_count);
end $$;

-- ------------------------------------ desfazer um registro de log
create or replace function revert_activity_log(p_log uuid)
returns jsonb language plpgsql security invoker as $$
declare
  v_log activity_logs%rowtype;
  v_n int := 0;
begin
  if not can_write() then raise exception 'Sem permissão'; end if;

  select * into v_log from activity_logs where id = p_log;
  if not found then raise exception 'Log não encontrado'; end if;
  if v_log.reverted then raise exception 'Este registro já foi desfeito'; end if;

  if v_log.action_type = 'create' then
    delete from transactions where id = any(v_log.entity_ids);
    get diagnostics v_n = row_count;

  elsif v_log.action_type in ('update','bulk_update') then
    update transactions t set
      date        = coalesce((p->>'date')::date, t.date),
      description = coalesce(p->>'description', t.description),
      amount      = coalesce((p->>'amount')::numeric, t.amount),
      type        = coalesce(p->>'type', t.type),
      category_id = nullif(p->>'category_id','')::uuid,
      account_id  = nullif(p->>'account_id','')::uuid
    from jsonb_array_elements(
           case when jsonb_typeof(v_log.previous_data) = 'array'
                then v_log.previous_data else jsonb_build_array(v_log.previous_data) end) p
    where t.id = (p->>'id')::uuid;
    get diagnostics v_n = row_count;

  elsif v_log.action_type = 'delete' then
    insert into transactions (id, date, description, amount, type, category_id,
                              account_id, source, notes, created_by)
    select (p->>'id')::uuid, (p->>'date')::date, p->>'description',
           (p->>'amount')::numeric, p->>'type',
           nullif(p->>'category_id','')::uuid, nullif(p->>'account_id','')::uuid,
           coalesce(p->>'source','manual'), p->>'notes', auth.uid()
    from jsonb_array_elements(
           case when jsonb_typeof(v_log.previous_data) = 'array'
                then v_log.previous_data else jsonb_build_array(v_log.previous_data) end) p
    on conflict (id) do nothing;
    get diagnostics v_n = row_count;

  elsif v_log.action_type in ('bulk_create','import') then
    delete from transactions where id = any(v_log.entity_ids);
    get diagnostics v_n = row_count;

  else
    raise exception 'Esta ação não pode ser desfeita';
  end if;

  update activity_logs set reverted = true, reverted_at = now() where id = p_log;

  insert into activity_logs (entity_type, entity_ids, action_type, description, details, created_by)
  values (v_log.entity_type, v_log.entity_ids, 'revert',
          'Operação desfeita: ' || coalesce(v_log.description, v_log.action_type),
          v_n || ' registro(s) afetado(s)', auth.uid());

  return jsonb_build_object('affected', v_n);
end $$;

-- ------------------------------ trava: nunca ficar sem administrador
-- Impede rebaixar (ou apagar) o último admin do sistema — foi assim que o
-- sistema ficou sem ninguém capaz de gerenciar papéis.
create or replace function prevent_last_admin_demotion()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_outros int;
begin
  if tg_op = 'UPDATE' and old.role = 'admin' and new.role <> 'admin' then
    select count(*) into v_outros from profiles where role = 'admin' and id <> old.id;
    if v_outros = 0 then
      raise exception 'Este é o único administrador do sistema. Promova outra pessoa a administrador antes de mudar este papel.';
    end if;
  end if;

  if tg_op = 'DELETE' and old.role = 'admin' then
    select count(*) into v_outros from profiles where role = 'admin' and id <> old.id;
    if v_outros = 0 then
      raise exception 'Não dá para remover o único administrador do sistema.';
    end if;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists trg_last_admin on profiles;
create trigger trg_last_admin
  before update or delete on profiles
  for each row execute function prevent_last_admin_demotion();

-- --------------------- trava: só exclui conta com saldo zerado
-- O saldo da conta é o saldo inicial mais tudo que entrou e saiu nela.
create or replace function prevent_delete_account_with_balance()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_saldo numeric;
begin
  select old.opening_balance
       + coalesce(sum(case when t.type = 'receita' then t.amount else -t.amount end), 0)
    into v_saldo
    from transactions t
   where t.account_id = old.id;

  if round(coalesce(v_saldo, 0), 2) <> 0 then
    raise exception 'A conta "%" tem saldo de R$ % e não pode ser excluída. Zere o saldo antes, ou marque a conta como inativa.',
      old.name, to_char(round(v_saldo, 2), 'FM999999990.00');
  end if;

  return old;
end $$;

drop trigger if exists trg_delete_account on accounts;
create trigger trg_delete_account
  before delete on accounts
  for each row execute function prevent_delete_account_with_balance();


-- ############ 0004_seed.sql ############

-- =====================================================================
-- Seed: contas, categorias base e regras de categorização automática
-- (as demais categorias entram pelo script de migração do Base44)
-- =====================================================================

insert into accounts (name, bank, opening_balance, color) values
  ('Cresol',        'Cresol',        0, '#2a78d6'),
  ('Mercado Pago',  'Mercado Pago',  0, '#eb6834'),
  ('Cora',          'Cora',          0, '#1baf7a')
on conflict (name) do nothing;

insert into categories (name, kind) values
  ('Dízimos e Ofertas',  'receita'),
  ('Dízimos',            'receita'),
  ('Ofertas',            'receita'),
  ('Missões',            'ambos'),
  ('Salários',           'despesa'),
  ('Alimentação',        'despesa'),
  ('Transporte',         'despesa'),
  ('Manutenção',         'despesa'),
  ('Eventos',            'despesa'),
  ('Saúde',              'despesa'),
  ('Estorno ou Devolução','ambos'),
  ('Outros',             'ambos')
on conflict (name) do nothing;

-- Regras equivalentes à categorização automática do sistema antigo,
-- agora editáveis pela tela de Categorias (sem precisar de deploy).
insert into category_rules (pattern, category_id, priority)
select v.pattern, c.id, v.priority
from (values
  ('transferencia pix recebida',      'Dízimos e Ofertas', 10),
  ('transferência pix recebida',      'Dízimos e Ofertas', 10),
  ('transferencia recebida',          'Dízimos e Ofertas', 11),
  ('pagamento com codigo qr pix',     'Dízimos e Ofertas', 12),
  ('pix credito',                     'Dízimos e Ofertas', 13),
  ('rec.pix',                         'Dízimos e Ofertas', 14),
  ('dizimo',                          'Dízimos',           20),
  ('oferta',                          'Ofertas',           21),
  ('supermercado',                    'Alimentação',       30),
  ('alimentacao',                     'Alimentação',       31),
  ('comida',                          'Alimentação',       32),
  ('combustivel',                     'Transporte',        40),
  ('gasolina',                        'Transporte',        41),
  ('transporte',                      'Transporte',        42),
  ('manutencao',                      'Manutenção',        50),
  ('reparo',                          'Manutenção',        51),
  ('evento',                          'Eventos',           60),
  ('festa',                           'Eventos',           61),
  ('salario',                         'Salários',          70),
  ('missao',                          'Missões',           80),
  ('missoes',                         'Missões',           81),
  ('saude',                           'Saúde',             90),
  ('hospital',                        'Saúde',             91)
) as v(pattern, cat, priority)
join categories c on c.name = v.cat
on conflict do nothing;
