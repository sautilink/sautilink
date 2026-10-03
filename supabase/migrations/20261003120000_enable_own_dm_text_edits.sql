-- Permit text edits by the author while keeping edit timestamps server-owned.
begin;

grant update (body) on table public.dm_messages to authenticated;

create policy dm_messages_edit_own_text
  on public.dm_messages
  for update
  to authenticated
  using (
    (select auth.uid()) = sender_id
    and deleted_at is null
    and message_kind = 'text'
  )
  with check (
    (select auth.uid()) = sender_id
    and deleted_at is null
    and message_kind = 'text'
  );

create function private.stamp_dm_message_edit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $dm_edit$
begin
  if (select auth.uid()) is distinct from old.sender_id
     or old.deleted_at is not null
     or old.message_kind <> 'text' then
    raise exception 'DM_EDIT_UNAVAILABLE' using errcode = '42501';
  end if;

  new.body := btrim(new.body);
  new.edited_at := clock_timestamp();
  return new;
end;
$dm_edit$;

revoke all on function private.stamp_dm_message_edit() from public, anon, authenticated;

create trigger dm_messages_stamp_own_text_edit
  before update of body on public.dm_messages
  for each row execute function private.stamp_dm_message_edit();

commit;
