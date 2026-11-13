-- Jessika's Flip Side v0.8.0 — pairing-code sync (schema v2)
-- ============================================================
-- Idempotent. Safe to run after schema.sql (already applied),
-- and safe to run again. A fresh project can run this file
-- alone; it creates the v1 tables if they are missing.
--
-- Why this file exists:
--   The free plan cannot edit Auth email templates without
--   custom SMTP, so sign-in is a no-email pairing code.
--   The first device signs in anonymously. "Connect another
--   device" shows an 8-character one-time code. The other
--   device types it, and an RPC links both to the same owner.
--
-- What this does:
--   * A sync_owners row is the account. items, scans, kv, and
--     photos are keyed on that owner id (the user_id column),
--     not on auth.uid().
--   * device_links maps each signed-in auth user (anonymous
--     or, later, email) to an owner. Two devices share data
--     because they share an owner.
--   * Pairing codes are stored hashed, expire in 10 minutes,
--     are single-use, and guesses are rate-limited.
--   * A longer recovery code is stored hashed and shown to
--     the first device once, so she can get her data back if
--     both devices are lost.
--   * Row Level Security uses current_owner_id(). Direct
--     access to the link and code tables is denied; only
--     these RPCs can write them.
--   * Stale expired codes and unpaired anonymous users (24h,
--     no link, no data) are cleaned up when an RPC runs.
--
-- What this does not do:
--   * It does not store an OpenAI / AI key. There is no
--     column for one, and the app will not upload it.
--   * It does not send email. Email OTP can be turned on
--     later in the app if a custom domain is set up; this
--     schema already allows an email auth user to be linked
--     the same way as an anonymous one.
--   * It does not make the photos bucket public.
--
-- After running, follow supabase/DASHBOARD-STEPS.md
-- (Allow anonymous sign-ins ON; leave CAPTCHA off).

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- Local postgres may already have pgcrypto in "public". The RPCs
-- call extensions.digest and extensions.gen_random_bytes, so wrap
-- them if the extension itself did not land in "extensions".
do $$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'extensions' and p.proname = 'digest'
      and pg_get_function_identity_arguments(p.oid) in ('bytea, text', 'text, text')
  ) then
    execute $fn$
      create or replace function extensions.digest(bytea, text) returns bytea
      language sql immutable as 'select public.digest($1, $2)'
    $fn$;
    execute $fn$
      create or replace function extensions.digest(text, text) returns bytea
      language sql immutable as 'select public.digest($1, $2)'
    $fn$;
  end if;
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'extensions' and p.proname = 'gen_random_bytes'
  ) then
    execute $fn$
      create or replace function extensions.gen_random_bytes(integer) returns bytea
      language sql as 'select public.gen_random_bytes($1)'
    $fn$;
  end if;
end $$;

-- --------------------------------------------------------------------------
-- v1 tables (no-op if schema.sql already ran)
-- --------------------------------------------------------------------------

create table if not exists public.items (
  user_id    uuid not null,
  id         text not null,
  payload    jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id)
);

create table if not exists public.scans (
  user_id    uuid not null,
  id         text not null,
  payload    jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id)
);

create table if not exists public.kv (
  user_id    uuid not null,
  key        text not null,
  payload    jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, key)
);

create index if not exists items_user_updated_idx on public.items (user_id, updated_at desc);
create index if not exists items_user_deleted_idx on public.items (user_id, deleted_at);
create index if not exists scans_user_updated_idx on public.scans (user_id, updated_at desc);
create index if not exists scans_user_deleted_idx on public.scans (user_id, deleted_at);
create index if not exists kv_user_updated_idx    on public.kv    (user_id, updated_at desc);

-- --------------------------------------------------------------------------
-- v2 tables
-- --------------------------------------------------------------------------

-- The shared account. items.user_id / scans.user_id / kv.user_id
-- and the first folder of a photo path are this id.
create table if not exists public.sync_owners (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

-- One row per signed-in device (auth.uid()). Several rows may
-- share an owner_id — that is how two devices see the same data.
create table if not exists public.device_links (
  user_id    uuid primary key,
  owner_id   uuid not null references public.sync_owners (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  revoked_at timestamptz
);

-- If auth.users is present, keep a cascade so a deleted auth
-- user drops its link. Safe to skip in a local stub.
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'auth' and table_name = 'users') then
    begin
      alter table public.device_links
        drop constraint if exists device_links_user_id_fkey;
      alter table public.device_links
        add constraint device_links_user_id_fkey
        foreign key (user_id) references auth.users (id) on delete cascade;
    exception when others then
      -- Stub or permission: leave the table without that FK.
      null;
    end;
  end if;
end $$;

create index if not exists device_links_owner_idx
  on public.device_links (owner_id)
  where revoked_at is null;

-- 8-character one-time pairing codes. Only the hash is stored.
create table if not exists public.pairing_codes (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references public.sync_owners (id) on delete cascade,
  created_by      uuid not null,
  code_hash       text not null,
  expires_at      timestamptz not null,
  used_at         timestamptz,
  used_by         uuid,
  failed_attempts integer not null default 0,
  created_at      timestamptz not null default now()
);

create index if not exists pairing_codes_hash_idx
  on public.pairing_codes (code_hash)
  where used_at is null;

create index if not exists pairing_codes_owner_idx
  on public.pairing_codes (owner_id, created_at desc);

-- Guess log, for per-user rate limits.
create table if not exists public.pairing_attempts (
  id       bigserial primary key,
  user_id  uuid not null,
  at       timestamptz not null default now(),
  ok       boolean not null default false,
  kind     text not null default 'pairing' -- 'pairing' | 'recovery'
);

create index if not exists pairing_attempts_user_idx
  on public.pairing_attempts (user_id, at desc);

-- Long-lived recovery code, stored hashed, shown once by the app.
-- One active code per owner. Rotating inserts a new row and revokes the old.
create table if not exists public.recovery_codes (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references public.sync_owners (id) on delete cascade,
  code_hash       text not null,
  created_at      timestamptz not null default now(),
  revoked_at      timestamptz,
  failed_attempts integer not null default 0,
  locked_until    timestamptz
);

create unique index if not exists recovery_codes_one_active
  on public.recovery_codes (owner_id)
  where revoked_at is null;

-- --------------------------------------------------------------------------
-- RLS on the new tables: no direct client access. RPCs are security definer.
-- --------------------------------------------------------------------------

alter table public.sync_owners      enable row level security;
alter table public.device_links     enable row level security;
alter table public.pairing_codes    enable row level security;
alter table public.pairing_attempts enable row level security;
alter table public.recovery_codes   enable row level security;

alter table public.sync_owners      force row level security;
alter table public.device_links     force row level security;
alter table public.pairing_codes    force row level security;
alter table public.pairing_attempts force row level security;
alter table public.recovery_codes   force row level security;

revoke all on public.sync_owners      from anon, public, authenticated;
revoke all on public.device_links     from anon, public, authenticated;
revoke all on public.pairing_codes    from anon, public, authenticated;
revoke all on public.pairing_attempts from anon, public, authenticated;
revoke all on public.recovery_codes   from anon, public, authenticated;

-- --------------------------------------------------------------------------
-- Code helpers (unambiguous 32-char alphabet: no 0/O, 1/I; L is kept)
-- --------------------------------------------------------------------------

drop function if exists public.normalize_sync_code(text);
create or replace function public.normalize_sync_code(p_code text)
returns text
language sql
immutable
as $$
  -- Uppercase, strip spaces, dashes, and look-alike characters
  -- that are not in the alphabet.
  select regexp_replace(upper(trim(coalesce(p_code, ''))), '[^23456789ABCDEFGHJKLMNPQRSTUVWXYZ]', '', 'g');
$$;

drop function if exists public.format_sync_code(text);
create or replace function public.format_sync_code(p_code text)
returns text
language sql
immutable
as $$
  select trim(both '-' from regexp_replace(public.normalize_sync_code(p_code), '(.{4})', '\1-', 'g'));
$$;

drop function if exists public.hash_sync_code(text);
create or replace function public.hash_sync_code(p_code text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select encode(extensions.digest(convert_to(public.normalize_sync_code(p_code), 'UTF8'), 'sha256'), 'hex');
$$;

drop function if exists public.generate_sync_code(integer);
create or replace function public.generate_sync_code(p_len integer)
returns text
language plpgsql
set search_path = public, extensions
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  result text := '';
  b bytea;
  i int;
begin
  if p_len is null or p_len < 6 or p_len > 32 then
    raise exception 'invalid length';
  end if;
  -- 32-char alphabet, 256 is divisible by 32, so this is uniform.
  b := extensions.gen_random_bytes(p_len);
  for i in 0 .. p_len - 1 loop
    result := result || substr(alphabet, (get_byte(b, i) % 32) + 1, 1);
  end loop;
  return result;
end;
$$;

-- --------------------------------------------------------------------------
-- current_owner_id: used by RLS on items/scans/kv/photos
-- --------------------------------------------------------------------------

-- CREATE OR REPLACE only: policies on items/scans/kv/photos depend on
-- this function, so a DROP would fail on a second run.
create or replace function public.current_owner_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select owner_id
  from public.device_links
  where user_id = auth.uid()
    and revoked_at is null
  limit 1;
$$;

-- --------------------------------------------------------------------------
-- Housekeeping: expired codes, old guess rows, unpaired anonymous users
-- --------------------------------------------------------------------------

drop function if exists public.cleanup_stale_sync();
create or replace function public.cleanup_stale_sync()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.pairing_codes
   where (used_at is null and expires_at < now() - interval '1 hour')
      or (used_at is not null and used_at < now() - interval '1 day');

  delete from public.pairing_attempts
   where at < now() - interval '2 days';

  -- Unpaired anonymous auth users older than 24 hours, with no
  -- link and no leftover rows. Failures are ignored (permissions
  -- or a stub auth schema).
  begin
    if exists (select 1 from information_schema.tables
               where table_schema = 'auth' and table_name = 'users') then
      delete from auth.users u
       where coalesce(u.is_anonymous, false) = true
         and u.created_at < now() - interval '24 hours'
         and not exists (
           select 1 from public.device_links d where d.user_id = u.id
         )
         and not exists (
           select 1 from public.items i where i.user_id = u.id
         )
         and not exists (
           select 1 from public.scans s where s.user_id = u.id
         )
         and not exists (
           select 1 from public.kv k where k.user_id = u.id
         );
    end if;
  exception when others then
    null;
  end;
end;
$$;

-- --------------------------------------------------------------------------
-- Migrate v1 rows (user_id was auth.uid()) and retarget FKs to sync_owners
-- --------------------------------------------------------------------------

do $$
declare
  r record;
  conname text;
  t text;
begin
  -- Create an owner for any existing v1 user_id, keeping the same uuid
  -- so we do not have to rewrite item rows or photo paths.
  insert into public.sync_owners (id)
  select distinct x.user_id
    from (
      select user_id from public.items
      union
      select user_id from public.scans
      union
      select user_id from public.kv
    ) x
   where x.user_id is not null
     and not exists (select 1 from public.sync_owners o where o.id = x.user_id)
  on conflict (id) do nothing;

  -- If those ids are auth users, link them to the owner of the same id.
  begin
    if exists (select 1 from information_schema.tables
               where table_schema = 'auth' and table_name = 'users') then
      insert into public.device_links (user_id, owner_id)
      select u.id, u.id
        from auth.users u
       where exists (select 1 from public.sync_owners o where o.id = u.id)
      on conflict (user_id) do nothing;
    end if;
  exception when others then
    null;
  end;

  -- Drop FKs that still point at auth.users, then point at sync_owners.
  foreach t in array array['items', 'scans', 'kv'] loop
    for conname in
      select c.conname
        from pg_constraint c
        join pg_class rel on rel.oid = c.conrelid
        join pg_namespace n on n.oid = rel.relnamespace
       where n.nspname = 'public'
         and rel.relname = t
         and c.contype = 'f'
         and pg_get_constraintdef(c.oid) ilike '%auth.users%'
    loop
      execute format('alter table public.%I drop constraint %I', t, conname);
    end loop;

    if not exists (
      select 1 from pg_constraint c
        join pg_class rel on rel.oid = c.conrelid
        join pg_namespace n on n.oid = rel.relnamespace
       where n.nspname = 'public'
         and rel.relname = t
         and c.conname = t || '_user_id_owner_fkey'
    ) then
      execute format(
        'alter table public.%I add constraint %I foreign key (user_id) references public.sync_owners (id) on delete cascade',
        t, t || '_user_id_owner_fkey'
      );
    end if;
  end loop;
end $$;

-- --------------------------------------------------------------------------
-- Grants on data tables (authenticated only) and RLS keyed on owner
-- --------------------------------------------------------------------------

revoke all on public.items from anon, public;
revoke all on public.scans from anon, public;
revoke all on public.kv    from anon, public;

grant select, insert, update, delete on public.items to authenticated;
grant select, insert, update, delete on public.scans to authenticated;
grant select, insert, update, delete on public.kv    to authenticated;

alter table public.items enable row level security;
alter table public.scans enable row level security;
alter table public.kv    enable row level security;
alter table public.items force row level security;
alter table public.scans force row level security;
alter table public.kv    force row level security;

drop policy if exists "items_select_own" on public.items;
drop policy if exists "items_insert_own" on public.items;
drop policy if exists "items_update_own" on public.items;
drop policy if exists "items_delete_own" on public.items;

create policy "items_select_own" on public.items
  for select to authenticated
  using (user_id = public.current_owner_id());

create policy "items_insert_own" on public.items
  for insert to authenticated
  with check (user_id = public.current_owner_id());

create policy "items_update_own" on public.items
  for update to authenticated
  using (user_id = public.current_owner_id())
  with check (user_id = public.current_owner_id());

create policy "items_delete_own" on public.items
  for delete to authenticated
  using (user_id = public.current_owner_id());

drop policy if exists "scans_select_own" on public.scans;
drop policy if exists "scans_insert_own" on public.scans;
drop policy if exists "scans_update_own" on public.scans;
drop policy if exists "scans_delete_own" on public.scans;

create policy "scans_select_own" on public.scans
  for select to authenticated
  using (user_id = public.current_owner_id());

create policy "scans_insert_own" on public.scans
  for insert to authenticated
  with check (user_id = public.current_owner_id());

create policy "scans_update_own" on public.scans
  for update to authenticated
  using (user_id = public.current_owner_id())
  with check (user_id = public.current_owner_id());

create policy "scans_delete_own" on public.scans
  for delete to authenticated
  using (user_id = public.current_owner_id());

drop policy if exists "kv_select_own" on public.kv;
drop policy if exists "kv_insert_own" on public.kv;
drop policy if exists "kv_update_own" on public.kv;
drop policy if exists "kv_delete_own" on public.kv;

create policy "kv_select_own" on public.kv
  for select to authenticated
  using (user_id = public.current_owner_id());

create policy "kv_insert_own" on public.kv
  for insert to authenticated
  with check (user_id = public.current_owner_id());

create policy "kv_update_own" on public.kv
  for update to authenticated
  using (user_id = public.current_owner_id())
  with check (user_id = public.current_owner_id());

create policy "kv_delete_own" on public.kv
  for delete to authenticated
  using (user_id = public.current_owner_id());

-- --------------------------------------------------------------------------
-- Private photos bucket: first path segment is the owner id
-- --------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (
      'photos',
      'photos',
      false,
      10485760,
      array['image/jpeg', 'image/jpg', 'image/png', 'image/webp']::text[]
    )
    on conflict (id) do update
      set public = excluded.public,
          file_size_limit = excluded.file_size_limit,
          allowed_mime_types = excluded.allowed_mime_types;

    drop policy if exists "photos_select_own" on storage.objects;
    drop policy if exists "photos_insert_own" on storage.objects;
    drop policy if exists "photos_update_own" on storage.objects;
    drop policy if exists "photos_delete_own" on storage.objects;

    create policy "photos_select_own" on storage.objects
      for select to authenticated
      using (
        bucket_id = 'photos'
        and (storage.foldername(name))[1] = public.current_owner_id()::text
      );

    create policy "photos_insert_own" on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'photos'
        and (storage.foldername(name))[1] = public.current_owner_id()::text
      );

    create policy "photos_update_own" on storage.objects
      for update to authenticated
      using (
        bucket_id = 'photos'
        and (storage.foldername(name))[1] = public.current_owner_id()::text
      )
      with check (
        bucket_id = 'photos'
        and (storage.foldername(name))[1] = public.current_owner_id()::text
      );

    create policy "photos_delete_own" on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'photos'
        and (storage.foldername(name))[1] = public.current_owner_id()::text
      );
  end if;
end $$;

-- --------------------------------------------------------------------------
-- RPCs
-- --------------------------------------------------------------------------

-- Called after anonymous (or later, email) sign-in on a first device.
-- If this device is already linked, returns the owner and no recovery code.
-- If not, creates an owner, links this device, and returns a recovery code
-- that will never be returned again.
drop function if exists public.ensure_sync_owner();
create or replace function public.ensure_sync_owner()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  uid uuid := auth.uid();
  oid uuid;
  raw_code text;
begin
  if uid is null then
    raise exception 'Please turn on sync first.' using errcode = '28000';
  end if;

  perform public.cleanup_stale_sync();

  select owner_id into oid
    from public.device_links
   where user_id = uid and revoked_at is null;

  if oid is not null then
    update public.device_links set last_seen = now() where user_id = uid;
    return jsonb_build_object('owner_id', oid, 'is_new', false, 'recovery_code', null);
  end if;

  -- A previously revoked link on this same auth user: do not silently
  -- create a second owner. Ask them to use a code.
  if exists (select 1 from public.device_links where user_id = uid) then
    raise exception 'This device was turned off. Type a code from your other device, or your recovery code, to connect it again.'
      using errcode = 'P0004';
  end if;

  insert into public.sync_owners (id) values (gen_random_uuid()) returning id into oid;
  raw_code := public.generate_sync_code(16);

  insert into public.device_links (user_id, owner_id) values (uid, oid);
  insert into public.recovery_codes (owner_id, code_hash)
    values (oid, public.hash_sync_code(raw_code));

  return jsonb_build_object(
    'owner_id', oid,
    'is_new', true,
    'recovery_code', public.format_sync_code(raw_code)
  );
end;
$$;

-- Show an 8-character one-time code on a device that is already synced.
drop function if exists public.create_pairing_code();
create or replace function public.create_pairing_code()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  uid uuid := auth.uid();
  oid uuid;
  raw_code text;
  created_recent int;
begin
  if uid is null then
    raise exception 'Please turn on sync first.' using errcode = '28000';
  end if;

  oid := public.current_owner_id();
  if oid is null then
    raise exception 'Please turn on sync first.' using errcode = '28000';
  end if;

  perform public.cleanup_stale_sync();

  select count(*) into created_recent
    from public.pairing_codes
   where owner_id = oid
     and created_at > now() - interval '1 hour';
  if created_recent >= 8 then
    raise exception 'Please wait a few minutes and try again.' using errcode = 'P0003';
  end if;

  -- Only one active code at a time: expire any unused ones.
  update public.pairing_codes
     set expires_at = least(expires_at, now())
   where owner_id = oid
     and used_at is null
     and expires_at > now();

  raw_code := public.generate_sync_code(8);

  insert into public.pairing_codes (owner_id, created_by, code_hash, expires_at)
  values (oid, uid, public.hash_sync_code(raw_code), now() + interval '10 minutes');

  update public.device_links set last_seen = now() where user_id = uid;

  return jsonb_build_object(
    'code', public.format_sync_code(raw_code),
    'expires_at', (now() + interval '10 minutes')
  );
end;
$$;

-- Shared rate-limit + lookup helper for redeeming a code.
-- Returns a generic failure for any miss, expiry, or lockout.
drop function if exists public._redeem_prepare(text, text);
create or replace function public._rate_limit_guesses(p_uid uuid, p_kind text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  fails int;
begin
  select count(*) into fails
    from public.pairing_attempts
   where user_id = p_uid
     and kind = p_kind
     and ok = false
     and at > now() - interval '15 minutes';
  if fails >= 8 then
    return false;
  end if;
  return true;
end;
$$;

-- Returned to the client instead of RAISE after a guess is logged.
-- A raised exception would roll back the log row, so rate limits
-- would never stick. The app treats {ok:false} as the error.
drop function if exists public._rpc_err(text, text);
create or replace function public._rpc_err(p_code text, p_msg text)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object('ok', false, 'error', p_msg, 'code', p_code);
$$;


-- Re-link a previously revoked auth user, or insert a new link.
-- Not granted to clients.
drop function if exists public._link_device(uuid, uuid);
create or replace function public._link_device(p_uid uuid, p_oid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.device_links (user_id, owner_id, revoked_at, last_seen)
  values (p_uid, p_oid, null, now())
  on conflict (user_id) do update
    set owner_id = excluded.owner_id,
        revoked_at = null,
        last_seen = now();
end;
$$;

drop function if exists public.redeem_pairing_code(text);
create or replace function public.redeem_pairing_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  uid uuid := auth.uid();
  existing uuid;
  rec public.pairing_codes%rowtype;
  norm text;
  h text;
  device_count int;
begin
  if uid is null then
    raise exception 'Please turn on sync first.' using errcode = '28000';
  end if;

  perform public.cleanup_stale_sync();
  -- Return (do not raise) after logging a guess, so the log commits.
  if not public._rate_limit_guesses(uid, 'pairing') then
    return public._rpc_err('P0003', 'Please wait a few minutes and try again.');
  end if;

  select owner_id into existing
    from public.device_links
   where user_id = uid and revoked_at is null;

  norm := public.normalize_sync_code(p_code);
  if length(norm) <> 8 then
    insert into public.pairing_attempts (user_id, ok, kind) values (uid, false, 'pairing');
    return public._rpc_err('P0001', 'That code didn''t work or it expired. Ask the other device for a new one.');
  end if;

  h := public.hash_sync_code(norm);

  select * into rec
    from public.pairing_codes
   where code_hash = h
     and used_at is null
     and expires_at > now()
   for update;

  if not found or rec.failed_attempts >= 8 then
    -- If we found an over-attempted code, expire it. Do not reveal which.
    if rec.id is not null and rec.failed_attempts >= 8 then
      update public.pairing_codes
         set expires_at = least(expires_at, now())
       where id = rec.id;
    end if;
    insert into public.pairing_attempts (user_id, ok, kind) values (uid, false, 'pairing');
    update public.pairing_codes
       set failed_attempts = failed_attempts + 1
     where code_hash = h and used_at is null and expires_at > now();
    return public._rpc_err('P0001', 'That code didn''t work or it expired. Ask the other device for a new one.');
  end if;

  -- Already linked to this same owner: treat as success, consume the code.
  if existing is not null then
    if existing = rec.owner_id then
      update public.pairing_codes
         set used_at = now(), used_by = uid
       where id = rec.id;
      insert into public.pairing_attempts (user_id, ok, kind) values (uid, true, 'pairing');
      return jsonb_build_object('ok', true, 'owner_id', existing, 'already_linked', true);
    end if;
    insert into public.pairing_attempts (user_id, ok, kind) values (uid, false, 'pairing');
    return public._rpc_err('P0004', 'This device is already synced. Turn off sync on this device first if you want to connect it to a different one.');
  end if;

  select count(*) into device_count
    from public.device_links
   where owner_id = rec.owner_id and revoked_at is null;
  if device_count >= 6 then
    insert into public.pairing_attempts (user_id, ok, kind) values (uid, false, 'pairing');
    return public._rpc_err('P0005', 'This account already has the maximum number of devices. Turn off sync on one you no longer use, then try again.');
  end if;

  perform public._link_device(uid, rec.owner_id);
  update public.pairing_codes
     set used_at = now(), used_by = uid
   where id = rec.id;
  insert into public.pairing_attempts (user_id, ok, kind) values (uid, true, 'pairing');

  return jsonb_build_object('ok', true, 'owner_id', rec.owner_id, 'already_linked', false);
end;
$$;

drop function if exists public.redeem_recovery_code(text);
create or replace function public.redeem_recovery_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  uid uuid := auth.uid();
  existing uuid;
  rec public.recovery_codes%rowtype;
  norm text;
  h text;
  device_count int;
begin
  if uid is null then
    raise exception 'Please turn on sync first.' using errcode = '28000';
  end if;

  perform public.cleanup_stale_sync();
  if not public._rate_limit_guesses(uid, 'recovery') then
    return public._rpc_err('P0003', 'Please wait a few minutes and try again.');
  end if;

  select owner_id into existing
    from public.device_links
   where user_id = uid and revoked_at is null;

  norm := public.normalize_sync_code(p_code);
  if length(norm) <> 16 then
    insert into public.pairing_attempts (user_id, ok, kind) values (uid, false, 'recovery');
    return public._rpc_err('P0001', 'That recovery code didn''t work. Check it and try again.');
  end if;

  h := public.hash_sync_code(norm);

  select * into rec
    from public.recovery_codes
   where code_hash = h
     and revoked_at is null
   for update;

  if not found then
    insert into public.pairing_attempts (user_id, ok, kind) values (uid, false, 'recovery');
    return public._rpc_err('P0001', 'That recovery code didn''t work. Check it and try again.');
  end if;

  if rec.locked_until is not null and rec.locked_until > now() then
    insert into public.pairing_attempts (user_id, ok, kind) values (uid, false, 'recovery');
    return public._rpc_err('P0003', 'Please wait a few minutes and try again.');
  end if;

  -- A matching hash means the code is correct — no failed_attempts increment.

  if existing is not null then
    if existing = rec.owner_id then
      insert into public.pairing_attempts (user_id, ok, kind) values (uid, true, 'recovery');
      return jsonb_build_object('ok', true, 'owner_id', existing, 'already_linked', true);
    end if;
    insert into public.pairing_attempts (user_id, ok, kind) values (uid, false, 'recovery');
    return public._rpc_err('P0004', 'This device is already synced. Turn off sync on this device first if you want to connect it to a different one.');
  end if;

  select count(*) into device_count
    from public.device_links
   where owner_id = rec.owner_id and revoked_at is null;
  if device_count >= 6 then
    insert into public.pairing_attempts (user_id, ok, kind) values (uid, false, 'recovery');
    return public._rpc_err('P0005', 'This account already has the maximum number of devices. Turn off sync on one you no longer use, then try again.');
  end if;

  -- Recovery stays valid (it is her backup). Reset any lock.
  update public.recovery_codes
     set failed_attempts = 0, locked_until = null
   where id = rec.id;

  perform public._link_device(uid, rec.owner_id);
  insert into public.pairing_attempts (user_id, ok, kind) values (uid, true, 'recovery');

  return jsonb_build_object('ok', true, 'owner_id', rec.owner_id, 'already_linked', false);
end;
$$;

-- Wrong recovery guesses against a known hash are hard (we only have the
-- hash). The per-user rate limit is the main brake. If someone submits a
-- 16-char code whose hash matches but we want to record misses on the
-- row: that only happens for wrong codes, which we cannot attach to a
-- row without a match. Good — we don't update failed_attempts on a miss
-- that we cannot attribute. The per-user limit covers it.

-- Issue a new recovery code from a signed-in device. The old one stops
-- working. The new one is returned once.
drop function if exists public.rotate_recovery_code();
create or replace function public.rotate_recovery_code()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  uid uuid := auth.uid();
  oid uuid;
  raw_code text;
  recent int;
begin
  if uid is null then
    raise exception 'Please turn on sync first.' using errcode = '28000';
  end if;
  oid := public.current_owner_id();
  if oid is null then
    raise exception 'Please turn on sync first.' using errcode = '28000';
  end if;

  select count(*) into recent
    from public.recovery_codes
   where owner_id = oid and created_at > now() - interval '1 hour';
  if recent >= 4 then
    raise exception 'Please wait a few minutes and try again.' using errcode = 'P0003';
  end if;

  raw_code := public.generate_sync_code(16);
  update public.recovery_codes
     set revoked_at = now()
   where owner_id = oid and revoked_at is null;
  insert into public.recovery_codes (owner_id, code_hash)
    values (oid, public.hash_sync_code(raw_code));

  return jsonb_build_object(
    'recovery_code', public.format_sync_code(raw_code)
  );
end;
$$;

-- Turn off sync on this device only. Other devices and the data stay.
drop function if exists public.revoke_this_device();
create or replace function public.revoke_this_device()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    return jsonb_build_object('ok', true, 'revoked', false);
  end if;
  update public.device_links
     set revoked_at = now()
   where user_id = uid and revoked_at is null;
  return jsonb_build_object('ok', true, 'revoked', true);
end;
$$;

-- --------------------------------------------------------------------------
-- Execute grants. New functions default to PUBLIC execute — revoke that.
-- --------------------------------------------------------------------------

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'normalize_sync_code(text)',
    'format_sync_code(text)',
    'hash_sync_code(text)',
    'generate_sync_code(integer)',
    'current_owner_id()',
    'cleanup_stale_sync()',
    'ensure_sync_owner()',
    'create_pairing_code()',
    '_rate_limit_guesses(uuid, text)',
    '_link_device(uuid, uuid)',
    '_rpc_err(text, text)',
    'redeem_pairing_code(text)',
    'redeem_recovery_code(text)',
    'rotate_recovery_code()',
    'revoke_this_device()'
  ] loop
    execute format('revoke all on function public.%s from public, anon', fn);
  end loop;
end $$;

-- Clients may call these:
grant execute on function public.current_owner_id()        to authenticated;
grant execute on function public.ensure_sync_owner()       to authenticated;
grant execute on function public.create_pairing_code()     to authenticated;
grant execute on function public.redeem_pairing_code(text) to authenticated;
grant execute on function public.redeem_recovery_code(text) to authenticated;
grant execute on function public.rotate_recovery_code()    to authenticated;
grant execute on function public.revoke_this_device()      to authenticated;
-- Helpers used by the RPCs are not granted to clients.
-- generate / hash / normalize stay revoked from authenticated
-- so a client cannot mint or inspect hashes directly.
grant execute on function public.normalize_sync_code(text) to authenticated;
grant execute on function public.format_sync_code(text)    to authenticated;

-- The bigserial on pairing_attempts: no client grants needed
-- (only security definer writes). Revoke just in case.
revoke all on sequence public.pairing_attempts_id_seq from anon, public, authenticated;

notify pgrst, 'reload schema';
