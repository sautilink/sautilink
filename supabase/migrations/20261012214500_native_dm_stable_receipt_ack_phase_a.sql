-- Phase A stability hotfix: prevent receipt ACKs and read updates from
-- generating repeated user realtime events when nothing new was received.
-- Keep authorization and RLS policies unchanged.
begin;

create or replace function public.dm_ack_delivery_native_phase_a(p_conversation_id uuid)
returns void language plpgsql security definer set search_path = ''
as $fn$
declare
  own_id uuid := (select auth.uid());
  latest_received timestamptz;
begin
  if own_id is null or not exists (
    select 1 from public.dm_conversations c
    where c.id = p_conversation_id
      and (c.member_one_id = own_id or c.member_two_id = own_id)
  ) then raise exception 'DM_ACCESS_DENIED' using errcode = '42501'; end if;

  select max(m.sent_at) into latest_received
  from public.dm_messages m
  where m.conversation_id = p_conversation_id
    and m.sender_id <> own_id
    and m.deleted_at is null;

  if latest_received is null then return; end if;

  update public.dm_conversation_states s
     set last_delivered_at = now()
   where s.conversation_id = p_conversation_id
     and s.user_id = own_id
     and coalesce(s.last_delivered_at, '-infinity'::timestamptz) < latest_received;
end;
$fn$;

-- Opening an already-read thread must not rewrite last_read_at on every
-- realtime/refresh event; only acknowledge messages actually sent by the peer.
create or replace function public.dm_mark_read_if_unread_phase_a(p_conversation_id uuid)
returns void language plpgsql security definer set search_path = ''
as $fn$
declare
  own_id uuid := (select auth.uid());
  latest_received timestamptz;
begin
  if own_id is null or not exists (
    select 1 from public.dm_conversations c
    where c.id = p_conversation_id
      and (c.member_one_id = own_id or c.member_two_id = own_id)
  ) then raise exception 'DM_ACCESS_DENIED' using errcode = '42501'; end if;

  select max(m.sent_at) into latest_received
  from public.dm_messages m
  where m.conversation_id = p_conversation_id
    and m.sender_id <> own_id
    and m.deleted_at is null;

  if latest_received is null then return; end if;

  update public.dm_conversation_states s
     set last_read_at = now(), hidden_at = null
   where s.conversation_id = p_conversation_id
     and s.user_id = own_id
     and coalesce(s.last_read_at, '-infinity'::timestamptz) < latest_received;
end;
$fn$;

revoke all on function public.dm_ack_delivery_native_phase_a(uuid) from public, anon;
revoke all on function public.dm_mark_read_if_unread_phase_a(uuid) from public, anon;
grant execute on function public.dm_ack_delivery_native_phase_a(uuid) to authenticated;
grant execute on function public.dm_mark_read_if_unread_phase_a(uuid) to authenticated;
commit;
