-- Jessika's Flip Side v0.8.0 — phone + computer sync
-- =====================================================
-- Idempotent. Run this once (or again safely) in the Supabase
-- SQL Editor, signed in as the project owner.
--
-- What this does:
--   * Tables for items, second-look scans, and a small key-value
--     store (site prefs, settings, mileage). Deletions are
--     tombstones (deleted_at), not silent wipes.
--   * Row Level Security so each signed-in user sees only their
--     own rows (user_id = auth.uid()).
--   * A private Storage bucket named "photos", with per-user
--     folder policies. Paths look like:
--       {user_id}/{item_id}/{photo_id}.jpg
--       {user_id}/scans/{scan_id}/{photo_id}.jpg
--
-- What this does not do:
--   * It does not store an OpenAI / AI key. There is no column
--     for one, and the app will not upload it.
--   * It does not make the bucket public.
--
-- After running this file, run supabase/schema-v2.sql (pairing-code
-- sync: anonymous sign-in, hashed one-time codes, recovery code).
-- Then follow supabase/DASHBOARD-STEPS.md
-- (Allow anonymous sign-ins ON; leave CAPTCHA off).

-- --------------------------------------------------------------------------
-- Tables
-- --------------------------------------------------------------------------

create table if not exists public.items (
  user_id    uuid not null references auth.users (id) on delete cascade,
  id         text not null,
  payload    jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id)
);

create table if not exists public.scans (
  user_id    uuid not null references auth.users (id) on delete cascade,
  id         text not null,
  payload    jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id)
);

-- Small device-safe prefs that are useful on a computer too:
-- enabled selling sites, app settings (never an API key), mileage trips.
create table if not exists public.kv (
  user_id    uuid not null references auth.users (id) on delete cascade,
  key        text not null,
  payload    jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, key)
);

-- --------------------------------------------------------------------------
-- Indexes
-- --------------------------------------------------------------------------

create index if not exists items_user_updated_idx
  on public.items (user_id, updated_at desc);

create index if not exists items_user_deleted_idx
  on public.items (user_id, deleted_at);

create index if not exists scans_user_updated_idx
  on public.scans (user_id, updated_at desc);

create index if not exists scans_user_deleted_idx
  on public.scans (user_id, deleted_at);

create index if not exists kv_user_updated_idx
  on public.kv (user_id, updated_at desc);

-- --------------------------------------------------------------------------
-- Grants (authenticated only — no anon access)
-- --------------------------------------------------------------------------

revoke all on public.items from anon, public;
revoke all on public.scans from anon, public;
revoke all on public.kv    from anon, public;

grant select, insert, update, delete on public.items to authenticated;
grant select, insert, update, delete on public.scans to authenticated;
grant select, insert, update, delete on public.kv    to authenticated;

-- --------------------------------------------------------------------------
-- Row Level Security
-- --------------------------------------------------------------------------

alter table public.items enable row level security;
alter table public.scans enable row level security;
alter table public.kv    enable row level security;

-- Force RLS even for table owners going through the API.
alter table public.items force row level security;
alter table public.scans force row level security;
alter table public.kv    force row level security;

drop policy if exists "items_select_own" on public.items;
drop policy if exists "items_insert_own" on public.items;
drop policy if exists "items_update_own" on public.items;
drop policy if exists "items_delete_own" on public.items;

create policy "items_select_own" on public.items
  for select to authenticated
  using (user_id = auth.uid());

create policy "items_insert_own" on public.items
  for insert to authenticated
  with check (user_id = auth.uid());

create policy "items_update_own" on public.items
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "items_delete_own" on public.items
  for delete to authenticated
  using (user_id = auth.uid());

drop policy if exists "scans_select_own" on public.scans;
drop policy if exists "scans_insert_own" on public.scans;
drop policy if exists "scans_update_own" on public.scans;
drop policy if exists "scans_delete_own" on public.scans;

create policy "scans_select_own" on public.scans
  for select to authenticated
  using (user_id = auth.uid());

create policy "scans_insert_own" on public.scans
  for insert to authenticated
  with check (user_id = auth.uid());

create policy "scans_update_own" on public.scans
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "scans_delete_own" on public.scans
  for delete to authenticated
  using (user_id = auth.uid());

drop policy if exists "kv_select_own" on public.kv;
drop policy if exists "kv_insert_own" on public.kv;
drop policy if exists "kv_update_own" on public.kv;
drop policy if exists "kv_delete_own" on public.kv;

create policy "kv_select_own" on public.kv
  for select to authenticated
  using (user_id = auth.uid());

create policy "kv_insert_own" on public.kv
  for insert to authenticated
  with check (user_id = auth.uid());

create policy "kv_update_own" on public.kv
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "kv_delete_own" on public.kv
  for delete to authenticated
  using (user_id = auth.uid());

-- --------------------------------------------------------------------------
-- Private Storage bucket: photos
-- --------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'photos',
  'photos',
  false,
  10485760, -- 10 MB per file (app already compresses to ~1600px JPEG)
  array['image/jpeg', 'image/jpg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Folder policies: first path segment must be the user's uid.
-- Path shape: {user_id}/...

drop policy if exists "photos_select_own" on storage.objects;
drop policy if exists "photos_insert_own" on storage.objects;
drop policy if exists "photos_update_own" on storage.objects;
drop policy if exists "photos_delete_own" on storage.objects;

create policy "photos_select_own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "photos_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "photos_update_own" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "photos_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Reload PostgREST's schema cache so the new tables are visible immediately.
notify pgrst, 'reload schema';
