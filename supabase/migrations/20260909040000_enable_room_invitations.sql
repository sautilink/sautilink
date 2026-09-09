-- Room invitations: member/staff invites with recipient-controlled acceptance.

begin;

create table if not exists public.social_room_invitations (
  room_id uuid not null references public.social_circles(id) on delete cascade,
  invited_user_id uuid not null references public.social_profiles(id) on delete cascade,
  invited_by uuid not null references public.social_profiles(id) on delete cascade,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  primary key (room_id, invited_user_id),
  constraint social_room_invitations_no_self check (invited_user_id <> invited_by),
  constraint social_room_invitations_status_allowed check (
    status = any (array['pending'::text, 'accepted'::text, 'declined'::text])
  ),
  constraint social_room_invitations_decision_consistency check (
    (status = 'pending' and decided_at is null)
    or (status in ('accepted', 'declined') and decided_at is not null)
  )
);

create index if not exists social_room_invitations_recipient_created_idx
  on public.social_room_invitations (invited_user_id, created_at desc)
  where status = 'pending';

create index if not exists social_room_invitations_room_created_idx
  on public.social_room_invitations (room_id, created_at desc);

alter table public.social_room_invitations enable row level security;
alter table public.social_room_invitations force row level security;

revoke all on table public.social_room_invitations from public, anon, authenticated;
grant select, insert, delete on table public.social_room_invitations to authenticated;
grant update (status) on table public.social_room_invitations to authenticated;

create policy social_room_invitations_select_rooms
on public.social_room_invitations
for select
to authenticated
using (
  invited_user_id = (select auth.uid())
  or invited_by = (select auth.uid())
  or policy_private.is_room_staff(room_id)
);

create policy social_room_invitations_insert_rooms
on public.social_room_invitations
for insert
to authenticated
with check (
  invited_by = (select auth.uid())
  and invited_user_id <> (select auth.uid())
  and status = 'pending'
  and policy_private.is_room_member(room_id)
  and exists (
    select 1
    from public.social_circles room
    where room.id = social_room_invitations.room_id
      and (
        room.invite_permission = 'all_members'
        or policy_private.is_room_staff(room.id)
      )
  )
  and not policy_private.is_room_member(room_id, invited_user_id)
  and not exists (
    select 1
    from public.social_blocks block
    where
      (block.blocker_id = invited_by and block.blocked_id = invited_user_id)
      or (block.blocker_id = invited_user_id and block.blocked_id = invited_by)
  )
);

create policy social_room_invitations_update_recipient
on public.social_room_invitations
for update
to authenticated
using (
  invited_user_id = (select auth.uid())
  and status = 'pending'
)
with check (
  invited_user_id = (select auth.uid())
  and status in ('accepted', 'declined')
);

create policy social_room_invitations_delete_rooms
on public.social_room_invitations
for delete
to authenticated
using (
  status = 'pending'
  and (
    invited_user_id = (select auth.uid())
    or invited_by = (select auth.uid())
    or policy_private.is_room_staff(room_id)
  )
);

create or replace function private.normalize_room_invitation_decision()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $room_invite_decision$
begin
  if new.room_id <> old.room_id
    or new.invited_user_id <> old.invited_user_id
    or new.invited_by <> old.invited_by then
    raise exception 'ROOM_INVITATION_IDENTITY_IMMUTABLE' using errcode = '42501';
  end if;

  if old.status <> 'pending' then
    raise exception 'ROOM_INVITATION_ALREADY_DECIDED' using errcode = '22023';
  end if;

  if new.status not in ('accepted', 'declined') then
    raise exception 'ROOM_INVITATION_DECISION_INVALID' using errcode = '22023';
  end if;

  new.decided_at := now();
  return new;
end;
$room_invite_decision$;

revoke all on function private.normalize_room_invitation_decision() from public, anon, authenticated;
drop trigger if exists normalize_room_invitation_decision on public.social_room_invitations;
create trigger normalize_room_invitation_decision
before update of status on public.social_room_invitations
for each row
when (old.status is distinct from new.status)
execute function private.normalize_room_invitation_decision();

-- Invitation acceptance must be a valid self-membership path.
drop policy if exists social_circle_members_insert_rooms on public.social_circle_members;
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
    )
  )
);

create or replace function private.apply_room_invitation_acceptance()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $room_invite_accept$
begin
  if old.status = 'pending' and new.status = 'accepted' then
    insert into public.social_circle_members (circle_id, member_id, member_role)
    values (new.room_id, new.invited_user_id, 'member')
    on conflict (circle_id, member_id) do nothing;
  end if;
  return new;
end;
$room_invite_accept$;

revoke all on function private.apply_room_invitation_acceptance() from public, anon, authenticated;
drop trigger if exists apply_room_invitation_acceptance on public.social_room_invitations;
create trigger apply_room_invitation_acceptance
after update of status on public.social_room_invitations
for each row
when (old.status is distinct from new.status)
execute function private.apply_room_invitation_acceptance();

comment on table public.social_room_invitations is
  'Recipient-controlled invitations to SautiLink Rooms. Creation follows each Room invite_permission setting.';

commit;
