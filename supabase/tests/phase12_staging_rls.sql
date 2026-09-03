-- Phase 12 remote staging RLS contract.
-- Run against the isolated staging project only. All fixtures are rolled back.

do $$
declare
  table_name text;
  expected_tables text[] := array[
    'social_blocks', 'social_follows', 'social_circles',
    'social_circle_members', 'social_posts', 'user_social_settings',
    'social_notifications', 'dm_conversations',
    'dm_conversation_states', 'dm_messages', 'social_reports'
  ];
begin
  foreach table_name in array expected_tables loop
    if to_regclass(format('public.%I', table_name)) is null then
      raise exception 'MISSING_TABLE:%', table_name;
    end if;

    if not exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = table_name
        and c.relrowsecurity
        and c.relforcerowsecurity
    ) then
      raise exception 'RLS_NOT_FORCED:%', table_name;
    end if;

    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = table_name
    ) then
      raise exception 'MISSING_POLICY:%', table_name;
    end if;
  end loop;

  if has_table_privilege('anon', 'public.user_social_settings', 'SELECT')
     or has_table_privilege('anon', 'public.social_notifications', 'SELECT')
     or has_table_privilege('anon', 'public.dm_messages', 'SELECT')
     or has_table_privilege('anon', 'public.social_reports', 'SELECT') then
    raise exception 'ANON_PRIVATE_ACCESS';
  end if;

  if has_table_privilege('authenticated', 'public.social_notifications', 'INSERT')
     or has_table_privilege('authenticated', 'public.social_reports', 'SELECT')
     or has_table_privilege('authenticated', 'public.dm_conversations', 'UPDATE') then
    raise exception 'AUTH_SERVER_CAPABILITY';
  end if;
end $$;

begin;

insert into auth.users (id, email, email_confirmed_at, created_at, updated_at)
values
  ('10000000-0000-0000-0000-000000000001', 'phase12-a@example.invalid', now(), now(), now()),
  ('20000000-0000-0000-0000-000000000002', 'phase12-b@example.invalid', now(), now(), now());

insert into public.account_profiles (id, username, full_name)
values
  ('10000000-0000-0000-0000-000000000001', 'phase12_a', 'Phase 12 A'),
  ('20000000-0000-0000-0000-000000000002', 'phase12_b', 'Phase 12 B');

update public.social_profiles
set is_discoverable = true
where id in (
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000002'
);

insert into public.social_follows (follower_id, followed_id)
values (
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000002'
);

insert into public.social_circles (id, owner_id, slug, name)
values (
  '30000000-0000-0000-0000-000000000003',
  '20000000-0000-0000-0000-000000000002',
  'phase12-circle',
  'Phase 12 Circle'
);

insert into public.social_circle_members (circle_id, member_id, member_role)
values
  ('30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000002', 'owner'),
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'member');

insert into public.social_posts (id, author_id, body, visibility, circle_id)
values
  ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'public fixture', 'public', null),
  ('40000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'follower fixture', 'followers', null),
  ('40000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000002', 'circle fixture', 'circle', '30000000-0000-0000-0000-000000000003');

insert into public.dm_conversations (
  id, member_one_id, member_two_id, created_by
) values (
  '50000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000001'
);

insert into public.dm_conversation_states (conversation_id, user_id)
values
  ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001'),
  ('50000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002');

insert into public.dm_messages (conversation_id, sender_id, body)
values (
  '50000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000002',
  'staging-only message'
);

insert into public.social_notifications (recipient_id, actor_id, notification_type)
values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'follow'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'follow');

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-0000-0000-000000000001',
  true
);

do $$
declare
  visible_posts integer;
  visible_notifications integer;
  visible_messages integer;
  changed integer;
  denied boolean := false;
begin
  select count(*) into visible_posts
  from public.social_posts
  where author_id = '20000000-0000-0000-0000-000000000002';
  if visible_posts <> 3 then
    raise exception 'VISIBLE_POSTS_EXPECTED_3_GOT_%', visible_posts;
  end if;

  select count(*) into visible_notifications
  from public.social_notifications;
  if visible_notifications <> 1 then
    raise exception 'OWN_NOTIFICATIONS_EXPECTED_1_GOT_%', visible_notifications;
  end if;

  select count(*) into visible_messages
  from public.dm_messages
  where conversation_id = '50000000-0000-0000-0000-000000000001';
  if visible_messages <> 1 then
    raise exception 'PARTICIPANT_MESSAGES_EXPECTED_1_GOT_%', visible_messages;
  end if;

  update public.social_posts
  set body = 'cross-user overwrite'
  where id = '40000000-0000-0000-0000-000000000001';
  get diagnostics changed = row_count;
  if changed <> 0 then
    raise exception 'CROSS_USER_POST_UPDATE_ALLOWED';
  end if;

  begin
    insert into public.user_social_settings (user_id)
    values ('20000000-0000-0000-0000-000000000002');
  exception when insufficient_privilege then
    denied := true;
  end;
  if not denied then
    raise exception 'CROSS_USER_SETTINGS_INSERT_ALLOWED';
  end if;
end $$;

reset role;

insert into public.social_blocks (blocker_id, blocked_id)
values (
  '20000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000001'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-0000-0000-000000000001',
  true
);

do $$
declare
  visible_posts integer;
  denied boolean := false;
begin
  select count(*) into visible_posts
  from public.social_posts
  where author_id = '20000000-0000-0000-0000-000000000002';
  if visible_posts <> 0 then
    raise exception 'BLOCKED_AUTHOR_POSTS_VISIBLE:%', visible_posts;
  end if;

  begin
    insert into public.dm_messages (conversation_id, sender_id, body)
    values (
      '50000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      'must be blocked'
    );
  exception when insufficient_privilege then
    denied := true;
  end;
  if not denied then
    raise exception 'BLOCKED_DM_INSERT_ALLOWED';
  end if;
end $$;

reset role;
rollback;
