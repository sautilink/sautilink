-- Phase 30 settings/privacy/account controls synthetic RLS regression.
-- Staging only. Everything rolls back.

begin;

insert into auth.users (id, email, email_confirmed_at, last_sign_in_at, created_at, updated_at)
values
  ('30000000-0000-0000-0000-000000000001', 'phase30-owner@example.invalid', now(), now(), now(), now()),
  ('30000000-0000-0000-0000-000000000002', 'phase30-peer@example.invalid', now(), now(), now(), now());

insert into public.account_profiles (id, username, full_name)
values
  ('30000000-0000-0000-0000-000000000001', 'phase30_owner', 'Phase 30 Owner'),
  ('30000000-0000-0000-0000-000000000002', 'phase30_peer', 'Phase 30 Peer');

update public.social_profiles
set is_discoverable = true
where id::text like '30000000-%';

insert into public.social_posts (
  id, author_id, body, visibility, post_status, audience_owner_id, thread_depth
)
values (
  '30000000-0000-4000-8000-000000000010',
  '30000000-0000-0000-0000-000000000001',
  'Phase 30 notification preference Sauti',
  'public',
  'published',
  '30000000-0000-0000-0000-000000000001',
  0
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000001', true);

do $$
declare own_rows integer;
declare peer_rows integer;
begin
  select count(*) into own_rows
  from public.social_member_preferences
  where user_id = '30000000-0000-0000-0000-000000000001';

  select count(*) into peer_rows
  from public.social_member_preferences
  where user_id = '30000000-0000-0000-0000-000000000002';

  if own_rows <> 1 then raise exception 'OWNER_PREFERENCES_MISSING'; end if;
  if peer_rows <> 0 then raise exception 'PEER_PREFERENCES_LEAKED'; end if;
end $$;

update public.social_member_preferences
set read_receipts = false,
    notify_post_activity = false,
    notify_messages = false,
    email_digest = 'weekly'
where user_id = '30000000-0000-0000-0000-000000000001';

update public.social_member_preferences
set read_receipts = false
where user_id = '30000000-0000-0000-0000-000000000002';

do $$
declare peer_receipts boolean;
begin
  reset role;
  select read_receipts into peer_receipts
  from public.social_member_preferences
  where user_id = '30000000-0000-0000-0000-000000000002';
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000001', true);

  if peer_receipts <> true then raise exception 'OWNER_UPDATED_PEER_PREFERENCES'; end if;
end $$;

update public.social_profiles
set allow_external_indexing = true,
    dm_access = 'everyone'
where id = '30000000-0000-0000-0000-000000000001';

insert into public.social_data_export_requests (request_id, user_id)
values (
  '30000000-0000-4000-8000-000000000020',
  '30000000-0000-0000-0000-000000000001'
);

do $$
declare own_exports integer;
begin
  select count(*) into own_exports
  from public.social_data_export_requests
  where status = 'pending';
  if own_exports <> 1 then raise exception 'EXPORT_REQUEST_NOT_VISIBLE_TO_OWNER'; end if;
end $$;

do $$
declare denied boolean := false;
begin
  begin
    update public.social_data_export_requests
    set status = 'ready'
    where request_id = '30000000-0000-4000-8000-000000000020';
  exception when others then
    if sqlstate = '22023' then denied := true; else raise; end if;
  end;
  if not denied then raise exception 'OWNER_MARKED_EXPORT_READY'; end if;
end $$;

update public.social_data_export_requests
set status = 'cancelled'
where request_id = '30000000-0000-4000-8000-000000000020';

insert into public.social_account_deletion_requests (user_id)
values ('30000000-0000-0000-0000-000000000001');

do $$
declare deletion_status text;
declare scheduled timestamptz;
declare discoverable boolean;
begin
  select status, scheduled_for
    into deletion_status, scheduled
  from public.social_account_deletion_requests
  where user_id = '30000000-0000-0000-0000-000000000001';

  select is_discoverable
    into discoverable
  from public.social_profiles
  where id = '30000000-0000-0000-0000-000000000001';

  if deletion_status <> 'pending' then raise exception 'DELETION_REQUEST_NOT_PENDING'; end if;
  if scheduled is null or scheduled < now() + interval '13 days' then raise exception 'DELETION_RECOVERY_WINDOW_MISSING'; end if;
  if discoverable <> false then raise exception 'DELETION_DID_NOT_HIDE_PROFILE'; end if;
end $$;

update public.social_account_deletion_requests
set status = 'cancelled'
where user_id = '30000000-0000-0000-0000-000000000001';

do $$
declare scheduled timestamptz;
declare discoverable boolean;
begin
  select scheduled_for into scheduled
  from public.social_account_deletion_requests
  where user_id = '30000000-0000-0000-0000-000000000001';

  select is_discoverable into discoverable
  from public.social_profiles
  where id = '30000000-0000-0000-0000-000000000001';

  if scheduled is not null then raise exception 'CANCELLED_DELETION_RETAINED_SCHEDULE'; end if;
  if discoverable <> true then raise exception 'DELETION_CANCEL_DID_NOT_RESTORE_DISCOVERABILITY'; end if;
end $$;

select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000002', true);

do $$
declare leaked integer;
begin
  select count(*) into leaked
  from public.social_data_export_requests
  where user_id = '30000000-0000-0000-0000-000000000001';
  if leaked <> 0 then raise exception 'EXPORT_REQUEST_LEAKED_TO_PEER'; end if;
end $$;

insert into public.social_follows (follower_id, followed_id)
values (
  '30000000-0000-0000-0000-000000000002',
  '30000000-0000-0000-0000-000000000001'
);

update public.social_profiles
set dm_access = 'following'
where id = '30000000-0000-0000-0000-000000000002';

select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000001', true);

do $$
declare conversation_id uuid;
begin
  select public.open_dm_conversation_phase23('30000000-0000-0000-0000-000000000002')
    into conversation_id;
  if conversation_id is null then raise exception 'FOLLOWING_DM_CONVERSATION_NOT_CREATED'; end if;
end $$;

select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000002', true);

update public.social_profiles
set dm_access = 'none'
where id = '30000000-0000-0000-0000-000000000002';

select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000001', true);

do $$
declare conversation_id uuid;
declare denied boolean := false;
begin
  select id into conversation_id
  from public.dm_conversations
  where member_one_id in (
      '30000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000002'
    )
    and member_two_id in (
      '30000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000002'
    )
  limit 1;

  begin
    insert into public.dm_messages (conversation_id, sender_id, body)
    values (
      conversation_id,
      '30000000-0000-0000-0000-000000000001',
      'This delivery must be denied by Phase 30'
    );
  exception when insufficient_privilege then
    denied := true;
  when others then
    if sqlstate = '42501' then denied := true; else raise; end if;
  end;

  if not denied then raise exception 'DM_NONE_SETTING_NOT_ENFORCED'; end if;
end $$;

select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000002', true);
update public.social_profiles
set dm_access = 'everyone'
where id = '30000000-0000-0000-0000-000000000002';

update public.social_member_preferences
set read_receipts = false
where user_id = '30000000-0000-0000-0000-000000000002';

update public.dm_conversation_states
set last_read_at = now()
where user_id = '30000000-0000-0000-0000-000000000002';

select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000001', true);

do $$
declare conversation_id uuid;
declare peer_read timestamptz;
begin
  select id into conversation_id
  from public.dm_conversations
  where member_one_id in (
      '30000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000002'
    )
    and member_two_id in (
      '30000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000002'
    )
  limit 1;

  select peer_last_read_at into peer_read
  from public.dm_peer_read_state_phase30(conversation_id);

  if peer_read is not null then raise exception 'READ_RECEIPT_LEAKED_WHEN_DISABLED'; end if;

  insert into public.dm_messages (conversation_id, sender_id, body)
  values (
    conversation_id,
    '30000000-0000-0000-0000-000000000001',
    'Phase 30 allowed delivery'
  );
end $$;

select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000002', true);

update public.social_member_preferences
set read_receipts = true
where user_id = '30000000-0000-0000-0000-000000000002';

update public.dm_conversation_states
set last_read_at = now()
where user_id = '30000000-0000-0000-0000-000000000002';

insert into public.social_post_reactions (post_id, user_id, reaction_type)
values (
  '30000000-0000-4000-8000-000000000010',
  '30000000-0000-0000-0000-000000000002',
  'like'
);

select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000001', true);

do $$
declare conversation_id uuid;
declare peer_read timestamptz;
declare notifications integer;
begin
  select id into conversation_id
  from public.dm_conversations
  where member_one_id in (
      '30000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000002'
    )
    and member_two_id in (
      '30000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000002'
    )
  limit 1;

  select peer_last_read_at into peer_read
  from public.dm_peer_read_state_phase30(conversation_id);
  if peer_read is null then raise exception 'READ_RECEIPT_NOT_VISIBLE_WHEN_ENABLED'; end if;

  select count(*) into notifications
  from public.social_notifications
  where notification_type = 'like'
    and post_id = '30000000-0000-4000-8000-000000000010';

  if notifications <> 0 then raise exception 'DISABLED_POST_NOTIFICATION_WAS_CREATED'; end if;
end $$;

select 'PHASE30_SYNTHETIC_RLS_PASS' as result;

rollback;
