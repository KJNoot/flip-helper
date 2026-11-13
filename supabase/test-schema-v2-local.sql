-- Local checks for schema-v2.sql. Not for the hosted project.
-- Run after schema-v2.sql against a throwaway database that has
-- a stub auth.uid() (see the comments at the top of the runner).

\set ON_ERROR_STOP on

-- Alphabet / normalize / format
select case when public.normalize_sync_code('ab-cd 0o1il ef') = 'ABCDLEF' then 'ok' else public.normalize_sync_code('ab-cd 0o1il ef') end as normalize;
select case when public.format_sync_code('23456789') = '2345-6789' then 'ok' else public.format_sync_code('23456789') end as format8;
select case when public.format_sync_code('23456789ABCDEFGH') = '2345-6789-ABCD-EFGH' then 'ok' else public.format_sync_code('23456789ABCDEFGH') end as format16;

-- Hash is stable, 64 hex chars, and does not contain the plaintext.
select case
  when public.hash_sync_code('23456789') = public.hash_sync_code('2345-6789')
   and public.hash_sync_code('23456789') !~ '23456789'
   and length(public.hash_sync_code('23456789')) = 64
  then 'ok' else 'hash failed' end as hash_ok;

-- Codes come from the alphabet and are the requested length.
select case
  when length(public.generate_sync_code(8)) = 8
   and public.generate_sync_code(8) ~ '^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$'
   and length(public.generate_sync_code(16)) = 16
  then 'ok' else 'generate failed' end as generate_ok;

-- Two devices, one owner, items visible to both, recovery works.
do $$
declare
  u1 uuid := gen_random_uuid();
  u2 uuid := gen_random_uuid();
  u3 uuid := gen_random_uuid();
  r1 jsonb;
  r2 jsonb;
  rec jsonb;
  pair jsonb;
  oid uuid;
  item_count int;
  code text;
  recovery text;
  wrong text;
begin
  -- Satisfy device_links FK if auth.users exists.
  begin
    insert into auth.users (id, is_anonymous) values (u1, true), (u2, true), (u3, true)
    on conflict (id) do nothing;
  exception when undefined_table then null;
  end;

  -- First device
  perform set_config('request.jwt.claim.sub', u1::text, true);
  r1 := public.ensure_sync_owner();
  if not (r1->>'is_new')::boolean then raise exception 'expected a new owner'; end if;
  recovery := r1->>'recovery_code';
  oid := (r1->>'owner_id')::uuid;
  if recovery is null or public.normalize_sync_code(recovery) is null
     or length(public.normalize_sync_code(recovery)) <> 16 then
    raise exception 'expected a 16-char recovery code';
  end if;
  rec := public.ensure_sync_owner();
  if rec->>'recovery_code' is not null then
    raise exception 'recovery code must only be returned once';
  end if;
  if exists (select 1 from public.recovery_codes where code_hash is null)
     or exists (
       select 1 from public.recovery_codes
        where code_hash = public.normalize_sync_code(recovery)
     ) then
    raise exception 'recovery plaintext was stored';
  end if;

  pair := public.create_pairing_code();
  code := pair->>'code';
  if length(public.normalize_sync_code(code)) <> 8 then
    raise exception 'expected an 8-char pairing code';
  end if;

  -- Second device joins. Must not call ensure_sync_owner.
  perform set_config('request.jwt.claim.sub', u2::text, true);
  r2 := public.redeem_pairing_code(code);
  if (r2->>'owner_id')::uuid is distinct from oid then
    raise exception 'devices did not share the owner';
  end if;

  -- Used code fails (returned, not raised, so the guess log commits)
  r2 := public.redeem_pairing_code(code);
  if coalesce(r2->>'ok', 'true') <> 'false' then
    raise exception 'used code should fail';
  end if;

  -- First device writes an item; second can read it (RLS).
  -- Superusers bypass even FORCE RLS, so drop to the authenticated role.
  execute 'set role authenticated';
  perform set_config('request.jwt.claim.sub', u1::text, true);
  insert into public.items (user_id, id, payload, updated_at)
  values (public.current_owner_id(), 'lamp', '{"title":"Lamp"}'::jsonb, now());

  perform set_config('request.jwt.claim.sub', u2::text, true);
  select count(*) into item_count from public.items where id = 'lamp';
  if item_count <> 1 then raise exception 'second device cannot see the item'; end if;

  -- A third, unsigned-to-this-owner session cannot see it.
  perform set_config('request.jwt.claim.sub', u3::text, true);
  select count(*) into item_count from public.items where id = 'lamp';
  if item_count <> 0 then raise exception 'unlinked user should not see the item'; end if;

  -- Wrong code: generic error, then recovery works for u3.
  r2 := public.redeem_pairing_code('22222222');
  if coalesce(r2->>'ok', 'true') <> 'false' or r2->>'error' not ilike '%didn%t work%' then
    raise exception 'wrong code should return a generic failure, got %', r2;
  end if;

  r2 := public.redeem_recovery_code(recovery);
  if (r2->>'owner_id')::uuid is distinct from oid then
    raise exception 'recovery did not link the same owner';
  end if;
  select count(*) into item_count from public.items where id = 'lamp';
  if item_count <> 1 then raise exception 'recovered device cannot see the item'; end if;

  -- Revoke u3, then re-link with a fresh pairing code (same auth uid).
  perform public.revoke_this_device();
  if public.current_owner_id() is not null then
    raise exception 'revoked device should have no owner';
  end if;
  perform set_config('request.jwt.claim.sub', u1::text, true);
  pair := public.create_pairing_code();
  perform set_config('request.jwt.claim.sub', u3::text, true);
  r2 := public.redeem_pairing_code(pair->>'code');
  if (r2->>'owner_id')::uuid is distinct from oid then
    raise exception 're-link failed';
  end if;

  raise notice 'local schema-v2 checks passed';
end $$;
