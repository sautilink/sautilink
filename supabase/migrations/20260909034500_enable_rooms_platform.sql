-- Rooms platform: evolve the existing Circle/Sautify storage contract without destructive renames.
-- Internal social_circles identifiers remain stable for migration compatibility; the product brand is Rooms.

begin;

alter table public.social_circles
  add column if not exists category text not null default 'general',
  add column if not exists privacy text not null default 'public',
  add column if not exists cover_key text,
  add column if not exists post_permission text not null default 'all_members',
  add column if not exists invite_permission text not null default 'all_members';

update public.social_circles
set privacy = 'private'
where join_policy = 'private'
  and privacy = 'public';

alter table public.social_circles
  drop constraint if exists social_circles_category_allowed,
  add constraint social_circles_category_allowed check (
    category = any (array[
      'general'::text,
      'technology'::text,
      'learning'::text,
      'business'::text,
      'marketplace'::text,
      'creators'::text,
      'fashion'::text,
      'friends-community'::text,
      'gaming'::text,
      'sports'::text,
      'music'::text,
      'arts-culture'::text,
      'science'::text,
      'health-wellness'::text,
      'travel'::text,
      'local-community'::text,
      'family-parenting'::text,
      'food'::text,
      'hobbies'::text
    ])
  ),
  drop constraint if exists social_circles_privacy_allowed,
  add constraint social_circles_privacy_allowed check (
    privacy = any (array['public'::text, 'private'::text])
  ),
  drop constraint if exists social_circles_post_permission_allowed,
  add constraint social_circles_post_permission_allowed check (
    post_permission = any (array['all_members'::text, 'staff_only'::text])
  ),
  drop constraint if exists social_circles_invite_permission_allowed,
  add constraint social_circles_invite_permission_allowed check (
    invite_permission = any (array['all_members'::text, 'staff_only'::text])
  ),
  drop constraint if exists social_circles_cover_key_length,
  add constraint social_circles_cover_key_length check (
    cover_key is null or char_length(cover_key) between 1 and 512
  );

create index if not exists social_circles_category_created_idx
  on public.social_circles (category, created_at desc)
  where privacy = 'public';

alter table public.social_circle_members
  drop constraint if exists social_circle_members_role_allowed;

alter table public.social_circle_members
  add constraint social_circle_members_role_allowed check (
    member_role = any (array['member'::text, 'moderator'::text, 'admin'::text, 'owner'::text])
  );

create or replace function policy_private.room_member_role(p_circle_id uuid, p_member_id uuid default auth.uid())
returns text
language sql
security definer
set search_path = ''
stable
as $rooms_role$
  select membership.member_role
  from public.social_circle_members membership
  where membership.circle_id = p_circle_id
    and membership.member_id = p_member_id
  limit 1;
$rooms_role$;

create or replace function policy_private.is_room_member(p_circle_id uuid, p_member_id uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = ''
stable
as $rooms_member$
  select p_member_id is not null
    and exists (
      select 1
      from public.social_circle_members membership
      where membership.circle_id = p_circle_id
        and membership.member_id = p_member_id
    );
$rooms_member$;

create or replace function policy_private.is_room_staff(p_circle_id uuid, p_member_id uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = ''
stable
as $rooms_staff$
  select p_member_id is not null
    and exists (
      select 1
      from public.social_circle_members membership
      where membership.circle_id = p_circle_id
        and membership.member_id = p_member_id
        and membership.member_role in ('owner', 'admin', 'moderator')
    );
$rooms_staff$;

create or replace function policy_private.can_manage_room(p_circle_id uuid, p_member_id uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = ''
stable
as $rooms_manage$
  select p_member_id is not null
    and exists (
      select 1
      from public.social_circle_members membership
      where membership.circle_id = p_circle_id
        and membership.member_id = p_member_id
        and membership.member_role in ('owner', 'admin')
    );
$rooms_manage$;

revoke all on function policy_private.room_member_role(uuid, uuid) from public, anon, authenticated;
revoke all on function policy_private.is_room_member(uuid, uuid) from public, anon, authenticated;
revoke all on function policy_private.is_room_staff(uuid, uuid) from public, anon, authenticated;
revoke all on function policy_private.can_manage_room(uuid, uuid) from public, anon, authenticated;
grant execute on function policy_private.room_member_role(uuid, uuid) to authenticated;
grant execute on function policy_private.is_room_member(uuid, uuid) to authenticated;
grant execute on function policy_private.is_room_staff(uuid, uuid) to authenticated;
grant execute on function policy_private.can_manage_room(uuid, uuid) to authenticated;

-- Public Rooms can be discovered. Private Rooms are visible only to members/staff.
drop policy if exists social_circles_select_phase20 on public.social_circles;
drop policy if exists social_circles_select_rooms on public.social_circles;
create policy social_circles_select_rooms
on public.social_circles
for select
to authenticated
using (
  (
    privacy = 'public'
    or policy_private.is_room_member(id)
    or owner_id = (select auth.uid())
  )
  and not exists (
    select 1
    from public.social_blocks block
    where
      (block.blocker_id = owner_id and block.blocked_id = (select auth.uid()))
      or
      (block.blocker_id = (select auth.uid()) and block.blocked_id = owner_id)
  )
);

-- Owners and admins may edit Room metadata/settings. Ownership itself remains immutable in the browser.
drop policy if exists social_circles_update_phase20 on public.social_circles;
drop policy if exists social_circles_update_rooms on public.social_circles;
create policy social_circles_update_rooms
on public.social_circles
for update
to authenticated
using (policy_private.can_manage_room(id))
with check (policy_private.can_manage_room(id));

revoke update on table public.social_circles from authenticated;
grant update (slug, name, description, join_policy, category, privacy, cover_key, post_permission, invite_permission, updated_at)
  on table public.social_circles to authenticated;

-- Room members can see the membership roster. Staff controls are enforced by role-aware policies/triggers.
drop policy if exists social_circle_members_select_phase22 on public.social_circle_members;
drop policy if exists social_circle_members_select_rooms on public.social_circle_members;
create policy social_circle_members_select_rooms
on public.social_circle_members
for select
to authenticated
using (policy_private.is_room_member(circle_id));

-- Keep open self-join and owner bootstrap, and allow staff approval to add a member.
drop policy if exists social_circle_members_insert_phase20 on public.social_circle_members;
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
);

-- Role changes are performed only by Room managers; a trigger below narrows transitions further.
drop policy if exists social_circle_members_update_rooms on public.social_circle_members;
create policy social_circle_members_update_rooms
on public.social_circle_members
for update
to authenticated
using (policy_private.can_manage_room(circle_id))
with check (policy_private.can_manage_room(circle_id));

grant update (member_role) on table public.social_circle_members to authenticated;

drop policy if exists social_circle_members_delete_phase22 on public.social_circle_members;
drop policy if exists social_circle_members_delete_rooms on public.social_circle_members;
create policy social_circle_members_delete_rooms
on public.social_circle_members
for delete
to authenticated
using (
  member_role <> 'owner'
  and (
    member_id = (select auth.uid())
    or policy_private.is_room_staff(circle_id)
  )
);

create or replace function private.enforce_room_member_role_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $rooms_role_guard$
declare
  actor_role text;
begin
  if new.circle_id <> old.circle_id or new.member_id <> old.member_id then
    raise exception 'ROOM_MEMBERSHIP_IDENTITY_IMMUTABLE' using errcode = '42501';
  end if;

  if new.member_role = old.member_role then
    return new;
  end if;

  actor_role := policy_private.room_member_role(old.circle_id, auth.uid());

  if old.member_role = 'owner' or new.member_role = 'owner' then
    raise exception 'ROOM_OWNER_ROLE_IMMUTABLE' using errcode = '42501';
  end if;

  if actor_role = 'owner' then
    if new.member_role not in ('member', 'moderator', 'admin') then
      raise exception 'ROOM_ROLE_INVALID' using errcode = '42501';
    end if;
    return new;
  end if;

  if actor_role = 'admin' then
    if old.member_role = 'admin' or new.member_role = 'admin' then
      raise exception 'ROOM_ADMIN_CANNOT_MANAGE_ADMIN' using errcode = '42501';
    end if;
    if new.member_role not in ('member', 'moderator') then
      raise exception 'ROOM_ROLE_INVALID' using errcode = '42501';
    end if;
    return new;
  end if;

  raise exception 'ROOM_ROLE_CHANGE_FORBIDDEN' using errcode = '42501';
end;
$rooms_role_guard$;

revoke all on function private.enforce_room_member_role_change() from public, anon, authenticated;
drop trigger if exists enforce_room_member_role_change on public.social_circle_members;
create trigger enforce_room_member_role_change
before update of member_role on public.social_circle_members
for each row execute function private.enforce_room_member_role_change();

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

  actor_role := policy_private.room_member_role(old.circle_id, auth.uid());
  if actor_role = 'owner' then return old; end if;
  if actor_role = 'admin' and old.member_role in ('member', 'moderator') then return old; end if;
  if actor_role = 'moderator' and old.member_role = 'member' then return old; end if;

  raise exception 'ROOM_MEMBER_REMOVAL_FORBIDDEN' using errcode = '42501';
end;
$rooms_remove_guard$;

revoke all on function private.enforce_room_member_removal() from public, anon, authenticated;
drop trigger if exists enforce_room_member_removal on public.social_circle_members;
create trigger enforce_room_member_removal
before delete on public.social_circle_members
for each row execute function private.enforce_room_member_removal();

-- Owners, admins and moderators may review join requests.
drop policy if exists social_circle_join_requests_select_phase20 on public.social_circle_join_requests;
drop policy if exists social_circle_join_requests_select_rooms on public.social_circle_join_requests;
create policy social_circle_join_requests_select_rooms
on public.social_circle_join_requests
for select
to authenticated
using (
  requester_id = (select auth.uid())
  or policy_private.is_room_staff(circle_id)
);

drop policy if exists social_circle_join_requests_update_owner_phase20 on public.social_circle_join_requests;
drop policy if exists social_circle_join_requests_update_rooms on public.social_circle_join_requests;
create policy social_circle_join_requests_update_rooms
on public.social_circle_join_requests
for update
to authenticated
using (policy_private.is_room_staff(circle_id))
with check (
  status in ('approved', 'declined')
  and policy_private.is_room_staff(circle_id)
);

-- Room posting permission: members may post unless the Room is staff-only.
-- Preserve the current top-level/reply/quote rules by adding a defensive trigger instead of replacing newer post policies.
create or replace function private.enforce_room_post_permission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $rooms_post_guard$
declare
  permission text;
  actor_role text;
begin
  if new.circle_id is null or new.visibility <> 'circle' then
    return new;
  end if;

  select room.post_permission
    into permission
  from public.social_circles room
  where room.id = new.circle_id;

  actor_role := policy_private.room_member_role(new.circle_id, new.author_id);
  if actor_role is null then
    raise exception 'ROOM_MEMBERSHIP_REQUIRED' using errcode = '42501';
  end if;

  if permission = 'staff_only' and actor_role not in ('owner', 'admin', 'moderator') then
    raise exception 'ROOM_POSTING_RESTRICTED' using errcode = '42501';
  end if;

  return new;
end;
$rooms_post_guard$;

revoke all on function private.enforce_room_post_permission() from public, anon, authenticated;
drop trigger if exists enforce_room_post_permission on public.social_posts;
create trigger enforce_room_post_permission
before insert or update of circle_id, visibility, author_id on public.social_posts
for each row execute function private.enforce_room_post_permission();

-- Home includes Room posts only when the viewer can read the Room post through social_posts RLS.
-- security_invoker keeps the membership boundary authoritative.
create or replace view public.social_stream_events
with (security_invoker = true)
as
select
  'post'::text as event_type,
  post.id as post_id,
  post.author_id as actor_id,
  post.created_at as event_at,
  post.id::text as event_key
from public.social_posts post
where post.parent_post_id is null
  and (
    (post.circle_id is null and post.visibility in ('public', 'followers'))
    or (post.circle_id is not null and post.visibility = 'circle')
  );

revoke all on table public.social_stream_events from public, anon, authenticated;
grant select on table public.social_stream_events to anon, authenticated;

comment on table public.social_circles is
  'Canonical persistence for SautiLink Rooms. The historic social_circles table name is retained to avoid a destructive data migration.';
comment on column public.social_circles.category is
  'Room discovery category selected by Room managers.';
comment on column public.social_circles.privacy is
  'Room visibility boundary: public or private.';
comment on column public.social_circles.cover_key is
  'R2 object key for the Room cover image.';
comment on column public.social_circles.post_permission is
  'Who may publish Room posts: all_members or staff_only.';
comment on view public.social_stream_events is
  'Security-invoker Home stream. Visible top-level Room posts are included only for viewers authorized by social_posts RLS.';

commit;
