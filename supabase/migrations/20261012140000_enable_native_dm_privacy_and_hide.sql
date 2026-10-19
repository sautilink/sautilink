-- Native messages privacy and per-viewer hiding, additive to the existing DM system.
-- Do not deploy until staging migration and privacy regression tests pass.
begin;

create table if not exists public.dm_hidden_messages_native_phase38 (
  user_id uuid not null references auth.users(id) on delete cascade,
  message_id bigint not null references public.dm_messages(id) on delete cascade,
  conversation_id uuid not null references public.dm_conversations(id) on delete cascade,
  hidden_at timestamptz not null default now(),
  primary key (user_id, message_id)
);
create index if not exists dm_hidden_messages_native_conversation_idx
  on public.dm_hidden_messages_native_phase38(user_id, conversation_id);

alter table public.dm_hidden_messages_native_phase38 enable row level security;
revoke all on public.dm_hidden_messages_native_phase38 from public, anon;
grant select, insert on public.dm_hidden_messages_native_phase38 to authenticated;

drop policy if exists dm_hidden_messages_native_select on public.dm_hidden_messages_native_phase38;
create policy dm_hidden_messages_native_select
on public.dm_hidden_messages_native_phase38 for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists dm_hidden_messages_native_insert on public.dm_hidden_messages_native_phase38;
create policy dm_hidden_messages_native_insert
on public.dm_hidden_messages_native_phase38 for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.dm_messages message
    join public.dm_conversations conversation on conversation.id = message.conversation_id
    where message.id = message_id
      and conversation.id = dm_hidden_messages_native_phase38.conversation_id
      and (conversation.member_one_id = (select auth.uid())
           or conversation.member_two_id = (select auth.uid()))
  )
);

-- Atomic participant-only clear for the viewer. The other participant keeps their messages.
create or replace function public.dm_clear_chat_for_me_native_phase38(p_conversation_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  inserted_count integer;
begin
  if (select auth.uid()) is null or p_conversation_id is null or not exists (
    select 1 from public.dm_conversations conversation
    where conversation.id = p_conversation_id
      and (conversation.member_one_id = (select auth.uid())
        or conversation.member_two_id = (select auth.uid()))
  ) then
    raise exception 'DM_ACCESS_DENIED' using errcode = '42501';
  end if;

  insert into public.dm_hidden_messages_native_phase38(user_id, message_id, conversation_id)
  select (select auth.uid()), m.id, p_conversation_id
  from public.dm_messages m
  where m.conversation_id = p_conversation_id
  on conflict (user_id, message_id) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$fn$;

revoke all on function public.dm_clear_chat_for_me_native_phase38(uuid) from public, anon;
grant execute on function public.dm_clear_chat_for_me_native_phase38(uuid) to authenticated;

-- Only expose coarse activity buckets, never precise last-active timestamps.
-- Both viewer and target must opt in. Existing phase37 function also checks DM membership and blocks.
create or replace function public.dm_peer_activity_bucket_native_phase38(p_peer_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  last_active timestamptz;
begin
  if (select auth.uid()) is null or p_peer_id is null or p_peer_id = (select auth.uid()) then
    return 'hidden';
  end if;
  -- The hardened phase37 migration removed the old topic-access function.
  -- Reproduce the same reciprocal privacy, DM membership and block checks explicitly.
  if not exists (
    select 1 from public.social_member_preferences p
    where p.user_id = (select auth.uid()) and p.activity_status = true
  ) or not exists (
    select 1 from public.social_member_preferences p
    where p.user_id = p_peer_id and p.activity_status = true
  ) or not exists (
    select 1 from public.dm_conversations c
    where ((c.member_one_id = (select auth.uid()) and c.member_two_id = p_peer_id)
       or (c.member_two_id = (select auth.uid()) and c.member_one_id = p_peer_id))
      and not exists (
        select 1 from public.social_blocks b
        where (b.blocker_id = (select auth.uid()) and b.blocked_id = p_peer_id)
           or (b.blocker_id = p_peer_id and b.blocked_id = (select auth.uid()))
      )
  ) then
    return 'hidden';
  end if;
  select activity.last_active_at into last_active
  from private.member_activity_phase37 activity
  where activity.user_id = p_peer_id;
  if last_active is null or last_active < now() - interval '30 days' then
    return 'long_ago';
  elsif last_active >= now() - interval '3 days' then
    return 'recently';
  elsif last_active >= now() - interval '7 days' then
    return 'week';
  else
    return 'month';
  end if;
end;
$fn$;

revoke all on function public.dm_peer_activity_bucket_native_phase38(uuid)
from public, anon;
grant execute on function public.dm_peer_activity_bucket_native_phase38(uuid) to authenticated;
commit;
