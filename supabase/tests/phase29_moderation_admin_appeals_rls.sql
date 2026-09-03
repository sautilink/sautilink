-- Phase 29 moderation/admin/appeals synthetic RLS regression.
-- Run only on staging. Everything rolls back.

begin;

insert into auth.users (id, email, email_confirmed_at, created_at, updated_at)
values
  ('29000000-0000-0000-0000-000000000001', 'phase29-reporter@example.invalid', now(), now(), now()),
  ('29000000-0000-0000-0000-000000000002', 'phase29-target@example.invalid', now(), now(), now()),
  ('29000000-0000-0000-0000-000000000003', 'phase29-viewer@example.invalid', now(), now(), now()),
  ('29000000-0000-0000-0000-000000000010', 'phase29-reviewer@example.invalid', now(), now(), now()),
  ('29000000-0000-0000-0000-000000000011', 'phase29-senior@example.invalid', now(), now(), now()),
  ('29000000-0000-0000-0000-000000000012', 'phase29-auditor@example.invalid', now(), now(), now());

insert into public.account_profiles (id, username, full_name)
values
  ('29000000-0000-0000-0000-000000000001', 'phase29_reporter', 'Phase 29 Reporter'),
  ('29000000-0000-0000-0000-000000000002', 'phase29_target', 'Phase 29 Target'),
  ('29000000-0000-0000-0000-000000000003', 'phase29_viewer', 'Phase 29 Viewer'),
  ('29000000-0000-0000-0000-000000000010', 'phase29_reviewer', 'Phase 29 Reviewer'),
  ('29000000-0000-0000-0000-000000000011', 'phase29_senior', 'Phase 29 Senior'),
  ('29000000-0000-0000-0000-000000000012', 'phase29_auditor', 'Phase 29 Auditor');

update public.social_profiles
set is_discoverable = true
where id::text like '29000000-%';

insert into private.moderation_staff (user_id, staff_role)
values
  ('29000000-0000-0000-0000-000000000010', 'reviewer'),
  ('29000000-0000-0000-0000-000000000011', 'senior_reviewer'),
  ('29000000-0000-0000-0000-000000000012', 'auditor');

insert into public.social_posts (
  id, author_id, body, visibility, post_status, audience_owner_id, thread_depth
)
values (
  '29000000-0000-4000-8000-000000000020',
  '29000000-0000-0000-0000-000000000002',
  'Phase 29 reported Sauti',
  'public',
  'published',
  '29000000-0000-0000-0000-000000000002',
  0
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '29000000-0000-0000-0000-000000000001', true);

insert into public.social_reports (reporter_id, target_type, target_id, reason, details)
values (
  '29000000-0000-0000-0000-000000000001',
  'post',
  '29000000-0000-4000-8000-000000000020',
  'harassment',
  'Synthetic Phase 29 report'
);

do $$
declare report_count integer;
begin
  select count(*) into report_count from public.social_reports;
  if report_count <> 0 then raise exception 'REPORTER_CAN_READ_REPORT_QUEUE'; end if;
exception when insufficient_privilege then
  null;
end $$;

do $$
declare blocked boolean := false;
begin
  begin
    insert into public.social_moderation_actions (
      report_id, action_type, reason, policy_version, request_id
    ) values (
      1, 'dismissed', 'Unauthorized', 'safety-v1',
      '29000000-0000-4000-8000-000000000101'
    );
  exception when insufficient_privilege then
    blocked := true;
  end;
  if not blocked then raise exception 'ORDINARY_MEMBER_INSERTED_MODERATION_ACTION'; end if;
end $$;

select set_config('request.jwt.claim.sub', '29000000-0000-0000-0000-000000000010', true);

do $$
declare role_rows integer;
begin
  select count(*) into role_rows
  from public.moderation_staff_self
  where user_id = '29000000-0000-0000-0000-000000000010'
    and staff_role = 'reviewer';
  if role_rows <> 1 then raise exception 'REVIEWER_CANNOT_READ_OWN_STAFF_ROLE'; end if;
end $$;

do $$
declare leaked boolean := false;
declare reporter uuid;
begin
  begin
    select reporter_id into reporter
    from public.social_reports
    limit 1;
    leaked := true;
  exception when insufficient_privilege then
    leaked := false;
  end;
  if leaked then raise exception 'REPORTER_IDENTITY_LEAKED_TO_MODERATOR'; end if;
end $$;

do $$
declare rows_visible integer;
begin
  select count(*) into rows_visible
  from public.social_reports
  where target_id = '29000000-0000-4000-8000-000000000020'
    and context_snapshot->>'body' = 'Phase 29 reported Sauti';
  if rows_visible <> 1 then raise exception 'REVIEWER_CASE_CONTEXT_UNAVAILABLE'; end if;
end $$;

update public.social_reports
set report_status = 'reviewing',
    assigned_to = '29000000-0000-0000-0000-000000000010',
    reviewed_at = now(),
    status_updated_at = now()
where target_id = '29000000-0000-4000-8000-000000000020';

do $$
declare denied boolean := false;
begin
  begin
    insert into public.social_moderation_actions (
      report_id, action_type, reason, policy_version, request_id
    )
    select
      id, 'content_removed', 'Reviewer must not remove', 'safety-v1',
      '29000000-0000-4000-8000-000000000103'
    from public.social_reports
    where target_id = '29000000-0000-4000-8000-000000000020';
  exception when insufficient_privilege then
    denied := true;
  when others then
    if sqlstate = '42501' then denied := true; else raise; end if;
  end;
  if not denied then raise exception 'REVIEWER_REMOVED_CONTENT'; end if;
end $$;

insert into public.social_moderation_actions (
  report_id, action_type, reason, policy_version, request_id
)
select
  id,
  'visibility_limited',
  'Synthetic proportionate visibility limit',
  'safety-v1',
  '29000000-0000-4000-8000-000000000102'
from public.social_reports
where target_id = '29000000-0000-4000-8000-000000000020';

do $$
declare state_value text;
declare status_value text;
begin
  select moderation_state into state_value
  from public.social_posts
  where id = '29000000-0000-4000-8000-000000000020';
  if state_value <> 'limited' then raise exception 'VISIBILITY_LIMIT_NOT_ENFORCED'; end if;

  select report_status into status_value
  from public.social_reports
  where target_id = '29000000-0000-4000-8000-000000000020';
  if status_value <> 'resolved' then raise exception 'REPORT_NOT_RESOLVED_BY_ACTION'; end if;
end $$;



do $$
declare audit_rows integer;
begin
  select count(*) into audit_rows
  from public.social_moderation_audit
  where actor_id = '29000000-0000-0000-0000-000000000010';
  if audit_rows < 1 then raise exception 'REVIEWER_AUDIT_EVENT_MISSING'; end if;
end $$;

select set_config('request.jwt.claim.sub', '29000000-0000-0000-0000-000000000003', true);

do $$
declare visible_rows integer;
begin
  select count(*) into visible_rows
  from public.social_posts
  where id = '29000000-0000-4000-8000-000000000020';
  if visible_rows <> 0 then raise exception 'LIMITED_CONTENT_VISIBLE_TO_OTHER_MEMBER'; end if;
end $$;

select set_config('request.jwt.claim.sub', '29000000-0000-0000-0000-000000000002', true);

do $$
declare visible_rows integer;
begin
  select count(*) into visible_rows
  from public.social_posts
  where id = '29000000-0000-4000-8000-000000000020'
    and moderation_state = 'limited';
  if visible_rows <> 1 then raise exception 'AUTHOR_CANNOT_READ_LIMITED_CONTENT'; end if;
end $$;

insert into public.social_moderation_appeals (action_id, appellant_id, reason)
select
  id,
  '29000000-0000-0000-0000-000000000002',
  'Synthetic appeal with additional context'
from public.social_moderation_actions
where request_id = '29000000-0000-4000-8000-000000000102';

do $$
declare appeal_rows integer;
begin
  select count(*) into appeal_rows
  from public.social_moderation_appeals
  where appellant_id = '29000000-0000-0000-0000-000000000002'
    and appeal_status = 'open';
  if appeal_rows <> 1 then raise exception 'MEMBER_APPEAL_NOT_CREATED'; end if;
end $$;

select set_config('request.jwt.claim.sub', '29000000-0000-0000-0000-000000000010', true);

update public.social_moderation_appeals
set appeal_status = 'reviewing',
    assigned_to = '29000000-0000-0000-0000-000000000010'
where appeal_status = 'open';

do $$
declare denied boolean := false;
begin
  begin
    insert into public.social_moderation_actions (
      appeal_id, action_type, reason, policy_version, request_id
    )
    select
      id, 'appeal_reversed', 'Reviewer cannot reverse', 'safety-v1',
      '29000000-0000-4000-8000-000000000104'
    from public.social_moderation_appeals
    where appeal_status = 'reviewing';
  exception when insufficient_privilege then
    denied := true;
  when others then
    if sqlstate = '42501' then denied := true; else raise; end if;
  end;
  if not denied then raise exception 'REVIEWER_DECIDED_APPEAL'; end if;
end $$;

select set_config('request.jwt.claim.sub', '29000000-0000-0000-0000-000000000011', true);

insert into public.social_moderation_actions (
  appeal_id, action_type, reason, policy_version, request_id
)
select
  id,
  'appeal_reversed',
  'Senior review found enough context to restore the Sauti',
  'safety-v1',
  '29000000-0000-4000-8000-000000000105'
from public.social_moderation_appeals
where appeal_status = 'reviewing';

do $$
declare state_value text;
declare appeal_value text;
begin
  select moderation_state into state_value
  from public.social_posts
  where id = '29000000-0000-4000-8000-000000000020';
  if state_value <> 'visible' then raise exception 'APPEAL_REVERSAL_DID_NOT_RESTORE_CONTENT'; end if;

  select appeal_status into appeal_value
  from public.social_moderation_appeals
  where appellant_id = '29000000-0000-0000-0000-000000000002';
  if appeal_value <> 'reversed' then raise exception 'APPEAL_STATUS_NOT_REVERSED'; end if;
end $$;

select set_config('request.jwt.claim.sub', '29000000-0000-0000-0000-000000000012', true);

do $$
declare audit_rows integer;
begin
  select count(*) into audit_rows from public.social_moderation_audit;
  if audit_rows < 3 then raise exception 'AUDITOR_CANNOT_READ_AUDIT'; end if;
end $$;

do $$
declare denied boolean := false;
begin
  begin
    insert into public.social_moderation_actions (
      report_id, action_type, reason, policy_version, request_id
    )
    select id, 'dismissed', 'Auditor is read only', 'safety-v1',
      '29000000-0000-4000-8000-000000000106'
    from public.social_reports
    limit 1;
  exception when insufficient_privilege then
    denied := true;
  when others then
    if sqlstate = '42501' then denied := true; else raise; end if;
  end;
  if not denied then raise exception 'AUDITOR_CHANGED_CASE'; end if;
end $$;

select 'PHASE29_SYNTHETIC_RLS_PASS' as result;

rollback;
