-- =====================================================
-- Branding bucket replaces customer-files
-- =====================================================
--
-- customer-files was never used by the app. Workspace logos lived in the
-- avatars bucket under <tenant id>/branding/; they now get their own public
-- bucket, one folder per tenant (<tenant id>/logo-<ts>.<ext>). Uploads go
-- through a server-issued signed URL, so no client write policies are added.
--
-- Logos already saved under avatars keep working: the app lets the saved URL
-- through unchanged, and the next upload lands in the branding bucket.
--
-- Mirrors supabase/schemas/storage/buckets.sql.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'branding',
  'branding',
  true,
  2097152,
  '{image/png,image/jpeg,image/webp}'
)
on conflict (id) do update
set public = excluded.public,
    allowed_mime_types = excluded.allowed_mime_types,
    file_size_limit = excluded.file_size_limit;

drop policy if exists "customer_files_select" on storage.objects;
drop policy if exists "customer_files_insert" on storage.objects;
drop policy if exists "customer_files_delete" on storage.objects;

