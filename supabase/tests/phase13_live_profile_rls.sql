-- Phase 13 live profile permission and RLS contract.
-- Run against isolated staging only. All fixtures and writes are rolled back.

do $$
declare
  allowed_columns text[] := array['bio', 'is_discoverable', 'location', 'website_url'];
  actual_columns text[];
begin
  if has_table_privilege('authenticated', 'public.social_profiles', 'UPDATE') then
    raise exception 'AUTHENTICATED_TABLE_LEVEL_UPDATE_PRESENT';
  end if;

  select array_agg(column_name order by column_name)
  into actual_columns
  from information_schema.column_privileges
  where table_schema = 'public'
    and table_name = 'social_profiles'
    and grantee = 'authenticated'
    and privilege_type = 'UPDATE';

  if actual_columns is distinct from allowed_columns then
    raise exception 'UNEXPECTED_UPDATE_COLUMNS:%', actual_columns;
  end if;
end $$;

begin;

insert into auth.users (id, email, email_confirmed_at, created_at, updated_at)
values
  ('13000000-0000-0000-0000-000000000001', 'phase13-a@example.invalid', now(), now(), now()),
  ('13000000-0000-0000-0000-000000000002', 'phase13-b@example.invalid', now(), now(), now());

insert into public.account_profiles (id, username, full_name)
values
  ('13000000-0000-0000-0000-000000000001', 'phase13_a', 'Phase 13 A'),
  ('13000000-0000-0000-0000-000000000002', 'phase13_b', 'Phase 13 B');

set local role authenticated;
select set_config('request.jwt.claim.sub', '13000000-0000-0000-0000-000000000001', true);

do $$
declare
  changed integer;
  denied boolean := false;
begin
  update public.social_profiles
  set bio = 'Owner-approved bio',
      location = 'Dar es Salaam',
      website_url = 'https://sautilink.com',
      is_discoverable = false
  where id = '13000000-0000-0000-0000-000000000001';
  get diagnostics changed = row_count;
  if changed <> 1 then
    raise exception 'OWNER_ALLOWED_UPDATE_EXPECTED_1_GOT_%', changed;
  end if;

  update public.social_profiles
  set bio = 'Cross-user overwrite'
  where id = '13000000-0000-0000-0000-000000000002';
  get diagnostics changed = row_count;
  if changed <> 0 then
    raise exception 'CROSS_USER_PROFILE_UPDATE_ALLOWED';
  end if;

  begin
    update public.social_profiles
    set display_name = 'Forbidden rename'
    where id = '13000000-0000-0000-0000-000000000001';
  exception when insufficient_privilege then
    denied := true;
  end;
  if not denied then
    raise exception 'DISPLAY_NAME_UPDATE_ALLOWED';
  end if;
end $$;

reset role;
rollback;
