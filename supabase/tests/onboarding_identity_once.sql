-- Synthetic identity regression. No delivery/network triggers or real users.
begin;
create function pg_temp.expect_onboarding_error(statement text, message text)
returns void language plpgsql security invoker as $$
declare denied boolean := false;
begin
  begin execute statement;
  exception when others then
    if position(message in sqlerrm) > 0 then denied := true; else raise; end if;
  end;
  if not denied then raise exception 'EXPECTED_ONBOARDING_ERROR: %', message; end if;
end;
$$;

insert into auth.users (id,email,email_confirmed_at,created_at)
select ('72000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  'onboarding-'||n||'@example.invalid', case when n=4 then null else now() end,
  '2026-08-01'::timestamptz from generate_series(1,5) n;
insert into public.account_profiles (id,username,full_name)
values ('72000000-0000-4000-8000-000000000001','identity_once','Original Name'),
       ('72000000-0000-4000-8000-000000000002','identity_verified','Verified Original'),
       ('72000000-0000-4000-8000-000000000003','identity_partial','Authoritative Name');
delete from public.social_profiles where id='72000000-0000-4000-8000-000000000003';
update public.social_profiles set is_verified=true
where id='72000000-0000-4000-8000-000000000002';

set local role authenticated;
select set_config('request.jwt.claim.sub','72000000-0000-4000-8000-000000000001',true);
select public.change_social_identity('display_name','Changed One',gen_random_uuid());
select public.change_social_identity('display_name','Changed Two',gen_random_uuid());
select pg_temp.expect_onboarding_error(
  $$select public.change_social_identity('display_name','Over Quota',gen_random_uuid())$$,
  'DISPLAY_NAME_CHANGE_LIMIT');
do $$
declare item public.social_profiles;
begin
  for n in 1..5 loop
    item := public.complete_social_onboarding('identity_once','Bypass Name '||n);
    if item.display_name <> 'Changed Two' then raise exception 'ONBOARDING_REWROTE_EXISTING_NAME'; end if;
    if item.id <> auth.uid() then raise exception 'ONBOARDING_RETURNED_OTHER_IDENTITY'; end if;
  end loop;
end;
$$;
select pg_temp.expect_onboarding_error(
  $$select public.complete_social_onboarding('different_handle','Changed Name')$$,
  'ACCOUNT_USERNAME_MISMATCH');
reset role;
update public.social_profiles set is_discoverable=false where id='72000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$
declare item public.social_profiles;
begin
  item := public.complete_social_onboarding('@IDENTITY_ONCE','A Different Name');
  if item.is_discoverable or item.display_name <> 'Changed Two' then
    raise exception 'ONBOARDING_REWROTE_EXISTING_PRIVACY_OR_IDENTITY';
  end if;
end;
$$;
select set_config('request.jwt.claim.sub','72000000-0000-4000-8000-000000000002',true);
select public.change_social_identity('display_name','Verified One',gen_random_uuid());
select public.change_social_identity('display_name','Verified Two',gen_random_uuid());
select pg_temp.expect_onboarding_error(
  $$select public.change_social_identity('display_name','Over Monthly Quota',gen_random_uuid())$$,
  'VERIFIED_DISPLAY_NAME_MONTHLY_LIMIT');
do $$
declare item public.social_profiles;
begin
  item := public.complete_social_onboarding('identity_verified','Bypass Verified Name');
  if item.display_name <> 'Verified Two' or not item.is_verified or item.username_locked_at is null then
    raise exception 'ONBOARDING_REWROTE_VERIFIED_IDENTITY';
  end if;
end;
$$;
select pg_temp.expect_onboarding_error(
  $$select public.change_social_identity('username','new_verified_username',gen_random_uuid())$$,
  'USERNAME_LOCKED_VERIFIED');

select set_config('request.jwt.claim.sub','72000000-0000-4000-8000-000000000003',true);
do $$
declare item public.social_profiles;
begin
  item := public.complete_social_onboarding('identity_partial','Untrusted Replacement');
  if item.display_name <> 'Authoritative Name' or not item.is_discoverable then
    raise exception 'ONBOARDING_PARTIAL_BOOTSTRAP_IDENTITY_CHANGED';
  end if;
end;
$$;
select set_config('request.jwt.claim.sub','72000000-0000-4000-8000-000000000004',true);
select pg_temp.expect_onboarding_error(
  $$select public.complete_social_onboarding('identity_unconfirmed','No Email')$$,
  'VERIFIED_EMAIL_REQUIRED');
select set_config('request.jwt.claim.sub','72000000-0000-4000-8000-000000000005',true);
select pg_temp.expect_onboarding_error(
  $$select public.complete_social_onboarding('support','Reserved')$$,'RESERVED_USERNAME');
select pg_temp.expect_onboarding_error(
  $$select public.complete_social_onboarding('!!','Invalid')$$,'INVALID_USERNAME');
select pg_temp.expect_onboarding_error(
  $$select public.complete_social_onboarding('identity_fresh','')$$,'INVALID_DISPLAY_NAME');
do $$
declare item public.social_profiles;
begin
  item := public.complete_social_onboarding('identity_fresh','Fresh Member');
  if item.display_name <> 'Fresh Member' or item.username <> 'identity_fresh'
     or not item.is_discoverable or item.is_verified then raise exception 'NEW_SIGNUP_REGRESSION'; end if;
  item := public.complete_social_onboarding('identity_fresh','Retry Different Name');
  if item.display_name <> 'Fresh Member' then raise exception 'SIGNUP_RETRY_CHANGED_IDENTITY'; end if;
end;
$$;
select set_config('request.jwt.claim.sub','',true);
select pg_temp.expect_onboarding_error(
  $$select public.complete_social_onboarding('identity_missing','Anonymous')$$,'AUTHENTICATION_REQUIRED');
reset role;
do $$
begin
  if has_function_privilege('anon','public.complete_social_onboarding(text,text)','execute') then
    raise exception 'ANONYMOUS_ONBOARDING_EXECUTE'; end if;
  if (select count(*) from public.social_identity_change_events) <> 4 then
    raise exception 'IDENTITY_AUDIT_CHANGED'; end if;
  if (select full_name from public.account_profiles where username='identity_once') <> 'Changed Two' then
    raise exception 'ACCOUNT_IDENTITY_CHANGED'; end if;
end;
$$;
select 'ONBOARDING_IDENTITY_ONCE_SECURITY_PASS' as result;
rollback;
