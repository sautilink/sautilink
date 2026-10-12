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
  if not public.can_view_member_activity_topic_phase37('member-activity:' || p_peer_id::text) then
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
