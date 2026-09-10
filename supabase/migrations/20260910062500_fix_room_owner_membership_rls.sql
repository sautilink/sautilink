-- Fix Room creation when the AFTER INSERT owner-membership trigger runs under browser RLS.
-- The outer social_circles INSERT remains protected by its authenticated owner_id policy.

begin;

create or replace function private.ensure_phase20_circle_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $room_owner_membership$
begin
  -- Browser-created Rooms must still belong to the authenticated actor.
  -- Service-role/database maintenance has no auth.uid() and remains supported.
  if auth.uid() is not null and new.owner_id <> auth.uid() then
    raise exception 'ROOM_OWNER_ACTOR_MISMATCH' using errcode = '42501';
  end if;

  insert into public.social_circle_members (circle_id, member_id, member_role)
  values (new.id, new.owner_id, 'owner')
  on conflict (circle_id, member_id) do update
    set member_role = 'owner';

  return new;
end;
$room_owner_membership$;

revoke all on function private.ensure_phase20_circle_owner_membership()
  from public, anon, authenticated;

comment on function private.ensure_phase20_circle_owner_membership() is
  'Trigger-only Room owner membership bootstrap. SECURITY DEFINER prevents the nested owner-membership insert from being rejected by membership RLS after the parent Room insert has already passed its owner RLS check.';

commit;
