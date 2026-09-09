-- A declined invitation can be cleared by the original inviter or Room staff,
-- allowing a future invitation without weakening accepted memberships.

begin;

drop policy if exists social_room_invitations_delete_rooms on public.social_room_invitations;
create policy social_room_invitations_delete_rooms
on public.social_room_invitations
for delete
to authenticated
using (
  status <> 'accepted'
  and (
    invited_user_id = (select auth.uid())
    or invited_by = (select auth.uid())
    or policy_private.is_room_staff(room_id)
  )
);

commit;
