-- =====================================================================
-- Comprovantes fiscais anexados às transações
--
-- A coluna transactions.attachment_url já existia desde o 0001, mas não
-- havia onde guardar o arquivo. Este script cria o bucket e as regras de
-- acesso dele. Rode uma única vez no SQL Editor do Supabase.
-- =====================================================================

-- Bucket privado: o arquivo só é servido por link assinado, com validade
-- curta, gerado pelo app para quem está logado. Nada fica exposto na web.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'comprovantes',
  'comprovantes',
  false,
  10485760,                                    -- 10 MB por arquivo
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Mesmo desenho de permissão das outras tabelas: todo mundo que está
-- logado enxerga, mas só admin e lancador gravam. can_write() vive no
-- schema public, por isso o nome qualificado aqui dentro do storage.
drop policy if exists comprovantes_select on storage.objects;
create policy comprovantes_select on storage.objects
  for select to authenticated
  using (bucket_id = 'comprovantes');

drop policy if exists comprovantes_insert on storage.objects;
create policy comprovantes_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'comprovantes' and public.can_write());

drop policy if exists comprovantes_update on storage.objects;
create policy comprovantes_update on storage.objects
  for update to authenticated
  using (bucket_id = 'comprovantes' and public.can_write())
  with check (bucket_id = 'comprovantes' and public.can_write());

drop policy if exists comprovantes_delete on storage.objects;
create policy comprovantes_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'comprovantes' and public.can_write());

comment on column transactions.attachment_url is
  'Caminho do comprovante dentro do bucket "comprovantes" (não é uma URL pública: o app gera link assinado na hora de abrir).';
