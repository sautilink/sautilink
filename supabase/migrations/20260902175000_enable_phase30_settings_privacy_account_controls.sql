-- Phase 30 — Settings, Privacy & Account Controls
-- Staging-first owner settings, DM privacy enforcement, notification preferences,
-- data-export request state, and a recoverable account-deletion window.

begin;

alter table public.social_profiles
  add column if not exists allow_external_indexing boolean not null default false,
  add column if not exists dm_access text not null default 'following';

alter table public.social_profiles
  drop constraint if exists social_profiles_dm_access_allowed;

alter table public.social_profiles
  add constraint social_profiles_dm_access_allowed
  check (dm_access = any (array['following'::text, 'everyone'::text, 'none'::text]));

comment on column public.social_profiles.allow_external_indexing is
  'Phase 30 owner preference for whether a discoverable public profile may be indexed by external search engines. Staging remains globally noindex.';
comment on column public.social_profiles.dm_access is
  'Phase 30 inbound DM policy: following means the recipient follows the sender; everyone allows any eligible member; none blocks new delivery.';

grant update (allow_external_indexing, dm_access)
  on table public.social_profiles
  to authenticated;

create table if not exists public.social_member_preferences (
  user_id uuid primary key references public.social_profiles(id) on delete cascade,
  read_receipts boolean not null default true,
  activity_status boolean not null default false,
  notify_post_activity boolean not null default true,
  notify_messages boolean not null default true,
  notify_followers boolean not null default true,
  notify_sautify boolean not null default true,
  email_digest text not null default 'off'
    check (email_digest = any (array['off'::text, 'daily'::text, 'weekly'::text])),
  updated_at timestamptz not null default now()
);

comment on table public.social_member_preferences is
  'Phase 30 private owner settings that must never be projected through the public social profile.';

alter table public.social_member_preferences enable row level security;
alter table public.social_member_preferences force row level security;

revoke all on table public.social_member_preferences from public, anon, authenticated;
grant select on table public.social_member_preferences to authenticated;
grant insert (
  user_id,
  read_receipts,
  activity_status,
  notify_post_activity,
  notify_messages,
  notify_followers,
  notify_sautify,
  email_digest
) on table public.social_member_preferences to authenticated;
grant update (
  read_receipts,
  activity_status,
  notify_post_activity,
  notify_messages,
  notify_followers,
  notify_sautify,
  email_digest
) on table public.social_member_preferences to authenticated;

drop policy if exists social_member_preferences_select_own_phase30 on public.social_member_preferences;
create policy social_member_preferences_select_own_phase30
  on public.social_member_preferences
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists social_member_preferences_insert_own_phase30 on public.social_member_preferences;
create policy social_member_preferences_insert_own_phase30
  on public.social_member_preferences
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists social_member_preferences_update_own_phase30 on public.social_member_preferences;
create policy social_member_preferences_update_own_phase30
  on public.social_member_preferences
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create or replace function private.touch_phase30_member_preferences()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.user_id := old.user_id;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.touch_phase30_member_preferences() from public, anon, authenticated;

drop trigger if exists phase30_touch_member_preferences on public.social_member_preferences;
create trigger phase30_touch_member_preferences
before update on public.social_member_preferences
for each row execute function private.touch_phase30_member_preferences();

insert into public.social_member_preferences (user_id)
select profile.id
from public.social_profiles profile
on conflict (user_id) do nothing;

create or replace function private.bootstrap_phase30_member_preferences()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.social_member_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke all on function private.bootstrap_phase30_member_preferences() from public, anon, authenticated;

drop trigger if exists phase30_bootstrap_member_preferences on public.social_profiles;
create trigger phase30_bootstrap_member_preferences
after insert on public.social_profiles
for each row execute function private.bootstrap_phase30_member_preferences();

create table if not exists public.social_data_export_requests (
  request_id uuid primary key,
  user_id uuid not null references public.social_profiles(id) on delete cascade,
  status text not null default 'pending'
    check (status = any (array['pending'::text, 'processing'::text, 'ready'::text, 'cancelled'::text, 'expired'::text])),
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  expires_at timestamptz,
  cancelled_at timestamptz
);

comment on table public.social_data_export_requests is
  'Phase 30 owner-scoped export requests. A privileged processor may prepare an archive later; browser clients cannot mark requests ready.';

create unique index if not exists social_data_export_requests_one_active_idx
  on public.social_data_export_requests (user_id)
  where status in ('pending', 'processing', 'ready');

create index if not exists social_data_export_requests_user_requested_idx
  on public.social_data_export_requests (user_id, requested_at desc);

alter table public.social_data_export_requests enable row level security;
alter table public.social_data_export_requests force row level security;

revoke all on table public.social_data_export_requests from public, anon, authenticated;
grant select on table public.social_data_export_requests to authenticated;
grant insert (request_id, user_id) on table public.social_data_export_requests to authenticated;
grant update (status) on table public.social_data_export_requests to authenticated;

drop policy if exists social_data_export_requests_select_own_phase30 on public.social_data_export_requests;
create policy social_data_export_requests_select_own_phase30
  on public.social_data_export_requests
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists social_data_export_requests_insert_own_phase30 on public.social_data_export_requests;
create policy social_data_export_requests_insert_own_phase30
  on public.social_data_export_requests
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists social_data_export_requests_update_own_phase30 on public.social_data_export_requests;
create policy social_data_export_requests_update_own_phase30
  on public.social_data_export_requests
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create or replace function private.normalize_phase30_export_request()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_uid uuid := auth.uid();
begin
  if current_uid is null then
    if current_user in ('postgres', 'service_role', 'supabase_admin') then
      return new;
    end if;
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if new.user_id <> current_uid then
      raise exception 'EXPORT_OWNER_MISMATCH' using errcode = '42501';
    end if;
    new.status := 'pending';
    new.requested_at := now();
    new.updated_at := now();
    new.completed_at := null;
    new.expires_at := null;
    new.cancelled_at := null;
    return new;
  end if;

  if old.user_id <> current_uid or new.user_id <> old.user_id then
    raise exception 'EXPORT_OWNER_MISMATCH' using errcode = '42501';
  end if;

  if old.status in ('pending', 'processing', 'ready') and new.status = 'cancelled' then
    new.status := 'cancelled';
    new.requested_at := old.requested_at;
    new.updated_at := now();
    new.completed_at := old.completed_at;
    new.expires_at := old.expires_at;
    new.cancelled_at := now();
    return new;
  end if;

  raise exception 'INVALID_EXPORT_TRANSITION' using errcode = '22023';
end;
$$;

revoke all on function private.normalize_phase30_export_request() from public, anon, authenticated;

drop trigger if exists phase30_normalize_export_request on public.social_data_export_requests;
create trigger phase30_normalize_export_request
before insert or update on public.social_data_export_requests
for each row execute function private.normalize_phase30_export_request();

alter table public.social_account_deletion_requests
  add column if not exists scheduled_for timestamptz;

update public.social_account_deletion_requests
set scheduled_for = requested_at + interval '14 days'
where status = 'pending'
  and scheduled_for is null;

revoke insert, update on table public.social_account_deletion_requests from authenticated;
grant insert (user_id) on table public.social_account_deletion_requests to authenticated;
grant update (status) on table public.social_account_deletion_requests to authenticated;

create or replace function private.normalize_account_deletion_request()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_uid uuid := auth.uid();
  current_discoverable boolean;
begin
  if current_uid is null then
    if current_user in ('postgres', 'service_role', 'supabase_admin') then
      return new;
    end if;
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    select profile.is_discoverable
      into current_discoverable
    from public.social_profiles profile
    where profile.id = current_uid;

    if not found then
      raise exception 'PROFILE_REQUIRED' using errcode = 'P0002';
    end if;

    new.user_id := current_uid;
    new.status := 'pending';
    new.requested_at := now();
    new.scheduled_for := now() + interval '14 days';
    new.cancelled_at := null;
    new.completed_at := null;
    new.restore_discoverable := current_discoverable;
    return new;
  end if;

  if old.user_id <> current_uid or new.user_id <> old.user_id then
    raise exception 'DELETION_REQUEST_OWNER_MISMATCH' using errcode = '42501';
  end if;

  if old.status = 'pending' and new.status = 'cancelled' then
    new.status := 'cancelled';
    new.requested_at := old.requested_at;
    new.scheduled_for := null;
    new.cancelled_at := now();
    new.completed_at := null;
    new.restore_discoverable := old.restore_discoverable;
    return new;
  end if;

  if old.status = 'cancelled' and new.status = 'pending' then
    select profile.is_discoverable
      into current_discoverable
    from public.social_profiles profile
    where profile.id = current_uid;

    if not found then
      raise exception 'PROFILE_REQUIRED' using errcode = 'P0002';
    end if;

    new.status := 'pending';
    new.requested_at := now();
    new.scheduled_for := now() + interval '14 days';
    new.cancelled_at := null;
    new.completed_at := null;
    new.restore_discoverable := current_discoverable;
    return new;
  end if;

  raise exception 'INVALID_DELETION_REQUEST_TRANSITION' using errcode = '22023';
end;
$$;

revoke all on function private.normalize_account_deletion_request() from public, anon, authenticated;

create or replace function private.suppress_phase30_disabled_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  prefs public.social_member_preferences%rowtype;
begin
  select *
    into prefs
  from public.social_member_preferences preference
  where preference.user_id = new.recipient_id;

  if not found then
    return new;
  end if;

  if new.notification_type = 'follow' and not prefs.notify_followers then
    return null;
  end if;

  if new.notification_type in ('reply', 'like', 'reshare') and not prefs.notify_post_activity then
    return null;
  end if;

  if new.notification_type = 'circle' and not prefs.notify_sautify then
    return null;
  end if;

  return new;
end;
$$;

revoke all on function private.suppress_phase30_disabled_notification() from public, anon, authenticated;

drop trigger if exists phase30_suppress_disabled_notification on public.social_notifications;
create trigger phase30_suppress_disabled_notification
before insert on public.social_notifications
for each row execute function private.suppress_phase30_disabled_notification();

drop policy if exists social_notifications_select_own_phase28 on public.social_notifications;
drop policy if exists social_notifications_select_own_phase30 on public.social_notifications;
create policy social_notifications_select_own_phase30
  on public.social_notifications
  for select
  to authenticated
  using (
    (select auth.uid()) = recipient_id
    and (
      actor_id is null
      or (
        not exists (
          select 1
          from public.social_blocks block
          where
            (block.blocker_id = recipient_id and block.blocked_id = actor_id)
            or
            (block.blocker_id = actor_id and block.blocked_id = recipient_id)
        )
        and not exists (
          select 1
          from public.social_mutes mute
          where mute.muter_id = recipient_id
            and mute.muted_id = actor_id
        )
      )
    )
    and (
      notification_type not in ('follow', 'reply', 'like', 'reshare', 'circle')
      or (
        notification_type = 'follow'
        and coalesce((
          select preference.notify_followers
          from public.social_member_preferences preference
          where preference.user_id = recipient_id
        ), true)
      )
      or (
        notification_type in ('reply', 'like', 'reshare')
        and coalesce((
          select preference.notify_post_activity
          from public.social_member_preferences preference
          where preference.user_id = recipient_id
        ), true)
      )
      or (
        notification_type = 'circle'
        and coalesce((
          select preference.notify_sautify
          from public.social_member_preferences preference
          where preference.user_id = recipient_id
        ), true)
      )
    )
  );

create or replace function public.open_dm_conversation_phase23(p_peer_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_uid uuid := auth.uid();
  member_one uuid;
  member_two uuid;
  conversation_id uuid;
  peer_dm_access text;
begin
  if current_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  if p_peer_id is null or p_peer_id = current_uid then
    raise exception 'DM_PEER_INVALID' using errcode = '22023';
  end if;

  if current_uid::text < p_peer_id::text then
    member_one := current_uid;
    member_two := p_peer_id;
  else
    member_one := p_peer_id;
    member_two := current_uid;
  end if;

  select conversation.id
    into conversation_id
  from public.dm_conversations conversation
  where conversation.member_one_id = member_one
    and conversation.member_two_id = member_two;

  if conversation_id is not null then
    return conversation_id;
  end if;

  select peer.dm_access
    into peer_dm_access
  from public.social_profiles peer
  where peer.id = p_peer_id
    and peer.is_discoverable = true;

  if not found then
    raise exception 'DM_PEER_UNAVAILABLE' using errcode = 'P0002';
  end if;

  if peer_dm_access = 'none' then
    raise exception 'DM_RECIPIENT_RESTRICTED' using errcode = '42501';
  end if;

  if peer_dm_access = 'following'
     and not exists (
       select 1
       from public.social_follows follow_row
       where follow_row.follower_id = p_peer_id
         and follow_row.followed_id = current_uid
     ) then
    raise exception 'DM_RECIPIENT_RESTRICTED' using errcode = '42501';
  end if;

  insert into public.dm_conversations (
    member_one_id,
    member_two_id,
    created_by
  )
  values (
    member_one,
    member_two,
    current_uid
  )
  on conflict (member_one_id, member_two_id) do nothing
  returning id into conversation_id;

  if conversation_id is null then
    select conversation.id
      into conversation_id
    from public.dm_conversations conversation
    where conversation.member_one_id = member_one
      and conversation.member_two_id = member_two;
  end if;

  if conversation_id is null then
    raise exception 'DM_CONVERSATION_UNAVAILABLE' using errcode = '42501';
  end if;

  return conversation_id;
end;
$$;

revoke all on function public.open_dm_conversation_phase23(uuid) from public, anon, authenticated;
grant execute on function public.open_dm_conversation_phase23(uuid) to authenticated;

create or replace function private.enforce_phase23_dm_message_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_uid uuid := auth.uid();
  conversation_row public.dm_conversations%rowtype;
  recent_count integer;
  recipient_id uuid;
  recipient_access text;
begin
  if current_uid is null or new.sender_id <> current_uid then
    raise exception 'DM_SENDER_MISMATCH' using errcode = '42501';
  end if;

  select *
    into conversation_row
  from public.dm_conversations conversation
  where conversation.id = new.conversation_id;

  if not found
     or (conversation_row.member_one_id <> current_uid and conversation_row.member_two_id <> current_uid) then
    raise exception 'DM_CONVERSATION_UNAVAILABLE' using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.social_blocks block
    where (block.blocker_id = conversation_row.member_one_id and block.blocked_id = conversation_row.member_two_id)
       or (block.blocker_id = conversation_row.member_two_id and block.blocked_id = conversation_row.member_one_id)
  ) then
    raise exception 'DM_BLOCKED' using errcode = '42501';
  end if;

  recipient_id := case
    when conversation_row.member_one_id = current_uid then conversation_row.member_two_id
    else conversation_row.member_one_id
  end;

  select profile.dm_access
    into recipient_access
  from public.social_profiles profile
  where profile.id = recipient_id;

  if not found or recipient_access = 'none' then
    raise exception 'DM_RECIPIENT_RESTRICTED' using errcode = '42501';
  end if;

  if recipient_access = 'following'
     and not exists (
       select 1
       from public.social_follows follow_row
       where follow_row.follower_id = recipient_id
         and follow_row.followed_id = current_uid
     ) then
    raise exception 'DM_RECIPIENT_RESTRICTED' using errcode = '42501';
  end if;

  new.body := btrim(new.body);
  new.edited_at := null;
  new.deleted_at := null;

  select count(*)::integer
    into recent_count
  from public.dm_messages message
  where message.sender_id = current_uid
    and message.sent_at >= now() - interval '1 minute';

  if recent_count >= 30 then
    raise exception 'DM_RATE_LIMITED' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_phase23_dm_message_insert() from public, anon, authenticated;

create or replace function policy_private.phase30_peer_read_at(p_conversation_id uuid)
returns timestamptz
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  current_uid uuid := auth.uid();
  peer_id uuid;
  peer_receipts boolean;
  peer_read_at timestamptz;
begin
  if current_uid is null then
    return null;
  end if;

  select
    case
      when conversation.member_one_id = current_uid then conversation.member_two_id
      when conversation.member_two_id = current_uid then conversation.member_one_id
      else null
    end
    into peer_id
  from public.dm_conversations conversation
  where conversation.id = p_conversation_id;

  if peer_id is null then
    return null;
  end if;

  select preference.read_receipts
    into peer_receipts
  from public.social_member_preferences preference
  where preference.user_id = peer_id;

  if coalesce(peer_receipts, true) = false then
    return null;
  end if;

  select state.last_read_at
    into peer_read_at
  from public.dm_conversation_states state
  where state.conversation_id = p_conversation_id
    and state.user_id = peer_id;

  return peer_read_at;
end;
$$;

revoke all on function policy_private.phase30_peer_read_at(uuid) from public, anon, authenticated;
grant execute on function policy_private.phase30_peer_read_at(uuid) to authenticated;

create or replace function public.dm_peer_read_state_phase30(p_conversation_id uuid)
returns table (peer_last_read_at timestamptz)
language sql
security invoker
stable
set search_path = ''
as $$
  select policy_private.phase30_peer_read_at(p_conversation_id);
$$;

revoke all on function public.dm_peer_read_state_phase30(uuid) from public, anon, authenticated;
grant execute on function public.dm_peer_read_state_phase30(uuid) to authenticated;

commit;
