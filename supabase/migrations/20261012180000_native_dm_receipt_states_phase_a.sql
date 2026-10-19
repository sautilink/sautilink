-- Phase A: real message delivery/read receipts with recipient privacy respected.
begin;
alter table public.dm_conversation_states
  add column if not exists last_delivered_at timestamptz;

-- Receipts are not directly readable across accounts (existing own-row RLS).
create or replace function public.dm_peer_receipts_native_phase_a(p_conversation_id uuid)
returns table(last_delivered_at timestamptz, last_read_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $fn$
declare
  own_id uuid := (select auth.uid());
  other_id uuid;
  share_read boolean := true;
begin
  if own_id is null then return; end if;
  select case when c.member_one_id = own_id then c.member_two_id
              else c.member_one_id end
    into other_id
  from public.dm_conversations c
  where c.id = p_conversation_id
    and (c.member_one_id = own_id or c.member_two_id = own_id);
  if other_id is null then return; end if;
  if exists (
    select 1 from public.social_blocks b
    where (b.blocker_id = own_id and b.blocked_id = other_id)
       or (b.blocker_id = other_id and b.blocked_id = own_id)
  ) then return; end if;
  -- WhatsApp-like reciprocal read receipts: users opting out do not receive them.
  select coalesce((select p.read_receipts from public.social_member_preferences p
    where p.user_id = own_id), true)
    and coalesce((select p.read_receipts from public.social_member_preferences p
    where p.user_id = other_id), true) into share_read;
  return query
  select s.last_delivered_at, case when share_read then s.last_read_at else null end
  from public.dm_conversation_states s
  where s.conversation_id = p_conversation_id and s.user_id = other_id
  limit 1;
end;
$fn$;

create or replace function public.dm_ack_delivery_native_phase_a(p_conversation_id uuid)
returns void language plpgsql security definer set search_path = ''
as $fn$
declare own_id uuid := (select auth.uid());
begin
  if own_id is null or not exists (
    select 1 from public.dm_conversations c where c.id = p_conversation_id
    and (c.member_one_id = own_id or c.member_two_id = own_id)
  ) then raise exception 'DM_ACCESS_DENIED' using errcode='42501'; end if;
  update public.dm_conversation_states s
     set last_delivered_at = greatest(coalesce(s.last_delivered_at,
         '-infinity'::timestamptz), now())
    where s.conversation_id = p_conversation_id and s.user_id = own_id;
end;
$fn$;
revoke all on function public.dm_peer_receipts_native_phase_a(uuid) from public, anon;
revoke all on function public.dm_ack_delivery_native_phase_a(uuid) from public, anon;
grant execute on function public.dm_peer_receipts_native_phase_a(uuid) to authenticated;
grant execute on function public.dm_ack_delivery_native_phase_a(uuid) to authenticated;
commit;
