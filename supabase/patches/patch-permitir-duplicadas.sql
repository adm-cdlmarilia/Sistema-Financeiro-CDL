-- Patch 3: a importação passa a gravar TODAS as linhas do arquivo.
-- Lançamentos repetidos (mesma data, descrição e valor) são legítimos.
-- Cole no SQL Editor do Supabase e execute uma vez.

-- 1) o mesmo arquivo pode ser reimportado
drop index if exists idx_imports_hash;
create index if not exists idx_imports_hash on statement_imports (file_hash);

-- 2) função de importação sem deduplicação
-- ---------------------------------------- importação (sem filtro de duplicidade)
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

