alter table public.dm_messages
  add column if not exists message_kind text not null default 'text';

alter table public.dm_messages
  drop constraint if exists dm_messages_body_length;

alter table public.dm_messages
  drop constraint if exists dm_messages_kind_check;

alter table public.dm_messages
  add constraint dm_messages_kind_check
  check (message_kind in ('text', 'photo', 'file', 'voice'));

alter table public.dm_messages
  add constraint dm_messages_body_length
  check (
    char_length(btrim(body)) <= 4000
    and (
      (message_kind = 'text' and char_length(btrim(body)) >= 1)
      or (message_kind in ('photo', 'file', 'voice'))
    )
  );

create table if not exists public.dm_message_attachments (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.dm_conversations(id) on delete cascade,
  message_id bigint unique references public.dm_messages(id) on delete cascade,
  owner_id uuid not null references public.social_profiles(id) on delete cascade,
  media_kind text not null check (media_kind in ('photo', 'file', 'voice')),
  object_key text not null unique,
  content_type text not null,
  original_name text,
  size_bytes bigint not null check (size_bytes between 1 and 5242880),
  duration_ms integer check (duration_ms is null or duration_ms between 0 and 300000),
  width integer check (width is null or width between 1 and 8192),
  height integer check (height is null or height between 1 and 8192),
  upload_status text not null default 'pending' check (upload_status in ('pending', 'ready')),
  expires_at timestamptz default (now() + interval '1 hour'),
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  constraint dm_message_attachments_name_length check (original_name is null or char_length(original_name) <= 255),
  constraint dm_message_attachments_voice_duration check (
    (media_kind = 'voice' and duration_ms is not null and duration_ms <= 300000)
    or (media_kind <> 'voice' and duration_ms is null)
  ),
  constraint dm_message_attachments_photo_dimensions check (
    (media_kind = 'photo' and width is not null and height is not null)
    or (media_kind <> 'photo' and width is null and height is null)
  ),
  constraint dm_message_attachments_finalize_state check (
    (message_id is null and finalized_at is null)
    or (message_id is not null and finalized_at is not null and upload_status = 'ready')
  )
);

create index if not exists dm_message_attachments_conversation_idx
  on public.dm_message_attachments(conversation_id, created_at desc);
create index if not exists dm_message_attachments_owner_pending_idx
  on public.dm_message_attachments(owner_id, expires_at)
  where message_id is null;

alter table public.dm_message_attachments enable row level security;

revoke all on table public.dm_message_attachments from anon;
grant select, insert, update, delete on table public.dm_message_attachments to authenticated;

drop policy if exists dm_message_attachments_select_phase35 on public.dm_message_attachments;
create policy dm_message_attachments_select_phase35
on public.dm_message_attachments
for select
to authenticated
using (
  (
    owner_id = (select auth.uid())
    and message_id is null
    and finalized_at is null
  )
  or (
    upload_status = 'ready'
    and message_id is not null
    and finalized_at is not null
    and exists (
      select 1
      from public.dm_conversations conversation
      join public.dm_messages message
        on message.id = dm_message_attachments.message_id
       and message.conversation_id = conversation.id
      where conversation.id = dm_message_attachments.conversation_id
        and message.deleted_at is null
        and (
          conversation.member_one_id = (select auth.uid())
          or conversation.member_two_id = (select auth.uid())
        )
    )
  )
);

drop policy if exists dm_message_attachments_insert_phase35 on public.dm_message_attachments;
create policy dm_message_attachments_insert_phase35
on public.dm_message_attachments
for insert
to authenticated
with check (
  owner_id = (select auth.uid())
  and message_id is null
  and finalized_at is null
  and upload_status = 'pending'
  and expires_at is not null
  and expires_at > now()
  and object_key like (
    'dm/' || conversation_id::text || '/' || (select auth.uid())::text || '/%'
  )
  and exists (
    select 1
    from public.dm_conversations conversation
    where conversation.id = dm_message_attachments.conversation_id
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

drop policy if exists dm_message_attachments_update_pending_phase35 on public.dm_message_attachments;
create policy dm_message_attachments_update_pending_phase35
on public.dm_message_attachments
for update
to authenticated
using (
  owner_id = (select auth.uid())
  and message_id is null
  and finalized_at is null
)
with check (
  owner_id = (select auth.uid())
  and object_key like (
    'dm/' || conversation_id::text || '/' || (select auth.uid())::text || '/%'
  )
  and (
    (
      message_id is null
      and finalized_at is null
      and upload_status in ('pending', 'ready')
      and expires_at is not null
    )
    or (
      message_id is not null
      and finalized_at is not null
      and upload_status = 'ready'
      and expires_at is null
      and exists (
        select 1
        from public.dm_messages message
        where message.id = dm_message_attachments.message_id
          and message.conversation_id = dm_message_attachments.conversation_id
          and message.sender_id = (select auth.uid())
          and message.message_kind = dm_message_attachments.media_kind
          and message.deleted_at is null
      )
    )
  )
);

drop policy if exists dm_message_attachments_delete_pending_phase35 on public.dm_message_attachments;
create policy dm_message_attachments_delete_pending_phase35
on public.dm_message_attachments
for delete
to authenticated
using (
  owner_id = (select auth.uid())
  and message_id is null
  and finalized_at is null
);

create or replace function public.send_dm_media_message_phase35(
  p_conversation_id uuid,
  p_attachment_id uuid,
  p_body text default ''
)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  current_uid uuid := auth.uid();
  attachment_row public.dm_message_attachments%rowtype;
  normalized_body text := btrim(coalesce(p_body, ''));
  new_message_id bigint;
begin
  if current_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  if char_length(normalized_body) > 4000 then
    raise exception 'DM_BODY_TOO_LONG' using errcode = '22001';
  end if;

  select attachment.*
  into attachment_row
  from public.dm_message_attachments attachment
  where attachment.id = p_attachment_id
    and attachment.conversation_id = p_conversation_id
    and attachment.owner_id = current_uid
    and attachment.message_id is null
    and attachment.finalized_at is null
    and attachment.upload_status = 'ready'
    and attachment.expires_at is not null
    and attachment.expires_at > now()
  for update;

  if not found then
    raise exception 'DM_ATTACHMENT_UNAVAILABLE' using errcode = '42501';
  end if;

  insert into public.dm_messages (
    conversation_id,
    sender_id,
    body,
    message_kind
  )
  values (
    p_conversation_id,
    current_uid,
    normalized_body,
    attachment_row.media_kind
  )
  returning id into new_message_id;

  update public.dm_message_attachments
  set message_id = new_message_id,
      finalized_at = now(),
      expires_at = null
  where id = attachment_row.id;

  if not found then
    raise exception 'DM_ATTACHMENT_FINALIZE_FAILED' using errcode = '42501';
  end if;

  return new_message_id;
end;
$function$;

revoke all on function public.send_dm_media_message_phase35(uuid, uuid, text) from public;
revoke all on function public.send_dm_media_message_phase35(uuid, uuid, text) from anon;
grant execute on function public.send_dm_media_message_phase35(uuid, uuid, text) to authenticated;

create or replace function public.dm_inbox_phase23()
returns table(
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
stable
set search_path = ''
as $function$
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
      when latest.message_kind = 'photo' and btrim(latest.body) = '' then 'Photo'
      when latest.message_kind = 'voice' and btrim(latest.body) = '' then 'Voice message'
      when latest.message_kind = 'file' and btrim(latest.body) = '' then 'File'
      else latest.body
    end as latest_body,
    latest.sent_at as latest_sent_at,
    coalesce(unread.unread_count, 0)::bigint as unread_count
  from public.dm_conversations conversation
  left join public.dm_conversation_states state
    on state.conversation_id = conversation.id
   and state.user_id = auth.uid()
  left join lateral (
    select message.id, message.sender_id, message.body, message.message_kind, message.sent_at, message.deleted_at
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
$function$;
