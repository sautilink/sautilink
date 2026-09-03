-- Phase 15 profile-media metadata RLS contract.
-- Isolated staging only. All fixtures and writes are rolled back.

begin;

insert into auth.users (id, email, email_confirmed_at, created_at, updated_at)
values
  ('15000000-0000-0000-0000-000000000001', 'phase15-owner@example.invalid', now(), now(), now()),
  ('15000000-0000-0000-0000-000000000002', 'phase15-other@example.invalid', now(), now(), now());

insert into public.account_profiles (id, username, full_name)
values
  ('15000000-0000-0000-0000-000000000001', 'phase15_owner', 'Phase 15 Owner'),
  ('15000000-0000-0000-0000-000000000002', 'phase15_other', 'Phase 15 Other');

set local role authenticated;
select set_config('request.jwt.claim.sub', '15000000-0000-0000-0000-000000000001', true);

update public.social_profiles
set avatar_key = 'profiles/15000000-0000-0000-0000-000000000001/avatar/11111111-2222-4333-8444-555555555555.webp'
where id = '15000000-0000-0000-0000-000000000001';

do $$
declare
  changed integer;
  blocked boolean := false;
begin
  update public.social_profiles
  set header_key = 'profiles/15000000-0000-0000-0000-000000000002/header/11111111-2222-4333-8444-555555555555.jpg'
  where id = '15000000-0000-0000-0000-000000000002';
  get diagnostics changed = row_count;
  if changed <> 0 then
    raise exception 'CROSS_USER_PROFILE_MEDIA_UPDATE_ALLOWED';
  end if;

  begin
    update public.social_profiles
    set avatar_key = 'profiles/15000000-0000-0000-0000-000000000001/header/11111111-2222-4333-8444-555555555555.jpg'
    where id = '15000000-0000-0000-0000-000000000001';
  exception when check_violation then
    blocked := true;
  end;

  if not blocked then
    raise exception 'INVALID_AVATAR_SLOT_KEY_ALLOWED';
  end if;
end $$;

reset role;
rollback;
