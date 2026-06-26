-- =============================================================================
-- Storage: public "crm-dash" bucket for user avatars
--
-- The Settings page uploads the profile photo to bucket `crm-dash` under
-- `avatars/<user-id>.<ext>` and stores the public URL in auth user_metadata.
-- Without the bucket + RLS policies the upload fails ("o usuário não consegue
-- mandar a foto"). This provisions both. Idempotent; safe to re-run.
-- =============================================================================

-- Public bucket (avatars are shown across the app, so reads must be public).
insert into storage.buckets (id, name, public)
values ('crm-dash', 'crm-dash', true)
on conflict (id) do update set public = excluded.public;

-- Anyone can read objects in the bucket (the avatar URL is public).
drop policy if exists "crm-dash public read" on storage.objects;
create policy "crm-dash public read"
  on storage.objects for select
  using (bucket_id = 'crm-dash');

-- Authenticated users can upload into the bucket.
drop policy if exists "crm-dash authenticated insert" on storage.objects;
create policy "crm-dash authenticated insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'crm-dash');

-- Owners can overwrite their own objects (the upload uses upsert).
drop policy if exists "crm-dash owner update" on storage.objects;
create policy "crm-dash owner update"
  on storage.objects for update to authenticated
  using (bucket_id = 'crm-dash' and owner = auth.uid())
  with check (bucket_id = 'crm-dash');

-- Owners can delete their own objects.
drop policy if exists "crm-dash owner delete" on storage.objects;
create policy "crm-dash owner delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'crm-dash' and owner = auth.uid());
