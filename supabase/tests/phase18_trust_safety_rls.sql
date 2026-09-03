-- Phase 18 trust/safety RLS regression.
-- Synthetic staging-only fixtures. Everything rolls back.

begin;

insert into auth.users (id, email, email_confirmed_at, created_at, updated_at)
values
  ('18000000-0000-0000-0000-000000000001', 'phase18-a@example.invalid', now(), now(), now()),
  ('18000000-0000-0000-0000-000000000002', 'phase18-b@example.invalid', now(), now(), now());

insert into public.account_profiles (id, username, full_name)
values
  ('18000000-0000-0000-0000-000000000001', 'phase18_a', 'Phase 18 A'),
  ('18000000-0000-0000-0000-000000000002', 'phase18_b', 'Phase 18 B');

update public.social_profiles
set is_discoverable = true
where id in (
  '18000000-0000-0000-0000-000000000001',
  '18000000-0000-0000-0000-000000000002'
);

insert into public.social_posts (id, author_id, body)
values (
  '18000000-0000-4000-8000-000000000010',
  '18000000-0000-0000-0000-000000000002',
  'Phase 18 target Sauti'
);

insert into public.social_post_comments (id, post_id, author_id, body)
values (
  '18000000-0000-4000-8000-000000000020',
  '18000000-0000-4000-8000-000000000010',
  '18000000-0000-0000-0000-000000000002',
  'Phase 18 target comment'
);

insert into public.social_follows (follower_id, followed_id)
values
  ('18000000-0000-0000-0000-000000000001', '18000000-0000-0000-0000-000000000002'),
  ('18000000-0000-0000-0000-000000000002', '18000000-0000-0000-0000-000000000001');

set local role authenticated;
select set_config('request.jwt.claim.sub', '18000000-0000-0000-0000-000000000001', true);

insert into public.social_reports (reporter_id, target_type, target_id, reason, details)
values
  ('18000000-0000-0000-0000-000000000001', 'profile', '18000000-0000-0000-0000-000000000002', 'spam', 'Synthetic profile report'),
  ('18000000-0000-0000-0000-000000000001', 'post', '18000000-0000-4000-8000-000000000010', 'harassment', 'Synthetic post report'),
  ('18000000-0000-0000-0000-000000000001', 'comment', '18000000-0000-4000-8000-000000000020', 'hate', 'Synthetic comment report');

do $$
declare blocked boolean := false;
begin
  begin
    insert into public.social_reports (reporter_id, target_type, target_id, reason)
    values (
      '18000000-0000-0000-0000-000000000001',
      'profile',
      '18000000-0000-0000-0000-000000000002',
      'spam'
    );
  exception when unique_violation then
    blocked := true;
  end;
  if not blocked then raise exception 'DUPLICATE_ACTIVE_REPORT_ALLOWED'; end if;
end $$;

do $$
declare blocked boolean := false;
begin
  begin
    insert into public.social_reports (reporter_id, target_type, target_id, reason)
    values (
      '18000000-0000-0000-0000-000000000001',
      'profile',
      '18000000-0000-0000-0000-000000000001',
      'other'
    );
  exception when others then
    if sqlstate = '22023' then blocked := true; else raise; end if;
  end;
  if not blocked then raise exception 'SELF_REPORT_ALLOWED'; end if;
end $$;

do $$
declare blocked boolean := false;
declare row_count_value integer;
begin
  begin
    select count(*) into row_count_value from public.social_reports;
  exception when insufficient_privilege then
    blocked := true;
  end;
  if not blocked then raise exception 'REPORTER_REPORT_READ_ALLOWED'; end if;
end $$;

do $$
declare blocked boolean := false;
begin
  begin
    update public.social_reports
    set report_status = 'resolved'
    where reporter_id = '18000000-0000-0000-0000-000000000001';
  exception when insufficient_privilege then
    blocked := true;
  end;
  if not blocked then raise exception 'REPORTER_MODERATION_UPDATE_ALLOWED'; end if;
end $$;

insert into public.social_account_deletion_requests (user_id)
values ('18000000-0000-0000-0000-000000000001');

do $$
declare hidden boolean;
begin
  select not is_discoverable into hidden
  from public.social_profiles
  where id = '18000000-0000-0000-0000-000000000001';
  if hidden is distinct from true then raise exception 'DELETION_REQUEST_DID_NOT_HIDE_PROFILE'; end if;
end $$;

update public.social_account_deletion_requests
set status = 'cancelled'
where user_id = '18000000-0000-0000-0000-000000000001';

do $$
declare restored boolean;
begin
  select is_discoverable into restored
  from public.social_profiles
  where id = '18000000-0000-0000-0000-000000000001';
  if restored is distinct from true then raise exception 'DELETION_CANCEL_DID_NOT_RESTORE_PROFILE'; end if;
end $$;

do $$
declare blocked boolean := false;
begin
  begin
    update public.social_account_deletion_requests
    set status = 'completed'
    where user_id = '18000000-0000-0000-0000-000000000001';
  exception when others then
    if sqlstate = '22023' then blocked := true; else raise; end if;
  end;
  if not blocked then raise exception 'MEMBER_COMPLETED_OWN_DELETION'; end if;
end $$;

insert into public.social_blocks (blocker_id, blocked_id)
values (
  '18000000-0000-0000-0000-000000000001',
  '18000000-0000-0000-0000-000000000002'
);

do $$
declare rows_remaining integer;
begin
  select count(*) into rows_remaining
  from public.social_follows
  where
    (follower_id = '18000000-0000-0000-0000-000000000001' and followed_id = '18000000-0000-0000-0000-000000000002')
    or
    (follower_id = '18000000-0000-0000-0000-000000000002' and followed_id = '18000000-0000-0000-0000-000000000001');
  if rows_remaining <> 0 then raise exception 'BLOCK_DID_NOT_REMOVE_FOLLOWS'; end if;
end $$;

do $$
declare visible_rows integer;
begin
  select count(*) into visible_rows
  from public.social_profiles
  where id = '18000000-0000-0000-0000-000000000002';
  if visible_rows <> 1 then raise exception 'BLOCKER_CANNOT_REACH_UNBLOCK_PROFILE'; end if;
end $$;

do $$
declare blocked boolean := false;
begin
  begin
    insert into public.social_post_reactions (post_id, user_id, reaction_type)
    values (
      '18000000-0000-4000-8000-000000000010',
      '18000000-0000-0000-0000-000000000001',
      'like'
    );
  exception when insufficient_privilege then
    blocked := true;
  end;
  if not blocked then raise exception 'BLOCKED_LIKE_ALLOWED'; end if;
end $$;

do $$
declare blocked boolean := false;
begin
  begin
    insert into public.social_post_comments (post_id, author_id, body)
    values (
      '18000000-0000-4000-8000-000000000010',
      '18000000-0000-0000-0000-000000000001',
      'Blocked comment'
    );
  exception when insufficient_privilege then
    blocked := true;
  end;
  if not blocked then raise exception 'BLOCKED_COMMENT_ALLOWED'; end if;
end $$;

do $$
declare blocked boolean := false;
begin
  begin
    insert into public.social_reposts (post_id, user_id)
    values (
      '18000000-0000-4000-8000-000000000010',
      '18000000-0000-0000-0000-000000000001'
    );
  exception when insufficient_privilege then
    blocked := true;
  end;
  if not blocked then raise exception 'BLOCKED_REPOST_ALLOWED'; end if;
end $$;

select set_config('request.jwt.claim.sub', '18000000-0000-0000-0000-000000000002', true);

do $$
declare visible_rows integer;
begin
  select count(*) into visible_rows
  from public.social_profiles
  where id = '18000000-0000-0000-0000-000000000001';
  if visible_rows <> 0 then raise exception 'BLOCKED_USER_CAN_READ_BLOCKER_PROFILE'; end if;
end $$;

do $$
declare blocked boolean := false;
begin
  begin
    insert into public.social_follows (follower_id, followed_id)
    values (
      '18000000-0000-0000-0000-000000000002',
      '18000000-0000-0000-0000-000000000001'
    );
  exception when insufficient_privilege then
    blocked := true;
  end;
  if not blocked then raise exception 'BLOCKED_FOLLOW_ALLOWED'; end if;
end $$;

do $$
declare visible_rows integer;
begin
  select count(*) into visible_rows
  from public.social_account_deletion_requests
  where user_id = '18000000-0000-0000-0000-000000000001';
  if visible_rows <> 0 then raise exception 'CROSS_USER_DELETION_REQUEST_VISIBLE'; end if;
end $$;

reset role;

update public.social_reports
set report_status = 'reviewing', moderation_note = 'Synthetic moderation'
where reporter_id = '18000000-0000-0000-0000-000000000001'
  and target_type = 'profile';

do $$
declare audit_rows integer;
begin
  select count(*) into audit_rows
  from private.social_report_status_audit
  where new_status = 'reviewing';
  if audit_rows <> 1 then raise exception 'MODERATION_STATUS_AUDIT_MISSING'; end if;
end $$;

rollback;
