-- Phase 20 follow-up: allow clean membership re-entry after leaving or a
-- declined approval request.

drop policy if exists social_circle_join_requests_delete_phase20
  on public.social_circle_join_requests;

create policy social_circle_join_requests_delete_phase20
on public.social_circle_join_requests
for delete
to authenticated
using (
  requester_id = (select auth.uid())
  or exists (
    select 1
    from public.social_circles circle
    where circle.id = social_circle_join_requests.circle_id
      and circle.owner_id = (select auth.uid())
  )
);

create or replace function private.cleanup_phase20_circle_request_after_leave()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $phase20_leave_cleanup$
begin
  if old.member_role <> 'owner' and old.member_id = auth.uid() then
    delete from public.social_circle_join_requests request
    where request.circle_id = old.circle_id
      and request.requester_id = old.member_id;
  end if;

  return old;
end;
$phase20_leave_cleanup$;

revoke all on function private.cleanup_phase20_circle_request_after_leave()
  from public, anon, authenticated;

drop trigger if exists cleanup_phase20_circle_request_after_leave
  on public.social_circle_members;

create trigger cleanup_phase20_circle_request_after_leave
after delete on public.social_circle_members
for each row
execute function private.cleanup_phase20_circle_request_after_leave();
