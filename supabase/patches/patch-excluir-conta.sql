-- Patch 5: exclusão de conta só quando o saldo estiver zerado.
-- Cole no SQL Editor do Supabase e execute uma vez.

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
