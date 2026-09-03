-- Phase 16 Text Sauti RLS contract.
-- Staging fixtures only. Everything rolls back.

begin;

insert into auth.users (id, email, email_confirmed_at, created_at, updated_at)
values
  ('16000000-0000-0000-0000-000000000001', 'phase16-owner@example.invalid', now(), now(), now()),
  ('16000000-0000-0000-0000-000000000002', 'phase16-other@example.invalid', now(), now(), now());

insert into public.account_profiles (id, username, full_name)
values
  ('16000000-0000-0000-0000-000000000001', 'phase16_owner', 'Phase 16 Owner'),
  ('16000000-0000-0000-0000-000000000002', 'phase16_other', 'Phase 16 Other');

update public.social_profiles
set is_discoverable = true
where id = '16000000-0000-0000-0000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', '16000000-0000-0000-0000-000000000001', true);

insert into public.social_posts (author_id, body)
values ('16000000-0000-0000-0000-000000000001', 'Phase 16 canonical text Sauti');

do $$
declare
  blocked boolean := false;
begin
  begin
    insert into public.social_posts (author_id, body, visibility)
    values ('16000000-0000-0000-0000-000000000001', 'Not live yet', 'followers');
  exception when insufficient_privilege then
    blocked := true;
  end;

  if not blocked then
    raise exception 'NON_PUBLIC_PHASE16_INSERT_ALLOWED';
  end if;
end $$;

do $$
declare
  changed integer;
begin
  delete from public.social_posts
  where author_id = '16000000-0000-0000-0000-000000000002';
  get diagnostics changed = row_count;
  if changed <> 0 then
    raise exception 'CROSS_USER_DELETE_ALLOWED';
  end if;
end $$;

reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);

do $$
declare
  visible integer;
begin
  select count(*) into visible
  from public.social_posts
  where author_id = '16000000-0000-0000-0000-000000000001';

  if visible <> 1 then
    raise exception 'DISCOVERABLE_PUBLIC_SAUTI_NOT_VISIBLE';
  end if;
end $$;

reset role;

update public.social_profiles
set is_discoverable = false
where id = '16000000-0000-0000-0000-000000000001';

set local role anon;
select set_config('request.jwt.claim.sub', '', true);

do $$
declare
  visible integer;
begin
  select count(*) into visible
  from public.social_posts
  where author_id = '16000000-0000-0000-0000-000000000001';

  if visible <> 0 then
    raise exception 'HIDDEN_AUTHOR_SAUTI_LEAKED';
  end if;
end $$;

reset role;
rollback;
