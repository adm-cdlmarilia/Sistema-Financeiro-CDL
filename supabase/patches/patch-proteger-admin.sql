-- Patch 4: proteção contra o sistema ficar sem administrador.
-- Cole no SQL Editor do Supabase e execute uma vez.
-- (Antes disso, se você está sem acesso de admin, rode o UPDATE abaixo
--  trocando o e-mail pelo seu:)
--
--   update profiles set role = 'admin' where email = 'SEU-EMAIL';

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
