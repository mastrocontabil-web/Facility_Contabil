-- ==========================================================================
-- 0002_storage.sql — buckets privados + RLS
--
-- Convenção de path: <owner_id>/<statement_id>/<arquivo>
-- A RLS libera o objeto quando a 1ª pasta do path == auth.uid().
-- ==========================================================================

insert into storage.buckets (id, name, public)
values ('statements', 'statements', false), ('exports', 'exports', false)
on conflict (id) do nothing;

-- statements bucket
create policy "statements_read_own" on storage.objects for select
  using (bucket_id = 'statements' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "statements_insert_own" on storage.objects for insert
  with check (bucket_id = 'statements' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "statements_update_own" on storage.objects for update
  using (bucket_id = 'statements' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "statements_delete_own" on storage.objects for delete
  using (bucket_id = 'statements' and (storage.foldername(name))[1] = auth.uid()::text);

-- exports bucket
create policy "exports_read_own" on storage.objects for select
  using (bucket_id = 'exports' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "exports_insert_own" on storage.objects for insert
  with check (bucket_id = 'exports' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "exports_update_own" on storage.objects for update
  using (bucket_id = 'exports' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "exports_delete_own" on storage.objects for delete
  using (bucket_id = 'exports' and (storage.foldername(name))[1] = auth.uid()::text);
