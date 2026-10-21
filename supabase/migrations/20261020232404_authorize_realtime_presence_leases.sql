-- A minimal authorization snapshot for the private realtime Worker. Peer privacy
-- and peer-owned blocks cannot be evaluated with client SELECT permissions.
begin;

create or replace function private.dm_realtime_authorize_v1_privileged(p_conversation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_uid uuid := auth.uid();
  session_claim text := auth.jwt() ->> 'session_id';
  peer_id uuid;
  result jsonb;
begin
  if current_uid is null or session_claim is null
     or session_claim !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return jsonb_build_object('allowed', false, 'code', 'AUTH_REQUIRED');
  end if;
  if not exists (
    select 1 from auth.sessions session
    where session.id = session_claim::uuid and session.user_id = current_uid
      and (session.not_after is null or session.not_after > now())
  ) then
    return jsonb_build_object('allowed', false, 'code', 'AUTH_REQUIRED');
  end if;

  select case when conversation.member_one_id = current_uid
    then conversation.member_two_id else conversation.member_one_id end
  into peer_id from public.dm_conversations conversation
  where conversation.id = p_conversation_id
    and current_uid in (conversation.member_one_id, conversation.member_two_id);
  if not found or peer_id is null or peer_id = current_uid then
    return jsonb_build_object('allowed', false, 'code', 'CONVERSATION_UNAVAILABLE');
  end if;

  -- Only a real participant can receive these identifiers or invalidate a
  -- conversation's cached presence. No preference values/timestamps are exposed.
  result := jsonb_build_object('conversation_id', p_conversation_id,
    'user_id', current_uid, 'peer_id', peer_id);
  if exists (
    select 1 from public.social_blocks block
    where (block.blocker_id = current_uid and block.blocked_id = peer_id)
       or (block.blocker_id = peer_id and block.blocked_id = current_uid)
  ) then
    return result || jsonb_build_object('allowed', false, 'code', 'MESSAGING_BLOCKED');
  end if;
  if not exists (
    select 1 from public.social_member_preferences pref
    where pref.user_id = current_uid and pref.activity_status is true
  ) or not exists (
    select 1 from public.social_member_preferences pref
    where pref.user_id = peer_id and pref.activity_status is true
  ) then
    return result || jsonb_build_object('allowed', false, 'code', 'ACTIVITY_STATUS_DISABLED');
  end if;
  return result || jsonb_build_object('allowed', true, 'code', 'OK');
end;
$$;

revoke all on function private.dm_realtime_authorize_v1_privileged(uuid) from public, anon, authenticated;
grant execute on function private.dm_realtime_authorize_v1_privileged(uuid) to authenticated;

-- Keep the Data API entry point an invoker. Only the private, caller-bound
-- helper needs access to peer-owned preferences/blocks and Auth session rows.
create or replace function public.dm_realtime_authorize_v1(p_conversation_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.dm_realtime_authorize_v1_privileged(p_conversation_id);
$$;
revoke all on function public.dm_realtime_authorize_v1(uuid) from public, anon, authenticated;
grant execute on function public.dm_realtime_authorize_v1(uuid) to authenticated;
comment on function public.dm_realtime_authorize_v1(uuid) is
  'Minimal participant/session and reciprocal privacy authorization for bounded realtime presence leases; returns no message content or activity timestamps.';

commit;
