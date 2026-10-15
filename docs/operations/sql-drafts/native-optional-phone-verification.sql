-- DRAFT VERIFICATION ONLY. Do not execute against production or read-only staging.
-- Use a disposable/local database containing the reviewed migration. Every fixture
-- and the rollback-policy check below are contained in this rolled-back transaction.
begin;

do $$
begin
  if has_function_privilege('anon', 'public.get_signup_requirements()', 'execute') then
    raise exception 'ANONYMOUS_REQUIREMENTS_ACCESS_WAS_GRANTED';
  end if;
  if has_function_privilege('authenticated', 'private.require_new_signup_ready()', 'execute') then
    raise exception 'PRIVATE_TRIGGER_ACCESS_WAS_GRANTED';
  end if;
  if has_table_privilege('authenticated', 'public.account_profiles', 'insert') then
    raise exception 'DIRECT_AUTHENTICATED_PROFILE_INSERT_WAS_GRANTED';
  end if;
end $$;

insert into auth.users (id, email, email_confirmed_at, created_at, updated_at)
values
  ('e0020000-0000-4000-8000-000000000001', 'optional-phone-new@example.invalid', now(), now() + interval '1 second', now()),
  ('e0020000-0000-4000-8000-000000000002', 'optional-phone-unverified@example.invalid', null, now() + interval '1 second', now()),
  ('e0020000-0000-4000-8000-000000000003', 'optional-phone-rollback@example.invalid', now(), now() + interval '1 second', now()),
  ('e0020000-0000-4000-8000-000000000005', null, now(), now() + interval '1 second', now());

insert into auth.users (id, email, email_confirmed_at, created_at, updated_at)
select 'e0020000-0000-4000-8000-000000000004', 'optional-phone-old@example.invalid',
       now(), activated_at - interval '1 second', now()
  from private.signup_policy where singleton = true;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'e0020000-0000-4000-8000-000000000001', true);
do $$
begin
  if (public.get_signup_requirements()->>'phoneRequired')::boolean is distinct from false then
    raise exception 'OPTIONAL_PHONE_CAPABILITY_MISSING';
  end if;
  begin
    perform public.complete_social_onboarding('optionalphone_new', 'Optional Phone QA');
    raise exception 'MISSING_TERMS_WERE_ACCEPTED';
  exception when sqlstate '42501' then
    if sqlerrm <> 'SIGNUP_TERMS_REQUIRED' then raise; end if;
  end;
end $$;
select public.accept_signup_terms();
select public.complete_social_onboarding('optionalphone_new', 'Optional Phone QA');
update public.account_profiles set full_name = 'Optional Phone QA Updated'
 where id = 'e0020000-0000-4000-8000-000000000001';
do $$
begin
  if not exists (
    select 1 from public.account_profiles
     where id = 'e0020000-0000-4000-8000-000000000001'
       and full_name = 'Optional Phone QA Updated'
  ) then
    raise exception 'EXISTING_PROFILE_UPDATE_WAS_BLOCKED';
  end if;
end $$;

select set_config('request.jwt.claim.sub', 'e0020000-0000-4000-8000-000000000002', true);
select public.accept_signup_terms();
do $$
begin
  begin
    perform public.complete_social_onboarding('optionalphone_unverified', 'Unverified QA');
    raise exception 'UNVERIFIED_EMAIL_WAS_ACCEPTED';
  exception when sqlstate '42501' then
    if sqlerrm <> 'VERIFIED_EMAIL_REQUIRED' then raise; end if;
  end;
end $$;

-- Required new profiles also need a nonblank verified email on trusted INSERT.
-- Existing waitlist inserts use this role after successful email verification.
select set_config('request.jwt.claim.sub', 'e0020000-0000-4000-8000-000000000005', true);
select public.accept_signup_terms();
do $$
begin
  begin
    perform public.complete_social_onboarding('optionalphone_empty', 'Missing Email RPC QA');
    raise exception 'MISSING_EMAIL_RPC_WAS_ACCEPTED';
  exception when sqlstate '42501' then
    if sqlerrm <> 'VERIFIED_EMAIL_REQUIRED' then raise; end if;
  end;
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', true);
set local role service_role;
do $$
begin
  begin
    insert into public.account_profiles (id, username, full_name)
    values ('e0020000-0000-4000-8000-000000000002', 'optionalphone_direct', 'Unverified Direct QA');
    raise exception 'TRUSTED_UNVERIFIED_EMAIL_WAS_ACCEPTED';
  exception when sqlstate '42501' then
    if sqlerrm <> 'VERIFIED_EMAIL_REQUIRED' then raise; end if;
  end;
  begin
    insert into public.account_profiles (id, username, full_name)
    values ('e0020000-0000-4000-8000-000000000005', 'optionalphone_noemail', 'Missing Email QA');
    raise exception 'TRUSTED_MISSING_EMAIL_WAS_ACCEPTED';
  exception when sqlstate '42501' then
    if sqlerrm <> 'VERIFIED_EMAIL_REQUIRED' then raise; end if;
  end;
end $$;

-- Demonstrate the behavior rollback without deleting users or reverting profiles.
reset role;
update private.signup_policy set phone_required = true where singleton = true;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e0020000-0000-4000-8000-000000000003', true);
select public.accept_signup_terms();
do $$
begin
  if (public.get_signup_requirements()->>'phoneRequired')::boolean is distinct from true then
    raise exception 'ROLLBACK_CAPABILITY_MISSING';
  end if;
  begin
    perform public.complete_social_onboarding('optionalphone_rollback', 'Rollback QA');
    raise exception 'ROLLBACK_UNVERIFIED_PHONE_WAS_ACCEPTED';
  exception when sqlstate '42501' then
    if sqlerrm <> 'VERIFIED_PHONE_REQUIRED' then raise; end if;
  end;
end $$;
reset role;
update auth.users set phone = '12025550123', phone_confirmed_at = now()
 where id = 'e0020000-0000-4000-8000-000000000003';
set local role authenticated;
select public.complete_social_onboarding('optionalphone_rollback', 'Rollback QA');

select set_config('request.jwt.claim.sub', 'e0020000-0000-4000-8000-000000000004', true);
do $$
begin
  if (public.get_signup_requirements()->>'required')::boolean is distinct from false then
    raise exception 'EXISTING_ACCOUNT_EXEMPTION_WAS_CHANGED';
  end if;
end $$;
select public.complete_social_onboarding('optionalphone_old', 'Existing Account QA');

rollback;
