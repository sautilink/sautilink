-- Follow-up for the reproduced owner Room DELETE cascade failure. Apply only
-- after separate review/authorization; do not edit the already applied migrations.
begin;

create or replace function private.enforce_room_member_removal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $rooms_remove_guard$
declare
  actor_role text;
begin
  if auth.uid() is null or auth.uid() = old.member_id then
    return old;
  end if;

  -- A parent Room DELETE has already passed its own authority check. Its FK
  -- cascade can remove the owner membership before other rows. Check physical
  -- parent absence as the definer, not visibility through caller RLS, so hidden
  -- existing Rooms never bypass the ordinary role hierarchy below.
  if not exists (
    select 1 from public.social_circles room where room.id = old.circle_id
  ) then
    return old;
  end if;

  actor_role := policy_private.room_member_role(old.circle_id, auth.uid());
  if actor_role = 'owner' then return old; end if;
  if actor_role = 'admin' and old.member_role in ('member', 'moderator') then return old; end if;
  if actor_role = 'moderator' and old.member_role = 'member' then return old; end if;

  raise exception 'ROOM_MEMBER_REMOVAL_FORBIDDEN' using errcode = '42501';
end;
$rooms_remove_guard$;

revoke all on function private.enforce_room_member_removal() from public, anon, authenticated;

commit;
