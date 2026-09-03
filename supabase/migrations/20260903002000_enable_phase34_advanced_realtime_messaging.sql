-- Phase 34: Advanced Real-Time Messaging
-- Private per-user database signals plus opt-in per-conversation typing/presence.

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
);

create policy dm_realtime_send_phase34
on realtime.messages
for insert
to authenticated
with check (
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
);

create or replace function private.broadcast_dm_message_phase34()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  conversation_row public.dm_conversations%rowtype;
  signal_payload jsonb;
begin
  select *
  into conversation_row
  from public.dm_conversations
  where id = new.conversation_id;

  if not found then
    return null;
  end if;

  signal_payload := jsonb_build_object(
    'conversation_id', new.conversation_id,
    'message_id', new.id,
    'operation', lower(tg_op)
  );

  perform realtime.send(
    signal_payload,
    'message_changed',
    'dm-user:' || conversation_row.member_one_id::text,
    true
  );

  perform realtime.send(
    signal_payload,
    'message_changed',
    'dm-user:' || conversation_row.member_two_id::text,
    true
  );

  return null;
end;
$$;

revoke all on function private.broadcast_dm_message_phase34() from public, anon, authenticated;

drop trigger if exists dm_messages_realtime_phase34 on public.dm_messages;
create trigger dm_messages_realtime_phase34
after insert or update on public.dm_messages
for each row
execute function private.broadcast_dm_message_phase34();

create or replace function private.broadcast_dm_state_phase34()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  conversation_row public.dm_conversations%rowtype;
  peer_id uuid;
begin
  select *
  into conversation_row
  from public.dm_conversations
  where id = new.conversation_id;

  if not found then
    return null;
  end if;

  perform realtime.send(
    jsonb_build_object('conversation_id', new.conversation_id),
    'conversation_state_changed',
    'dm-user:' || new.user_id::text,
    true
  );

  if old.last_read_at is distinct from new.last_read_at then
    peer_id := case
      when conversation_row.member_one_id = new.user_id then conversation_row.member_two_id
      else conversation_row.member_one_id
    end;

    perform realtime.send(
      jsonb_build_object('conversation_id', new.conversation_id),
      'read_state_changed',
      'dm-user:' || peer_id::text,
      true
    );
  end if;

  return null;
end;
$$;

revoke all on function private.broadcast_dm_state_phase34() from public, anon, authenticated;

drop trigger if exists dm_conversation_states_realtime_phase34 on public.dm_conversation_states;
create trigger dm_conversation_states_realtime_phase34
after update on public.dm_conversation_states
for each row
execute function private.broadcast_dm_state_phase34();
