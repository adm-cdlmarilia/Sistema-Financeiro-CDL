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
