-- =====================================================================
-- Corrige o Desfazer da tela de Logs
--
-- revert_activity_log decidia o que fazer olhando só o action_type,
-- nunca o entity_type: tratava TODO log como se fosse de transação.
--
-- Com isso, desfazer a exclusão de uma categoria ou de uma conta caía no
-- insert de transactions e estourava
--   null value in column "date" of relation "transactions"
-- porque uma categoria não tem data. Pior que o erro: desfazer a CRIAÇÃO
-- de uma categoria ou conta rodava um delete em transactions que não
-- achava nada, marcava o log como desfeito e não desfazia coisa alguma.
--
-- Agora a função decide primeiro pela entidade, restaura categoria e
-- conta de verdade, e recusa com mensagem clara o que não sabe desfazer,
-- em vez de falhar feio ou mentir que deu certo.
-- =====================================================================

create or replace function revert_activity_log(p_log uuid)
returns jsonb language plpgsql security invoker as $$
declare
  v_log   activity_logs%rowtype;
  v_n     int := 0;
  v_dados jsonb;
begin
  if not can_write() then raise exception 'Sem permissão'; end if;

  select * into v_log from activity_logs where id = p_log;
  if not found then raise exception 'Log não encontrado'; end if;
  if v_log.reverted then raise exception 'Este registro já foi desfeito'; end if;

  -- previous_data às vezes é objeto, às vezes array: normaliza antes de usar
  v_dados := case
    when v_log.previous_data is null or v_log.previous_data = 'null'::jsonb then null
    when jsonb_typeof(v_log.previous_data) = 'array' then v_log.previous_data
    else jsonb_build_array(v_log.previous_data)
  end;

  -- ------------------------------------------------------- transações
  if v_log.entity_type = 'Transação' then

    if v_log.action_type in ('create', 'bulk_create', 'import') then
      delete from transactions where id = any(v_log.entity_ids);
      get diagnostics v_n = row_count;

    elsif v_log.action_type in ('update', 'bulk_update') then
      if v_dados is null then
        raise exception 'Este registro não guardou os dados anteriores, então não dá para desfazer.';
      end if;
      update transactions t set
        date           = coalesce((p->>'date')::date, t.date),
        description    = coalesce(p->>'description', t.description),
        amount         = coalesce((p->>'amount')::numeric, t.amount),
        type           = coalesce(p->>'type', t.type),
        category_id    = nullif(p->>'category_id','')::uuid,
        account_id     = nullif(p->>'account_id','')::uuid,
        attachment_url = nullif(p->>'attachment_url','')
      from jsonb_array_elements(v_dados) p
      where t.id = (p->>'id')::uuid;
      get diagnostics v_n = row_count;

    elsif v_log.action_type = 'delete' then
      if v_dados is null then
        raise exception 'Este registro não guardou os dados anteriores, então não dá para desfazer.';
      end if;
      insert into transactions (id, date, description, amount, type, category_id,
                                account_id, source, notes, attachment_url, created_by)
      select (p->>'id')::uuid, (p->>'date')::date, p->>'description',
             (p->>'amount')::numeric, p->>'type',
             nullif(p->>'category_id','')::uuid, nullif(p->>'account_id','')::uuid,
             coalesce(p->>'source','manual'), p->>'notes',
             nullif(p->>'attachment_url',''), auth.uid()
      from jsonb_array_elements(v_dados) p
      where p->>'date' is not null
      on conflict (id) do nothing;
      get diagnostics v_n = row_count;

    else
      raise exception 'Esta ação não pode ser desfeita';
    end if;

  -- ------------------------------------------------------- categorias
  elsif v_log.entity_type = 'Categoria' then

    if v_log.action_type = 'delete' then
      if v_dados is null then
        raise exception 'Este registro não guardou os dados anteriores, então não dá para desfazer.';
      end if;
      insert into categories (id, name, kind, color, parent_id, is_active)
      select (p->>'id')::uuid, p->>'name', p->>'kind', p->>'color',
             nullif(p->>'parent_id','')::uuid,
             coalesce((p->>'is_active')::boolean, true)
      from jsonb_array_elements(v_dados) p
      where p->>'name' is not null
      on conflict (id) do nothing;
      get diagnostics v_n = row_count;

    elsif v_log.action_type in ('create', 'bulk_create') then
      -- só dá para apagar de volta o que o log identificou
      if v_log.entity_ids is null or array_length(v_log.entity_ids, 1) is null then
        raise exception 'Este registro não guardou quais categorias foram criadas. Exclua manualmente na tela Categorias.';
      end if;
      delete from categories where id = any(v_log.entity_ids);
      get diagnostics v_n = row_count;

    else
      raise exception 'Esta ação em categorias não pode ser desfeita';
    end if;

  -- ------------------------------------------------------- contas
  elsif v_log.entity_type = 'Conta' then
    if not is_admin() then
      raise exception 'Só um administrador pode desfazer alterações de contas';
    end if;

    if v_log.action_type = 'delete' then
      if v_dados is null then
        raise exception 'Este registro não guardou os dados anteriores, então não dá para desfazer.';
      end if;
      insert into accounts (id, name, bank, opening_balance, opening_date, color, is_active)
      select (p->>'id')::uuid, p->>'name', p->>'bank',
             coalesce((p->>'opening_balance')::numeric, 0),
             nullif(p->>'opening_date','')::date, p->>'color',
             coalesce((p->>'is_active')::boolean, true)
      from jsonb_array_elements(v_dados) p
      where p->>'name' is not null
      on conflict (id) do nothing;
      get diagnostics v_n = row_count;

    else
      -- criar e editar conta não guardam o estado anterior
      raise exception 'Só a exclusão de conta pode ser desfeita. Ajuste a conta na tela Contas.';
    end if;

  else
    raise exception 'Esta ação não pode ser desfeita';
  end if;

  if v_n = 0 then
    raise exception 'Nada foi restaurado — os dados do registro podem estar incompletos.';
  end if;

  update activity_logs set reverted = true, reverted_at = now() where id = p_log;

  insert into activity_logs (entity_type, entity_ids, action_type, description, details, created_by)
  values (v_log.entity_type, v_log.entity_ids, 'revert',
          'Operação desfeita: ' || coalesce(v_log.description, v_log.action_type),
          v_n || ' registro(s) afetado(s)', auth.uid());

  return jsonb_build_object('affected', v_n);
end $$;
