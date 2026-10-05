-- Harden Phase 37 activity authorization by removing the internal policy helper
-- from the exposed public RPC surface. Authorization stays embedded in the
-- Realtime policy and the coarse recent-activity RPC.

drop policy if exists dm_realtime_receive_phase34 on realtime.messages;

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
    and (select realtime.topic()) = ('member-activity:' || (select auth.uid())::text)
    and exists (
      select 1
      from public.social_member_preferences own_pref
      where own_pref.user_id = (select auth.uid())
        and own_pref.activity_status = true
    )
  )
  or (
    realtime.messages.extension = 'presence'
    and exists (
      select 1
      from public.social_member_preferences viewer_pref
      where viewer_pref.user_id = (select auth.uid())
        and viewer_pref.activity_status = true
    )
    and exists (
      select 1
      from public.dm_conversations conversation
      join public.social_member_preferences peer_pref
        on peer_pref.user_id = case
          when conversation.member_one_id = (select auth.uid()) then conversation.member_two_id
          else conversation.member_one_id
        end
      where (
        conversation.member_one_id = (select auth.uid())
        or conversation.member_two_id = (select auth.uid())
      )
        and peer_pref.activity_status = true
        and (select realtime.topic()) = (
          'member-activity:' ||
          case
            when conversation.member_one_id = (select auth.uid()) then conversation.member_two_id::text
            else conversation.member_one_id::text
          end
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
);

create or replace function public.dm_peer_recent_activity_phase37(p_peer_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_uid uuid := auth.uid();
begin
  if current_uid is null or p_peer_id is null or p_peer_id = current_uid then
    return false;
  end if;

  if not exists (
    select 1
    from public.social_member_preferences viewer_pref
    where viewer_pref.user_id = current_uid
      and viewer_pref.activity_status = true
  ) then
    return false;
  end if;

  if not exists (
    select 1
    from public.social_member_preferences peer_pref
    where peer_pref.user_id = p_peer_id
      and peer_pref.activity_status = true
  ) then
    return false;
  end if;

  if not exists (
    select 1
    from public.dm_conversations conversation
    where (
      (conversation.member_one_id = current_uid and conversation.member_two_id = p_peer_id)
      or (conversation.member_one_id = p_peer_id and conversation.member_two_id = current_uid)
    )
      and not exists (
        select 1
        from public.social_blocks block
        where (
          block.blocker_id = current_uid and block.blocked_id = p_peer_id
        ) or (
          block.blocker_id = p_peer_id and block.blocked_id = current_uid
        )
      )
  ) then
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

drop function if exists public.can_view_member_activity_topic_phase37(text);
