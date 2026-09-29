-- Persistent one-to-one message replies.
-- Reply targets stay inside the same conversation and the client may only set
-- the reply pointer during insert; all existing participant RLS remains authoritative.

begin;

alter table public.dm_messages
  add column if not exists reply_to_message_id bigint;

do $migration$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dm_messages_reply_to_message_id_fkey'
      and conrelid = 'public.dm_messages'::regclass
  ) then
    alter table public.dm_messages
      add constraint dm_messages_reply_to_message_id_fkey
      foreign key (reply_to_message_id)
      references public.dm_messages(id)
      on delete set null;
  end if;
end;
$migration$;

create index if not exists dm_messages_reply_to_message_idx
  on public.dm_messages(reply_to_message_id)
  where reply_to_message_id is not null;

grant select (reply_to_message_id)
  on table public.dm_messages to authenticated;
grant insert (reply_to_message_id)
  on table public.dm_messages to authenticated;

create or replace function private.validate_dm_message_reply_phase36()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.reply_to_message_id is null then
    return new;
  end if;

  if not exists (
    select 1
    from public.dm_messages target
    where target.id = new.reply_to_message_id
      and target.conversation_id = new.conversation_id
      and target.deleted_at is null
  ) then
    raise exception 'DM_REPLY_UNAVAILABLE' using errcode = '23503';
  end if;

  return new;
end;
$function$;

revoke all on function private.validate_dm_message_reply_phase36() from public, anon, authenticated;

drop trigger if exists validate_dm_message_reply_phase36 on public.dm_messages;
create trigger validate_dm_message_reply_phase36
before insert on public.dm_messages
for each row execute function private.validate_dm_message_reply_phase36();

commit;
