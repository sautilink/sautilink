-- An accepted invitation authorizes one continuous Room membership. Leaving or
-- staff removal must require a fresh invitation/approval for restricted Rooms.
-- Preserve the accepted decision and its original audit timestamps.
begin;

alter table public.social_room_invitations
  add column membership_ended_at timestamptz;

comment on column public.social_room_invitations.membership_ended_at is
  'Server-written end of the membership admitted by this accepted invitation. The accepted decision remains historical and cannot authorize restricted Room re-entry.';

-- No UPDATE grant is added for the marker. Existing clients retain status-only
-- decisions; the INSERT policy below prevents forging a pre-ended invitation.
create or replace function private.expire_room_invitation_after_member_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $room_admission_end$
begin
  if old.member_role <> 'owner' then
    update public.social_room_invitations invitation
    set membership_ended_at = clock_timestamp()
    where invitation.room_id = old.circle_id
      and invitation.invited_user_id = old.member_id
      and invitation.status = 'accepted'
      and invitation.membership_ended_at is null;
  end if;
  return old;
end;
$room_admission_end$;

revoke all on function private.expire_room_invitation_after_member_delete()
  from public, anon, authenticated;

create trigger expire_room_invitation_after_member_delete
after delete on public.social_circle_members
for each row execute function private.expire_room_invitation_after_member_delete();

-- Existing accepted rows with no current membership are already historical.
-- Acceptance inserts membership in the same transaction, so this does not
-- consume a valid "accepted but not yet joined" client hand-off.
update public.social_room_invitations invitation
set membership_ended_at = clock_timestamp()
where invitation.status = 'accepted'
  and invitation.membership_ended_at is null
  and not exists (
    select 1
    from public.social_circle_members membership
    where membership.circle_id = invitation.room_id
      and membership.member_id = invitation.invited_user_id
  );

drop policy social_circle_members_insert_rooms on public.social_circle_members;
create policy social_circle_members_insert_rooms
on public.social_circle_members
for insert
to authenticated
with check (
  (
    member_id = (select auth.uid())
    and member_role = 'owner'
    and exists (
      select 1 from public.social_circles room
      where room.id = circle_id and room.owner_id = (select auth.uid())
    )
  )
  or (
    member_id = (select auth.uid())
    and member_role = 'member'
    and exists (
      select 1 from public.social_circles room
      where room.id = circle_id
        and room.join_policy = 'open'
        and room.owner_id <> (select auth.uid())
    )
  )
  or (
    member_role = 'member'
    and policy_private.is_room_staff(circle_id)
    and exists (
      select 1
      from public.social_circle_join_requests request
      where request.circle_id = social_circle_members.circle_id
        and request.requester_id = social_circle_members.member_id
        and request.status = 'approved'
    )
  )
  or (
    member_id = (select auth.uid())
    and member_role = 'member'
    and exists (
      select 1
      from public.social_room_invitations invitation
      where invitation.room_id = social_circle_members.circle_id
        and invitation.invited_user_id = (select auth.uid())
        and invitation.status = 'accepted'
        and invitation.membership_ended_at is null
    )
  )
);

-- The managed membership RPC is SECURITY DEFINER and therefore also needs an
-- INSERT-time check independent of caller RLS. Do not change its question
-- proofs, transaction binding, staff approval or existing lost-ACK receipts.
create or replace function private.enforce_room_invitation_freshness()
returns trigger
language plpgsql
security definer
set search_path = ''
as $room_admission_freshness$
declare
  invitation_ended_at timestamptz;
begin
  if new.member_role = 'member' and new.member_id = auth.uid()
     and exists (
       select 1 from public.social_circles room
       where room.id = new.circle_id and room.join_policy in ('private', 'approval')
     ) then
    -- A duplicate INSERT can wait behind a concurrent DELETE before uniqueness
    -- is resolved. Lock the existing membership first, then read/lock the
    -- invitation, so a successful removal cannot leave a stale pre-wait check.
    perform 1 from public.social_circle_members membership
    where membership.circle_id = new.circle_id and membership.member_id = new.member_id
    for key share;

    select invitation.membership_ended_at into invitation_ended_at
    from public.social_room_invitations invitation
    where invitation.room_id = new.circle_id
      and invitation.invited_user_id = new.member_id
      and invitation.status = 'accepted'
    for update;
    -- Require the locked row to still exist as well. A concurrent authorized
    -- deletion of an expired receipt cannot revive the outer statement's older
    -- RLS snapshot. Staff approval inserts another actor's membership and is
    -- governed by the existing approval proof and role hierarchy instead.
    if not found or invitation_ended_at is not null then
      raise exception 'ROOM_JOIN_INVITATION_REQUIRED' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$room_admission_freshness$;

revoke all on function private.enforce_room_invitation_freshness()
  from public, anon, authenticated;

create trigger enforce_room_invitation_freshness
before insert on public.social_circle_members
for each row execute function private.enforce_room_invitation_freshness();

drop policy social_room_invitations_insert_rooms on public.social_room_invitations;
create policy social_room_invitations_insert_rooms
on public.social_room_invitations
for insert
to authenticated
with check (
  invited_by = (select auth.uid())
  and invited_user_id <> (select auth.uid())
  and status = 'pending'
  and membership_ended_at is null
  and policy_private.is_room_member(room_id)
  and exists (
    select 1
    from public.social_circles room
    where room.id = social_room_invitations.room_id
      and (room.invite_permission = 'all_members' or policy_private.is_room_staff(room.id))
  )
  and not policy_private.is_room_member(room_id, invited_user_id)
  and not exists (
    select 1
    from public.social_blocks block
    where (block.blocker_id = invited_by and block.blocked_id = invited_user_id)
       or (block.blocker_id = invited_user_id and block.blocked_id = invited_by)
  )
);

-- The same actors who may clear declined/pending invitations may clear a
-- historical accepted invitation, allowing an ordinary fresh pending re-invite.
-- An accepted invitation attached to an active membership remains protected,
-- including a historical receipt retained across a later staff-approved join.
drop policy social_room_invitations_delete_rooms on public.social_room_invitations;
create policy social_room_invitations_delete_rooms
on public.social_room_invitations
for delete
to authenticated
using (
  (
    status <> 'accepted'
    or (
      membership_ended_at is not null
      and not policy_private.is_room_member(room_id, invited_user_id)
    )
  )
  and (
    invited_user_id = (select auth.uid())
    or invited_by = (select auth.uid())
    or policy_private.is_room_staff(room_id)
  )
);

commit;

