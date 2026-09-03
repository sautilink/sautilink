-- Phase 14 discoverable profile route RLS contract.
-- Run against isolated staging only. All fixtures and writes are rolled back.

begin;

insert into auth.users (id, email, email_confirmed_at, created_at, updated_at)
values
  ('14000000-0000-0000-0000-000000000001', 'phase14-public@example.invalid', now(), now(), now()),
  ('14000000-0000-0000-0000-000000000002', 'phase14-hidden@example.invalid', now(), now(), now());

insert into public.account_profiles (id, username, full_name)
values
  ('14000000-0000-0000-0000-000000000001', 'phase14_public', 'Phase 14 Public'),
  ('14000000-0000-0000-0000-000000000002', 'phase14_hidden', 'Phase 14 Hidden');

update public.social_profiles
set is_discoverable = true
where id = '14000000-0000-0000-0000-000000000001';

set local role anon;

do $$
declare
  visible_count integer;
  hidden_count integer;
begin
  select count(*) into visible_count
  from public.social_profiles
  where username = 'phase14_public';

  if visible_count <> 1 then
    raise exception 'DISCOVERABLE_PROFILE_NOT_VISIBLE_TO_ANON';
  end if;

  select count(*) into hidden_count
  from public.social_profiles
  where username = 'phase14_hidden';

  if hidden_count <> 0 then
    raise exception 'HIDDEN_PROFILE_VISIBLE_TO_ANON';
  end if;
end $$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '14000000-0000-0000-0000-000000000002', true);

do $$
declare
  owner_count integer;
begin
  select count(*) into owner_count
  from public.social_profiles
  where username = 'phase14_hidden';

  if owner_count <> 1 then
    raise exception 'OWNER_HIDDEN_PROFILE_NOT_VISIBLE';
  end if;
end $$;

reset role;
rollback;
