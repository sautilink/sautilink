-- Clear only the caller's own outbound messages for both participants.
-- The recipient's messages are never erased for them by another participant.
begin;
create or replace function public.dm_clear_my_sent_for_everyone_native_phase38(p_conversation_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  modified integer;
begin
  if (select auth.uid()) is null or p_conversation_id is null or not exists (
    select 1 from public.dm_conversations c
    where c.id = p_conversation_id
      and (c.member_one_id = (select auth.uid())
        or c.member_two_id = (select auth.uid()))
  ) then
    raise exception 'DM_ACCESS_DENIED' using errcode = '42501';
  end if;

  update public.dm_messages
  set deleted_at = clock_timestamp()
  where conversation_id = p_conversation_id
    and sender_id = (select auth.uid())
    and deleted_at is null;

  get diagnostics modified = row_count;
  return modified;
end;
$fn$;
revoke all on function public.dm_clear_my_sent_for_everyone_native_phase38(uuid)
  from public, anon;
grant execute on function public.dm_clear_my_sent_for_everyone_native_phase38(uuid)
  to authenticated;
commit;
