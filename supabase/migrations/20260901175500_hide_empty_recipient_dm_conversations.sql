create or replace function public.dm_inbox_phase23()
returns table (
  conversation_id uuid,
  peer_id uuid,
  last_message_at timestamptz,
  latest_message_id bigint,
  latest_sender_id uuid,
  latest_body text,
  latest_sent_at timestamptz,
  unread_count bigint
)
language sql
security invoker
set search_path = ''
stable
as $phase23_inbox$
  select
    conversation.id as conversation_id,
    case
      when conversation.member_one_id = auth.uid() then conversation.member_two_id
      else conversation.member_one_id
    end as peer_id,
    conversation.last_message_at,
    latest.id as latest_message_id,
    latest.sender_id as latest_sender_id,
    case
      when latest.deleted_at is not null then 'Message deleted.'
      else latest.body
    end as latest_body,
    latest.sent_at as latest_sent_at,
    coalesce(unread.unread_count, 0)::bigint as unread_count
  from public.dm_conversations conversation
  left join public.dm_conversation_states state
    on state.conversation_id = conversation.id
   and state.user_id = auth.uid()
  left join lateral (
    select message.id, message.sender_id, message.body, message.sent_at, message.deleted_at
    from public.dm_messages message
    where message.conversation_id = conversation.id
    order by message.sent_at desc, message.id desc
    limit 1
  ) latest on true
  left join lateral (
    select count(*)::bigint as unread_count
    from public.dm_messages message
    where message.conversation_id = conversation.id
      and message.sender_id <> auth.uid()
      and message.deleted_at is null
      and message.sent_at > coalesce(state.last_read_at, '-infinity'::timestamptz)
  ) unread on true
  where (
    conversation.member_one_id = auth.uid()
    or conversation.member_two_id = auth.uid()
  )
    and state.hidden_at is null
    and (latest.id is not null or conversation.created_by = auth.uid())
  order by conversation.last_message_at desc, conversation.id;
$phase23_inbox$;

revoke all on function public.dm_inbox_phase23() from public, anon, authenticated;
grant execute on function public.dm_inbox_phase23() to authenticated;
