-- Platform-wide Messages activity presence.
-- Presence is live/ephemeral in Supabase Realtime. Only a coarse last-active heartbeat
-- is persisted privately so Messages can show "Active recently" for up to five days.

create table if not exists private.member_activity_phase37 (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_active_at timestamptz not null default now()
);

revoke all on table private.member_activity_phase37 from public, anon, authenticated;

create or replace function public.can_view_member_activity_topic_phase37(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_uid uuid := auth.uid();
  peer_uid uuid;
  prefix constant text := 'member-activity:';
begin
  if current_uid is null or p_topic is null or left(p_topic, length(prefix)) <> prefix then
    return false;
  end if;

  begin
    peer_uid := substring(p_topic from length(prefix) + 1)::uuid;
  exception when invalid_text_representation then
    return false;
  end;

  if peer_uid = current_uid then
    return exists (
      select 1
      from public.social_member_preferences pref
      where pref.user_id = current_uid
        and pref.activity_status = true
    );
  end if;

  return
    exists (
      select 1
      from public.social_member_preferences viewer_pref
      where viewer_pref.user_id = current_uid
        and viewer_pref.activity_status = true
    )
    and exists (
      select 1
      from public.social_member_preferences peer_pref
      where peer_pref.user_id = peer_uid
        and peer_pref.activity_status = true
    )
    and exists (
      select 1
      from public.dm_conversations conversation
      where (
        (conversation.member_one_id = current_uid and conversation.member_two_id = peer_uid)
        or (conversation.member_one_id = peer_uid and conversation.member_two_id = current_uid)
      )
      and not exists (
        select 1
        from public.social_blocks block
        where (
          block.blocker_id = current_uid and block.blocked_id = peer_uid
        ) or (
          block.blocker_id = peer_uid and block.blocked_id = current_uid
        )
      )
    );
end;
$$;

revoke all on function public.can_view_member_activity_topic_phase37(text) from public, anon;
grant execute on function public.can_view_member_activity_topic_phase37(text) to authenticated;

create or replace function public.touch_member_activity_phase37()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_uid uuid := auth.uid();
  enabled boolean := false;
begin
  if current_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select coalesce(pref.activity_status, false)
    into enabled
  from public.social_member_preferences pref
  where pref.user_id = current_uid;

  if not enabled then
    delete from private.member_activity_phase37
    where user_id = current_uid;
    return false;
  end if;

  insert into private.member_activity_phase37 (user_id, last_active_at)
  values (current_uid, now())
  on conflict (user_id) do update
  set last_active_at = excluded.last_active_at;

  return true;
end;
$$;

revoke all on function public.touch_member_activity_phase37() from public, anon;
grant execute on function public.touch_member_activity_phase37() to authenticated;

create or replace function public.dm_peer_recent_activity_phase37(p_peer_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_peer_id is null then
    return false;
  end if;

  if not public.can_view_member_activity_topic_phase37('member-activity:' || p_peer_id::text) then
    return false;
  end if;

  return exists (
    select 1
    from private.member_activity_phase37 activity
    where activity.user_id = p_peer_id
      and activity.last_active_at >= now() - interval '5 days'
  );
end;
$$;

revoke all on function public.dm_peer_recent_activity_phase37(uuid) from public, anon;
grant execute on function public.dm_peer_recent_activity_phase37(uuid) to authenticated;

create or replace function private.clear_member_activity_on_privacy_phase37()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.activity_status is true and new.activity_status is not true then
    delete from private.member_activity_phase37
    where user_id = new.user_id;
  end if;
  return new;
end;
$$;

revoke all on function private.clear_member_activity_on_privacy_phase37() from public, anon, authenticated;

drop trigger if exists social_member_activity_privacy_phase37 on public.social_member_preferences;
create trigger social_member_activity_privacy_phase37
after update of activity_status on public.social_member_preferences
for each row
execute function private.clear_member_activity_on_privacy_phase37();

drop policy if exists dm_realtime_receive_phase34 on realtime.messages;
drop policy if exists dm_realtime_send_phase34 on realtime.messages;

create policy dm_realtime_receive_phase34
on realtime.messages
for select
to authenticated
using (
  (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) = ('dm-user:' || (select auth.uid())::text)
  )
  or (
    realtime.messages.extension in ('broadcast', 'presence')
    and exists (
      select 1
      from public.social_member_preferences pref
      where pref.user_id = (select auth.uid())
        and pref.activity_status = true
    )
    and exists (
      select 1
      from public.dm_conversations conversation
      where ('dm:' || conversation.id::text) = (select realtime.topic())
        and (
          conversation.member_one_id = (select auth.uid())
          or conversation.member_two_id = (select auth.uid())
        )
        and not exists (
          select 1
          from public.social_blocks block
          where (
            block.blocker_id = conversation.member_one_id
            and block.blocked_id = conversation.member_two_id
          ) or (
            block.blocker_id = conversation.member_two_id
            and block.blocked_id = conversation.member_one_id
          )
        )
    )
  )
  or (
    realtime.messages.extension = 'presence'
    and public.can_view_member_activity_topic_phase37((select realtime.topic()))
  )
);

create policy dm_realtime_send_phase34
on realtime.messages
for insert
to authenticated
with check (
  (
    realtime.messages.extension in ('broadcast', 'presence')
    and exists (
      select 1
      from public.social_member_preferences pref
      where pref.user_id = (select auth.uid())
        and pref.activity_status = true
    )
    and exists (
      select 1
      from public.dm_conversations conversation
      where ('dm:' || conversation.id::text) = (select realtime.topic())
        and (
          conversation.member_one_id = (select auth.uid())
          or conversation.member_two_id = (select auth.uid())
        )
        and not exists (
          select 1
          from public.social_blocks block
          where (
            block.blocker_id = conversation.member_one_id
            and block.blocked_id = conversation.member_two_id
          ) or (
            block.blocker_id = conversation.member_two_id
            and block.blocked_id = conversation.member_one_id
          )
        )
    )
  )
  or (
    realtime.messages.extension = 'presence'
    and (select realtime.topic()) = ('member-activity:' || (select auth.uid())::text)
    and exists (
      select 1
      from public.social_member_preferences pref
      where pref.user_id = (select auth.uid())
        and pref.activity_status = true
    )
  )
);
