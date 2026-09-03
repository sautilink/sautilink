-- Phase 23 hardening: keep DM identity/timestamps server-owned.

revoke insert on table public.dm_conversations from authenticated;
grant insert (member_one_id, member_two_id, created_by)
  on table public.dm_conversations to authenticated;

revoke insert on table public.dm_messages from authenticated;
grant insert (conversation_id, sender_id, body)
  on table public.dm_messages to authenticated;

create or replace function private.enforce_phase23_dm_message_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $phase23_send$
declare
  current_uid uuid := auth.uid();
  conversation_row public.dm_conversations%rowtype;
  recent_count integer;
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

  new.body := btrim(new.body);
  new.sent_at := clock_timestamp();
  new.edited_at := null;
  new.deleted_at := null;

  select count(*)::integer
    into recent_count
  from public.dm_messages message
  where message.sender_id = current_uid
    and message.sent_at >= clock_timestamp() - interval '1 minute';

  if recent_count >= 30 then
    raise exception 'DM_RATE_LIMITED' using errcode = 'P0001';
  end if;

  return new;
end;
$phase23_send$;

revoke all on function private.enforce_phase23_dm_message_insert() from public, anon, authenticated;
