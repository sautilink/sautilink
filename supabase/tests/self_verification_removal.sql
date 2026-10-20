-- Synthetic verification-removal security regression. All users and data roll back.
-- No real account, notification delivery, or staff membership is used.
begin;

create function pg_temp.expect_removal_error(statement text, expected_message text)
returns void language plpgsql security invoker as $$
declare denied boolean := false;
begin
  begin
    execute statement;
  exception when others then
    if position(expected_message in sqlerrm) > 0 then denied := true; else raise; end if;
  end;
  if not denied then raise exception 'EXPECTED_REMOVAL_ERROR: %', expected_message; end if;
end;
$$;

select set_config('request.jwt.claim.sub', '', true);

insert into auth.users (id, email, email_confirmed_at, last_sign_in_at, created_at, updated_at)
select ('64000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
       'verification-removal-' || n || '@example.invalid', now(), now(),
       '2026-08-01 00:00:00+00', now()
from generate_series(1, 8) n;

insert into public.account_profiles (id, username, full_name)
select ('64000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
       'removal_fixture_' || n, 'Removal Fixture ' || n
from generate_series(1, 8) n;

insert into private.moderation_staff (user_id, staff_role, active)
values
  ('64000000-0000-4000-8000-000000000007', 'senior_reviewer', true),
  ('64000000-0000-4000-8000-000000000008', 'reviewer', true);

update public.social_profiles
set is_verified = true,
    verification_badge_type = case when id = '64000000-0000-4000-8000-000000000002' then 'team' else 'standard' end
where id in (
  '64000000-0000-4000-8000-000000000001',
  '64000000-0000-4000-8000-000000000002',
  '64000000-0000-4000-8000-000000000004',
  '64000000-0000-4000-8000-000000000005',
  '64000000-0000-4000-8000-000000000006'
);

-- This is an operator/staff-style revocation, not voluntary owner removal.
update public.social_profiles set is_verified = false
where id = '64000000-0000-4000-8000-000000000004';

insert into public.case_records (id, category, status, submitter_id, subject_user_id, title, metadata, created_at, resolved_at)
values
  ('64000000-0000-4000-8000-000000000101', 'verification', 'approved',
   '64000000-0000-4000-8000-000000000001', '64000000-0000-4000-8000-000000000001',
   'Historical approved fixture', '{"staff_message":"Historical approval remains recorded"}', now() - interval '40 days', now() - interval '39 days'),
  ('64000000-0000-4000-8000-000000000105', 'verification', 'rejected',
   '64000000-0000-4000-8000-000000000005', '64000000-0000-4000-8000-000000000005',
   'Rejected fixture', '{}', now() - interval '2 days', now() - interval '1 day'),
  ('64000000-0000-4000-8000-000000000106', 'verification', 'action_required',
   '64000000-0000-4000-8000-000000000006', '64000000-0000-4000-8000-000000000006',
   'Active fixture', '{}', now() - interval '1 day', null);

do $$
begin
  if has_function_privilege('anon', 'public.remove_my_social_verification(uuid,text)', 'execute')
     or has_function_privilege('anon', 'private.remove_my_social_verification_privileged(uuid,text)', 'execute') then
    raise exception 'ANONYMOUS_REMOVAL_EXECUTE_GRANTED';
  end if;
  if has_table_privilege('authenticated', 'private.social_verification_removal_receipts', 'select,insert,update,delete') then
    raise exception 'REMOVAL_RECEIPTS_EXPOSED';
  end if;
  if not has_function_privilege('authenticated', 'public.remove_my_social_verification(uuid,text)', 'execute') then
    raise exception 'MEMBER_REMOVAL_EXECUTE_MISSING';
  end if;
end;
$$;

set local role anon;
select pg_temp.expect_removal_error(
  $$select public.remove_my_social_verification('64000000-0000-4000-8000-000000000201', 'remove-verification-v1')$$,
  'permission denied'
);
reset role;
set local role authenticated;

select pg_temp.expect_removal_error(
  $$select public.remove_my_social_verification('64000000-0000-4000-8000-000000000201', 'remove-verification-v1')$$,
  'AUTH_REQUIRED'
);
select set_config('request.jwt.claim.sub', '64000000-0000-4000-8000-000000000003', true);
select pg_temp.expect_removal_error(
  $$select public.remove_my_social_verification('64000000-0000-4000-8000-000000000203', 'remove-verification-v1')$$,
  'VERIFICATION_NOT_ACTIVE'
);

select set_config('request.jwt.claim.sub', '64000000-0000-4000-8000-000000000001', true);
-- A missing staff row returns NULL, which must deny the existing privileged APIs.
do $$
begin
  if private.phase29_staff_role() is not null then raise exception 'NONSTAFF_FIXTURE_HAS_ROLE'; end if;
end;
$$;
select pg_temp.expect_removal_error(
  $$select public.set_social_verification('removal_fixture_1', true, 'self grant')$$,
  'VERIFICATION_ADMIN_REQUIRED'
);
select pg_temp.expect_removal_error(
  $$select public.set_social_verification('removal_fixture_1', false, 'self revoke')$$,
  'VERIFICATION_ADMIN_REQUIRED'
);
select pg_temp.expect_removal_error(
  $$select public.set_social_verification_badge('removal_fixture_2', true, 'team', 'other grant')$$,
  'VERIFICATION_ADMIN_REQUIRED'
);
select pg_temp.expect_removal_error(
  $$select public.set_social_verification_badge('removal_fixture_2', false, 'standard', 'other revoke')$$,
  'VERIFICATION_ADMIN_REQUIRED'
);
select pg_temp.expect_removal_error(
  $$select public.remove_my_social_verification(null, 'remove-verification-v1')$$,
  'REQUEST_ID_REQUIRED'
);
select pg_temp.expect_removal_error(
  $$select public.remove_my_social_verification('64000000-0000-4000-8000-000000000201', 'yes')$$,
  'VERIFICATION_REMOVAL_CONFIRMATION_REQUIRED'
);
select pg_temp.expect_removal_error(
  $$select public.remove_my_social_verification(p_request_id := '64000000-0000-4000-8000-000000000201', p_confirmation := 'remove-verification-v1', p_user_id := '64000000-0000-4000-8000-000000000002')$$,
  'does not exist'
);
select pg_temp.expect_removal_error(
  $$update public.social_profiles set is_verified = false, username_locked_at = null where id = '64000000-0000-4000-8000-000000000001'$$,
  'permission denied'
);
select pg_temp.expect_removal_error(
  $$insert into private.social_verification_removal_receipts (request_id) values ('64000000-0000-4000-8000-000000000201')$$,
  'permission denied'
);

do $$
declare result jsonb;
begin
  result := public.remove_my_social_verification('64000000-0000-4000-8000-000000000201', 'remove-verification-v1');
  if result ->> 'status' <> 'removed' or result ->> 'user_id' <> auth.uid()::text
     or result #>> '{profile,is_verified}' <> 'false'
     or result #>> '{profile,verification_badge_type}' <> 'standard'
     or result ->> 'username_unlocked' <> 'true' then
    raise exception 'STANDARD_REMOVAL_RESULT_INVALID';
  end if;
  result := public.remove_my_social_verification('64000000-0000-4000-8000-000000000201', 'remove-verification-v1');
  if result ->> 'status' <> 'already_removed' then raise exception 'IDEMPOTENT_REMOVAL_FAILED'; end if;
  result := public.get_my_verification_case();
  if result ->> 'status' <> 'approved' or result ->> 'can_reapply' <> 'true'
     or result ->> 'verification_removed' <> 'true' then
    raise exception 'APPROVAL_HISTORY_OR_REAPPLICATION_LOST';
  end if;
end;
$$;

reset role;
do $$
declare event_count integer;
begin
  select count(*) into event_count from private.social_verification_events
  where user_id = '64000000-0000-4000-8000-000000000001' and source = 'member_removal';
  if event_count <> 1 then raise exception 'DUPLICATE_OR_MISSING_REMOVAL_AUDIT'; end if;
  if not exists (select 1 from private.social_verification_removal_receipts
    where request_id = '64000000-0000-4000-8000-000000000201' and completed_at is not null) then
    raise exception 'REMOVAL_RECEIPT_NOT_COMPLETED';
  end if;
  if not exists (select 1 from public.social_profiles
    where id = '64000000-0000-4000-8000-000000000001' and not is_verified and username_locked_at is null)
    or not exists (select 1 from public.social_profiles
    where id = '64000000-0000-4000-8000-000000000002' and is_verified and verification_badge_type = 'team') then
    raise exception 'REMOVAL_TARGET_ISOLATION_FAILED';
  end if;
end;
$$;

-- Reopening or approving an old case must be rejected. A staff-style transaction
-- changes the profile before status; catch the error around both to verify rollback.
do $$
declare state text; denied boolean := false;
begin
  foreach state in array array['submitted', 'reviewing', 'action_required', 'approved'] loop
    perform pg_temp.expect_removal_error(
      format('update public.case_records set status = %L where id = %L', state, '64000000-0000-4000-8000-000000000101'),
      'VERIFICATION_CASE_REAPPLICATION_REQUIRED'
    );
  end loop;
  begin
    update public.social_profiles set is_verified = true where id = '64000000-0000-4000-8000-000000000001';
    update public.case_records set status = 'approved' where id = '64000000-0000-4000-8000-000000000101';
  exception when sqlstate '22023' then
    if sqlerrm <> 'VERIFICATION_CASE_REAPPLICATION_REQUIRED' then raise; end if;
    denied := true;
  end;
  if not denied or exists (select 1 from public.social_profiles
    where id = '64000000-0000-4000-8000-000000000001' and is_verified) then
    raise exception 'STALE_APPROVAL_DID_NOT_ROLL_BACK_PROFILE';
  end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '64000000-0000-4000-8000-000000000001', true);
select public.change_social_identity('username', 'removal_fixture_new', '64000000-0000-4000-8000-000000000301');
select pg_temp.expect_removal_error(
  $$select public.change_social_identity('username', 'removal_fixture_second', '64000000-0000-4000-8000-000000000302')$$,
  'USERNAME_CHANGE_LIMIT'
);
select pg_temp.expect_removal_error(
  $$select public.change_social_identity('username', 'admin', '64000000-0000-4000-8000-000000000303')$$,
  'USERNAME_RESERVED'
);
reset role;
do $$
begin
  if not exists (select 1 from public.account_profiles account join public.social_profiles profile using (id)
    where account.id = '64000000-0000-4000-8000-000000000001'
      and account.username = 'removal_fixture_new' and profile.username = account.username) then
    raise exception 'UNLOCKED_USERNAME_SYNC_FAILED';
  end if;
end;
$$;

-- A completed receipt from the same transaction cannot unlock a later verification.
update public.social_profiles set is_verified = true where id = '64000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.expect_removal_error(
  $$select public.remove_my_social_verification('64000000-0000-4000-8000-000000000201', 'remove-verification-v1')$$,
  'VERIFICATION_REMOVAL_REPLAY_REJECTED'
);
reset role;
do $$
begin
  if not exists (select 1 from public.social_profiles where id = '64000000-0000-4000-8000-000000000001'
    and is_verified and username_locked_at is not null) then
    raise exception 'STALE_RETRY_REMOVED_NEW_VERIFICATION';
  end if;
end;
$$;
update public.social_profiles set is_verified = false, username_locked_at = null
where id = '64000000-0000-4000-8000-000000000001';
do $$
begin
  if not exists (select 1 from public.social_profiles where id = '64000000-0000-4000-8000-000000000001'
    and not is_verified and username_locked_at is not null) then
    raise exception 'COMPLETED_RECEIPT_REUSED_TO_CLEAR_STAFF_LOCK';
  end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '64000000-0000-4000-8000-000000000004', true);
select pg_temp.expect_removal_error(
  $$select public.change_social_identity('username', 'removal_revoked_new', '64000000-0000-4000-8000-000000000304')$$,
  'USERNAME_LOCKED_VERIFIED'
);
select pg_temp.expect_removal_error(
  $$select public.remove_my_social_verification('64000000-0000-4000-8000-000000000204', 'remove-verification-v1')$$,
  'VERIFICATION_NOT_ACTIVE'
);

select set_config('request.jwt.claim.sub', '64000000-0000-4000-8000-000000000002', true);
select pg_temp.expect_removal_error(
  $$select public.remove_my_social_verification('64000000-0000-4000-8000-000000000201', 'remove-verification-v1')$$,
  'REQUEST_ID_REUSED'
);
select public.remove_my_social_verification('64000000-0000-4000-8000-000000000202', 'remove-verification-v1');
reset role;
do $$
begin
  if not exists (select 1 from private.social_verification_events
    where user_id = '64000000-0000-4000-8000-000000000002' and source = 'member_removal'
      and previous_badge_type = 'team' and new_badge_type = 'standard') then
    raise exception 'TEAM_REMOVAL_AUDIT_INVALID';
  end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '64000000-0000-4000-8000-000000000005', true);
select public.remove_my_social_verification('64000000-0000-4000-8000-000000000205', 'remove-verification-v1');
select pg_temp.expect_removal_error(
  $$select public.submit_verification_case('Fixture Person', 'Fixture Person', 'Creator', 'Tanzania', '{"youtube":"https://youtube.com/@fixture"}'::jsonb, '[]'::jsonb, 'A complete verification explanation for the fixture.', true, false)$$,
  'VERIFICATION_REAPPLY_COOLDOWN'
);
do $$
declare item jsonb;
begin
  item := public.get_my_verification_case();
  if item ->> 'can_reapply' <> 'false' or (item ->> 'cooldown_days_remaining')::integer < 1 then
    raise exception 'REMOVAL_BYPASSED_REJECTION_COOLDOWN';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub', '64000000-0000-4000-8000-000000000006', true);
select public.remove_my_social_verification('64000000-0000-4000-8000-000000000206', 'remove-verification-v1');
select pg_temp.expect_removal_error(
  $$select public.submit_verification_case('Fixture Person', 'Fixture Person', 'Creator', 'Tanzania', '{}'::jsonb, '[]'::jsonb, 'A complete verification explanation for the fixture.', true, false)$$,
  'VERIFICATION_EVIDENCE_REQUIRED'
);
do $$
declare result jsonb;
begin
  result := public.submit_verification_case('Fixture Person', 'Fixture Person', 'Creator', 'Tanzania',
    '{"youtube":"https://youtube.com/@fixture"}'::jsonb, '[]'::jsonb,
    'A complete verification explanation for the fixture.', true, false);
  if result ->> 'status' <> 'submitted' or result ->> 'case_id' = '64000000-0000-4000-8000-000000000106' then
    raise exception 'FULL_FRESH_REAPPLICATION_NOT_CREATED';
  end if;
end;
$$;
reset role;
do $$
declare new_case uuid;
begin
  if not exists (select 1 from public.case_records
    where id = '64000000-0000-4000-8000-000000000106' and status = 'cancelled') then
    raise exception 'REMOVAL_DID_NOT_RETIRE_ACTIVE_CASE';
  end if;
  select id into new_case from public.case_records
  where subject_user_id = '64000000-0000-4000-8000-000000000006' and status = 'submitted';
  -- A new case remains eligible for the normal staff review path.
  update public.social_profiles set is_verified = true where id = '64000000-0000-4000-8000-000000000006';
  update public.case_records set status = 'approved' where id = new_case;
  if not exists (select 1 from public.social_profiles where id = '64000000-0000-4000-8000-000000000006'
    and is_verified and username_locked_at is not null) then
    raise exception 'FRESH_REVERIFICATION_DID_NOT_RELOCK';
  end if;
  if exists (select 1 from public.social_notifications
    where recipient_id::text like '64000000-0000-4000-8000-%') then
    raise exception 'SYNTHETIC_REMOVAL_SENT_NOTIFICATION';
  end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '64000000-0000-4000-8000-000000000008', true);
select pg_temp.expect_removal_error(
  $$select public.set_social_verification('removal_fixture_3', true, 'reviewer cannot grant')$$,
  'VERIFICATION_ADMIN_REQUIRED'
);
select set_config('request.jwt.claim.sub', '64000000-0000-4000-8000-000000000007', true);
select public.set_social_verification_badge('removal_fixture_3', true, 'team', 'Synthetic senior team verification');
select public.set_social_verification('removal_fixture_3', false, 'Synthetic senior revocation');
reset role;
do $$
begin
  if not exists (select 1 from public.social_profiles
    where id = '64000000-0000-4000-8000-000000000003'
      and not is_verified and verification_badge_type = 'standard' and username_locked_at is not null) then
    raise exception 'SENIOR_REVIEWER_VERIFICATION_BEHAVIOR_CHANGED';
  end if;
  if (select count(*) from private.social_verification_events
      where user_id = '64000000-0000-4000-8000-000000000003' and source = 'staff') <> 2 then
    raise exception 'SENIOR_REVIEWER_AUDIT_CHANGED';
  end if;
end;
$$;

select 'SELF_VERIFICATION_REMOVAL_SECURITY_PASS' as result;
rollback;
