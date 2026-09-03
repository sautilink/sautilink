-- Phase 23: Real Direct Messages MVP
--
-- Activates the existing one-to-one DM foundation with strict participant RLS,
-- canonical conversation opening, unread/inbox state, soft-delete semantics,
-- database-side send throttling, and live message reporting.

begin;

alter table public.dm_conversations enable row level security;
alter table public.dm_conversations force row level security;
alter table public.dm_messages enable row level security;
alter table public.dm_messages force row level security;
alter table public.dm_conversation_states enable row level security;
alter table public.dm_conversation_states force row level security;

revoke all on table public.dm_conversations from public, anon, authenticated;
revoke all on table public.dm_messages from public, anon, authenticated;
revoke all on table public.dm_conversation_states from public, anon, authenticated;

grant select, insert on table public.dm_conversations to authenticated;
grant select, insert on table public.dm_messages to authenticated;
grant update (deleted_at) on table public.dm_messages to authenticated;
grant select, insert on table public.dm_conversation_states to authenticated;
grant update (last_read_at, hidden_at) on table public.dm_conversation_states to authenticated;
grant usage, select on sequence public.dm_messages_id_seq to authenticated;

drop policy if exists dm_conversations_select_participant on public.dm_conversations;
drop policy if exists dm_conversations_select_participant_phase23 on public.dm_conversations;
create policy dm_conversations_select_participant_phase23
  on public.dm_conversations
  for select
  to authenticated
  using (
    (select auth.uid()) = member_one_id
    or (select auth.uid()) = member_two_id
  );

drop policy if exists dm_conversations_insert_participant on public.dm_conversations;
drop policy if exists dm_conversations_insert_participant_phase23 on public.dm_conversations;
create policy dm_conversations_insert_participant_phase23
  on public.dm_conversations
  for insert
  to authenticated
  with check (
    (select auth.uid()) = created_by
    and (
      (select auth.uid()) = member_one_id
      or (select auth.uid()) = member_two_id
    )
    and exists (
      select 1
      from public.social_profiles peer
      where peer.id = case
        when member_one_id = (select auth.uid()) then member_two_id
        else member_one_id
      end
        and peer.id <> (select auth.uid())
        and peer.is_discoverable = true
    )
    and not exists (
      select 1
      from public.social_blocks block
      where (block.blocker_id = member_one_id and block.blocked_id = member_two_id)
         or (block.blocker_id = member_two_id and block.blocked_id = member_one_id)
    )
  );

drop policy if exists dm_messages_select_participant on public.dm_messages;
drop policy if exists dm_messages_select_participant_phase23 on public.dm_messages;
create policy dm_messages_select_participant_phase23
  on public.dm_messages
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.dm_conversations conversation
      where conversation.id = dm_messages.conversation_id
        and (
          conversation.member_one_id = (select auth.uid())
          or conversation.member_two_id = (select auth.uid())
        )
    )
  );

drop policy if exists dm_messages_insert_participant on public.dm_messages;
drop policy if exists dm_messages_insert_participant_phase23 on public.dm_messages;
create policy dm_messages_insert_participant_phase23
  on public.dm_messages
  for insert
  to authenticated
  with check (
    (select auth.uid()) = sender_id
    and edited_at is null
    and deleted_at is null
    and exists (
      select 1
      from public.dm_conversations conversation
      where conversation.id = dm_messages.conversation_id
        and (
          conversation.member_one_id = (select auth.uid())
          or conversation.member_two_id = (select auth.uid())
        )
        and not exists (
          select 1
          from public.social_blocks block
          where (block.blocker_id = conversation.member_one_id and block.blocked_id = conversation.member_two_id)
             or (block.blocker_id = conversation.member_two_id and block.blocked_id = conversation.member_one_id)
        )
    )
  );

drop policy if exists dm_messages_update_own on public.dm_messages;
drop policy if exists dm_messages_soft_delete_own_phase23 on public.dm_messages;
create policy dm_messages_soft_delete_own_phase23
  on public.dm_messages
  for update
  to authenticated
  using (
    (select auth.uid()) = sender_id
    and deleted_at is null
  )
  with check (
    (select auth.uid()) = sender_id
    and deleted_at is not null
  );

drop policy if exists dm_conversation_states_select_own on public.dm_conversation_states;
drop policy if exists dm_conversation_states_select_own_phase23 on public.dm_conversation_states;
create policy dm_conversation_states_select_own_phase23
  on public.dm_conversation_states
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists dm_conversation_states_insert_own on public.dm_conversation_states;
drop policy if exists dm_conversation_states_insert_own_phase23 on public.dm_conversation_states;
create policy dm_conversation_states_insert_own_phase23
  on public.dm_conversation_states
  for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.dm_conversations conversation
      where conversation.id = dm_conversation_states.conversation_id
        and (
          conversation.member_one_id = (select auth.uid())
          or conversation.member_two_id = (select auth.uid())
        )
    )
  );

drop policy if exists dm_conversation_states_update_own on public.dm_conversation_states;
drop policy if exists dm_conversation_states_update_own_phase23 on public.dm_conversation_states;
create policy dm_conversation_states_update_own_phase23
  on public.dm_conversation_states
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists dm_conversation_states_delete_own on public.dm_conversation_states;

create or replace function public.open_dm_conversation_phase23(p_peer_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $phase23_open$
declare
  current_uid uuid := auth.uid();
  member_one uuid;
  member_two uuid;
  conversation_id uuid;
begin
  if current_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  if p_peer_id is null or p_peer_id = current_uid then
    raise exception 'DM_PEER_INVALID' using errcode = '22023';
  end if;

  if current_uid::text < p_peer_id::text then
    member_one := current_uid;
    member_two := p_peer_id;
  else
    member_one := p_peer_id;
    member_two := current_uid;
  end if;

  select conversation.id
    into conversation_id
  from public.dm_conversations conversation
  where conversation.member_one_id = member_one
    and conversation.member_two_id = member_two;

  if conversation_id is not null then
    return conversation_id;
  end if;

  if not exists (
    select 1
    from public.social_profiles peer
    where peer.id = p_peer_id
      and peer.is_discoverable = true
  ) then
    raise exception 'DM_PEER_UNAVAILABLE' using errcode = 'P0002';
  end if;

  insert into public.dm_conversations (
    member_one_id,
    member_two_id,
    created_by
  )
  values (
    member_one,
    member_two,
    current_uid
  )
  on conflict (member_one_id, member_two_id) do nothing
  returning id into conversation_id;

  if conversation_id is null then
    select conversation.id
      into conversation_id
    from public.dm_conversations conversation
    where conversation.member_one_id = member_one
      and conversation.member_two_id = member_two;
  end if;

  if conversation_id is null then
    raise exception 'DM_CONVERSATION_UNAVAILABLE' using errcode = '42501';
  end if;

  return conversation_id;
end;
$phase23_open$;

revoke all on function public.open_dm_conversation_phase23(uuid) from public, anon, authenticated;
grant execute on function public.open_dm_conversation_phase23(uuid) to authenticated;

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
  order by conversation.last_message_at desc, conversation.id;
$phase23_inbox$;

revoke all on function public.dm_inbox_phase23() from public, anon, authenticated;
grant execute on function public.dm_inbox_phase23() to authenticated;

create or replace function private.bootstrap_phase23_dm_states()
returns trigger
language plpgsql
security definer
set search_path = ''
as $phase23_state$
begin
  insert into public.dm_conversation_states (
    conversation_id,
    user_id,
    last_read_at,
    hidden_at
  )
  values
    (
      new.id,
      new.member_one_id,
      case when new.created_by = new.member_one_id then new.created_at else null end,
      null
    ),
    (
      new.id,
      new.member_two_id,
      case when new.created_by = new.member_two_id then new.created_at else null end,
      null
    )
  on conflict (conversation_id, user_id) do nothing;

  return new;
end;
$phase23_state$;

revoke all on function private.bootstrap_phase23_dm_states() from public, anon, authenticated;

drop trigger if exists phase23_bootstrap_dm_states on public.dm_conversations;
create trigger phase23_bootstrap_dm_states
after insert on public.dm_conversations
for each row execute function private.bootstrap_phase23_dm_states();

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
  new.edited_at := null;
  new.deleted_at := null;

  select count(*)::integer
    into recent_count
  from public.dm_messages message
  where message.sender_id = current_uid
    and message.sent_at >= now() - interval '1 minute';

  if recent_count >= 30 then
    raise exception 'DM_RATE_LIMITED' using errcode = 'P0001';
  end if;

  return new;
end;
$phase23_send$;

revoke all on function private.enforce_phase23_dm_message_insert() from public, anon, authenticated;

drop trigger if exists phase23_enforce_dm_message_insert on public.dm_messages;
create trigger phase23_enforce_dm_message_insert
before insert on public.dm_messages
for each row execute function private.enforce_phase23_dm_message_insert();

create or replace function private.touch_phase23_dm_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $phase23_touch$
begin
  update public.dm_conversations
  set last_message_at = greatest(last_message_at, new.sent_at)
  where id = new.conversation_id;

  update public.dm_conversation_states
  set hidden_at = null
  where conversation_id = new.conversation_id;

  return new;
end;
$phase23_touch$;

revoke all on function private.touch_phase23_dm_conversation() from public, anon, authenticated;

drop trigger if exists phase23_touch_dm_conversation on public.dm_messages;
create trigger phase23_touch_dm_conversation
after insert on public.dm_messages
for each row execute function private.touch_phase23_dm_conversation();

create or replace function private.normalize_phase23_dm_message_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $phase23_delete$
begin
  if old.deleted_at is not null then
    raise exception 'DM_MESSAGE_ALREADY_DELETED' using errcode = '22023';
  end if;

  new.deleted_at := now();
  new.body := 'Message deleted.';
  new.edited_at := null;

  return new;
end;
$phase23_delete$;

revoke all on function private.normalize_phase23_dm_message_delete() from public, anon, authenticated;

drop trigger if exists phase23_normalize_dm_message_delete on public.dm_messages;
create trigger phase23_normalize_dm_message_delete
before update of deleted_at on public.dm_messages
for each row execute function private.normalize_phase23_dm_message_delete();

create or replace function private.validate_social_report_insert()
returns trigger
language plpgsql
set search_path = ''
as $phase23_report$
declare
  current_uid uuid := auth.uid();
  target_owner uuid;
begin
  if current_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  new.reporter_id := current_uid;
  new.report_status := 'open';
  new.status_updated_at := now();
  new.reviewed_at := null;
  new.resolved_at := null;
  new.moderation_note := null;
  new.details := nullif(btrim(coalesce(new.details, '')), '');

  if new.target_type in ('profile', 'post', 'comment')
     and new.target_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'REPORT_TARGET_INVALID' using errcode = '22023';
  end if;

  if new.target_type = 'message'
     and new.target_id !~ '^[0-9]{1,19}$' then
    raise exception 'REPORT_TARGET_INVALID' using errcode = '22023';
  end if;

  case new.target_type
    when 'profile' then
      select profile.id
        into target_owner
      from public.social_profiles profile
      where profile.id = new.target_id::uuid;
    when 'post' then
      select post.author_id
        into target_owner
      from public.social_posts post
      where post.id = new.target_id::uuid;
    when 'comment' then
      select comment.author_id
        into target_owner
      from public.social_post_comments comment
      where comment.id = new.target_id::uuid;
    when 'message' then
      select message.sender_id
        into target_owner
      from public.dm_messages message
      join public.dm_conversations conversation
        on conversation.id = message.conversation_id
      where message.id = new.target_id::bigint
        and (
          conversation.member_one_id = current_uid
          or conversation.member_two_id = current_uid
        );
    else
      raise exception 'REPORT_TARGET_NOT_LIVE' using errcode = '0A000';
  end case;

  if not found then
    raise exception 'REPORT_TARGET_UNAVAILABLE' using errcode = 'P0002';
  end if;

  if target_owner = current_uid then
    raise exception 'SELF_REPORT_NOT_ALLOWED' using errcode = '22023';
  end if;

  return new;
end;
$phase23_report$;

revoke all on function private.validate_social_report_insert() from public, anon, authenticated;

create index if not exists dm_messages_sender_sent_idx
  on public.dm_messages (sender_id, sent_at desc);

comment on function public.open_dm_conversation_phase23(uuid) is
  'Phase 23 authenticated invoker RPC that reuses or creates one canonical one-to-one DM conversation.';
comment on function public.dm_inbox_phase23() is
  'Phase 23 authenticated invoker inbox read model with per-user unread counts and hidden conversation state.';

commit;
