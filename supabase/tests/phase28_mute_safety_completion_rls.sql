-- Phase 28 mute + safety completion RLS regression.
-- Synthetic staging-only fixtures. Everything rolls back.

begin;

insert into auth.users (id, email, email_confirmed_at, created_at, updated_at)
values
  ('28000000-0000-0000-0000-000000000001', 'phase28-a@example.invalid', now(), now(), now()),
  ('28000000-0000-0000-0000-000000000002', 'phase28-b@example.invalid', now(), now(), now());

insert into public.account_profiles (id, username, full_name)
values
  ('28000000-0000-0000-0000-000000000001', 'phase28_a', 'Phase 28 A'),
  ('28000000-0000-0000-0000-000000000002', 'phase28_b', 'Phase 28 B');

update public.social_profiles
set is_discoverable = true
where id in (
  '28000000-0000-0000-0000-000000000001',
  '28000000-0000-0000-0000-000000000002'
);

insert into public.social_posts (
  id, author_id, body, visibility, post_status, audience_owner_id, thread_depth
)
values
  (
    '28000000-0000-4000-8000-000000000010',
    '28000000-0000-0000-0000-000000000001',
    'Phase 28 A Sauti',
    'public',
    'published',
    '28000000-0000-0000-0000-000000000001',
    0
  ),
  (
    '28000000-0000-4000-8000-000000000020',
    '28000000-0000-0000-0000-000000000002',
    'Phase 28 B Sauti',
    'public',
    'published',
    '28000000-0000-0000-0000-000000000002',
    0
  );

insert into public.social_post_comments (id, post_id, author_id, body)
values (
  '28000000-0000-4000-8000-000000000030',
  '28000000-0000-4000-8000-000000000010',
  '28000000-0000-0000-0000-000000000002',
  'Phase 28 legacy comment from B'
);

insert into public.social_reposts (post_id, user_id)
values (
  '28000000-0000-4000-8000-000000000010',
  '28000000-0000-0000-0000-000000000002'
);

insert into public.social_follows (follower_id, followed_id)
values (
  '28000000-0000-0000-0000-000000000001',
  '28000000-0000-0000-0000-000000000002'
);

insert into public.social_notifications (
  recipient_id, actor_id, notification_type, read_at
)
values (
  '28000000-0000-0000-0000-000000000001',
  '28000000-0000-0000-0000-000000000002',
  'follow',
  null
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '28000000-0000-0000-0000-000000000001', true);

insert into public.social_mutes (muter_id, muted_id)
values (
  '28000000-0000-0000-0000-000000000001',
  '28000000-0000-0000-0000-000000000002'
);

do $$
declare mute_rows integer;
begin
  select count(*) into mute_rows
  from public.social_mutes
  where muter_id = '28000000-0000-0000-0000-000000000001'
    and muted_id = '28000000-0000-0000-0000-000000000002';
  if mute_rows <> 1 then raise exception 'OWN_MUTE_NOT_VISIBLE'; end if;
end $$;

do $$
declare visible_rows integer;
begin
  select count(*) into visible_rows
  from public.social_posts
  where id = '28000000-0000-4000-8000-000000000020';
  if visible_rows <> 0 then raise exception 'MUTED_SAUTI_VISIBLE'; end if;
end $$;

do $$
declare visible_rows integer;
begin
  select count(*) into visible_rows
  from public.social_reposts
  where post_id = '28000000-0000-4000-8000-000000000010'
    and user_id = '28000000-0000-0000-0000-000000000002';
  if visible_rows <> 0 then raise exception 'MUTED_REPOST_VISIBLE'; end if;
end $$;

do $$
declare visible_rows integer;
begin
  select count(*) into visible_rows
  from public.social_post_comments
  where id = '28000000-0000-4000-8000-000000000030';
  if visible_rows <> 0 then raise exception 'MUTED_COMMENT_VISIBLE'; end if;
end $$;

do $$
declare remaining integer;
begin
  select count(*) into remaining
  from public.social_notifications
  where recipient_id = '28000000-0000-0000-0000-000000000001'
    and actor_id = '28000000-0000-0000-0000-000000000002';
  if remaining <> 0 then raise exception 'MUTE_DID_NOT_PURGE_NOTIFICATIONS'; end if;
end $$;

do $$
declare follow_rows integer;
begin
  select count(*) into follow_rows
  from public.social_follows
  where follower_id = '28000000-0000-0000-0000-000000000001'
    and followed_id = '28000000-0000-0000-0000-000000000002';
  if follow_rows <> 1 then raise exception 'MUTE_REMOVED_FOLLOW'; end if;
end $$;

do $$
declare blocked boolean := false;
begin
  begin
    insert into public.social_mutes (muter_id, muted_id)
    values (
      '28000000-0000-0000-0000-000000000001',
      '28000000-0000-0000-0000-000000000001'
    );
  exception
    when check_violation or insufficient_privilege then
      blocked := true;
  end;
  if not blocked then raise exception 'SELF_MUTE_ALLOWED'; end if;
end $$;

select set_config('request.jwt.claim.sub', '28000000-0000-0000-0000-000000000002', true);

do $$
declare visible_rows integer;
begin
  select count(*) into visible_rows
  from public.social_mutes
  where muter_id = '28000000-0000-0000-0000-000000000001'
    and muted_id = '28000000-0000-0000-0000-000000000002';
  if visible_rows <> 0 then raise exception 'MUTE_RELATIONSHIP_LEAKED_TO_TARGET'; end if;
end $$;

delete from public.social_mutes
where muter_id = '28000000-0000-0000-0000-000000000001'
  and muted_id = '28000000-0000-0000-0000-000000000002';

reset role;

do $$
declare mute_rows integer;
begin
  select count(*) into mute_rows
  from public.social_mutes
  where muter_id = '28000000-0000-0000-0000-000000000001'
    and muted_id = '28000000-0000-0000-0000-000000000002';
  if mute_rows <> 1 then raise exception 'CROSS_USER_MUTE_DELETE_ALLOWED'; end if;
end $$;

-- A new notification from the muted actor is suppressed by the Phase 28 BEFORE INSERT trigger.
insert into public.social_notifications (
  recipient_id, actor_id, notification_type, read_at
)
values (
  '28000000-0000-0000-0000-000000000001',
  '28000000-0000-0000-0000-000000000002',
  'follow',
  null
);

do $$
declare notification_rows integer;
begin
  select count(*) into notification_rows
  from public.social_notifications
  where recipient_id = '28000000-0000-0000-0000-000000000001'
    and actor_id = '28000000-0000-0000-0000-000000000002';
  if notification_rows <> 0 then raise exception 'MUTED_NOTIFICATION_CREATED'; end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '28000000-0000-0000-0000-000000000001', true);

insert into public.social_blocks (blocker_id, blocked_id)
values (
  '28000000-0000-0000-0000-000000000001',
  '28000000-0000-0000-0000-000000000002'
);

do $$
declare mute_rows integer;
begin
  select count(*) into mute_rows
  from public.social_mutes
  where muter_id = '28000000-0000-0000-0000-000000000001'
    and muted_id = '28000000-0000-0000-0000-000000000002';
  if mute_rows <> 0 then raise exception 'BLOCK_DID_NOT_SUPERSEDE_MUTE'; end if;
end $$;

reset role;

select 'PHASE28_SYNTHETIC_RLS_PASS' as result;

rollback;
