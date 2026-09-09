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
