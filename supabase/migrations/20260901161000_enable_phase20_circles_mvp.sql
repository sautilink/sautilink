-- Phase 20: Circles MVP
--
-- Activates the existing Circle foundation with open, approval and private
-- membership rules. Browser access remains least-privilege and RLS-enforced.

alter table public.social_circles
  drop constraint if exists social_circles_join_policy_allowed;

alter table public.social_circles
  add constraint social_circles_join_policy_allowed
  check (join_policy = any (array['open', 'approval', 'private']::text[]));

create table public.social_circle_join_requests (
  circle_id uuid not null references public.social_circles(id) on delete cascade,
  requester_id uuid not null references public.social_profiles(id) on delete cascade,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  primary key (circle_id, requester_id),
  constraint social_circle_join_requests_status_allowed
    check (status = any (array['pending', 'approved', 'declined']::text[])),
  constraint social_circle_join_requests_decision_consistency
    check (
      (status = 'pending' and decided_at is null)
      or (status in ('approved', 'declined') and decided_at is not null)
    )
);

create index social_circle_join_requests_requester_created_idx
  on public.social_circle_join_requests (requester_id, created_at desc);

create index social_circle_join_requests_pending_circle_idx
  on public.social_circle_join_requests (circle_id, created_at)
  where status = 'pending';

alter table public.social_circles enable row level security;
alter table public.social_circles force row level security;
alter table public.social_circle_members enable row level security;
alter table public.social_circle_members force row level security;
alter table public.social_circle_join_requests enable row level security;
alter table public.social_circle_join_requests force row level security;

revoke all on table public.social_circles from public, anon, authenticated;
revoke all on table public.social_circle_members from public, anon, authenticated;
revoke all on table public.social_circle_join_requests from public, anon, authenticated;

grant select, insert, delete on table public.social_circles to authenticated;
grant update (name, description, join_policy) on table public.social_circles to authenticated;
grant select, insert, delete on table public.social_circle_members to authenticated;
grant select, insert, delete on table public.social_circle_join_requests to authenticated;
grant update (status) on table public.social_circle_join_requests to authenticated;

drop policy if exists social_circles_select_public on public.social_circles;
drop policy if exists social_circles_insert_owned on public.social_circles;
drop policy if exists social_circles_update_owned on public.social_circles;
drop policy if exists social_circles_delete_owned on public.social_circles;

create policy social_circles_select_phase20
on public.social_circles
for select
to authenticated
using (
  (select auth.uid()) = owner_id
  or (
    exists (
      select 1
      from public.social_circle_members membership
      where membership.circle_id = social_circles.id
        and membership.member_id = (select auth.uid())
    )
    and not exists (
      select 1
      from public.social_blocks block
      where
        (block.blocker_id = owner_id and block.blocked_id = (select auth.uid()))
        or
        (block.blocker_id = (select auth.uid()) and block.blocked_id = owner_id)
    )
  )
  or (
    join_policy in ('open', 'approval')
    and not exists (
      select 1
      from public.social_blocks block
      where
        (block.blocker_id = owner_id and block.blocked_id = (select auth.uid()))
        or
        (block.blocker_id = (select auth.uid()) and block.blocked_id = owner_id)
    )
  )
);

create policy social_circles_insert_phase20
on public.social_circles
for insert
to authenticated
with check ((select auth.uid()) = owner_id);

create policy social_circles_update_phase20
on public.social_circles
for update
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy social_circles_delete_phase20
on public.social_circles
for delete
to authenticated
using ((select auth.uid()) = owner_id);

drop policy if exists social_circle_members_select_authenticated on public.social_circle_members;
drop policy if exists social_circle_members_insert_allowed on public.social_circle_members;
drop policy if exists social_circle_members_update_by_owner on public.social_circle_members;
drop policy if exists social_circle_members_delete_self_or_owner on public.social_circle_members;

create policy social_circle_members_select_self_phase20
on public.social_circle_members
for select
to authenticated
using ((select auth.uid()) = member_id);

create policy social_circle_members_insert_phase20
on public.social_circle_members
for insert
to authenticated
with check (
  (
    member_id = (select auth.uid())
    and member_role = 'owner'
    and exists (
      select 1
      from public.social_circles circle
      where circle.id = social_circle_members.circle_id
        and circle.owner_id = (select auth.uid())
    )
  )
  or (
    member_id = (select auth.uid())
    and member_role = 'member'
    and exists (
      select 1
      from public.social_circles circle
      where circle.id = social_circle_members.circle_id
        and circle.join_policy = 'open'
        and circle.owner_id <> (select auth.uid())
        and not exists (
          select 1
          from public.social_blocks block
          where
            (block.blocker_id = circle.owner_id and block.blocked_id = (select auth.uid()))
            or
            (block.blocker_id = (select auth.uid()) and block.blocked_id = circle.owner_id)
        )
    )
  )
  or (
    member_role = 'member'
    and exists (
      select 1
      from public.social_circles circle
      join public.social_circle_join_requests request
        on request.circle_id = circle.id
       and request.requester_id = social_circle_members.member_id
       and request.status = 'approved'
      where circle.id = social_circle_members.circle_id
        and circle.owner_id = (select auth.uid())
    )
  )
);

create policy social_circle_members_delete_self_phase20
on public.social_circle_members
for delete
to authenticated
using (
  (select auth.uid()) = member_id
  and member_role <> 'owner'
);

create policy social_circle_join_requests_select_phase20
on public.social_circle_join_requests
for select
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

create policy social_circle_join_requests_insert_phase20
on public.social_circle_join_requests
for insert
to authenticated
with check (
  requester_id = (select auth.uid())
  and status = 'pending'
  and exists (
    select 1
    from public.social_circles circle
    where circle.id = social_circle_join_requests.circle_id
      and circle.join_policy = 'approval'
      and circle.owner_id <> (select auth.uid())
      and not exists (
        select 1
        from public.social_blocks block
        where
          (block.blocker_id = circle.owner_id and block.blocked_id = (select auth.uid()))
          or
          (block.blocker_id = (select auth.uid()) and block.blocked_id = circle.owner_id)
      )
  )
);

create policy social_circle_join_requests_update_owner_phase20
on public.social_circle_join_requests
for update
to authenticated
using (
  exists (
    select 1
    from public.social_circles circle
    where circle.id = social_circle_join_requests.circle_id
      and circle.owner_id = (select auth.uid())
  )
)
with check (
  status in ('approved', 'declined')
  and exists (
    select 1
    from public.social_circles circle
    where circle.id = social_circle_join_requests.circle_id
      and circle.owner_id = (select auth.uid())
  )
);

create policy social_circle_join_requests_delete_phase20
on public.social_circle_join_requests
for delete
to authenticated
using (
  (requester_id = (select auth.uid()) and status = 'pending')
  or exists (
    select 1
    from public.social_circles circle
    where circle.id = social_circle_join_requests.circle_id
      and circle.owner_id = (select auth.uid())
  )
);

create or replace function private.ensure_phase20_circle_owner_membership()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $phase20_owner$
begin
  insert into public.social_circle_members (circle_id, member_id, member_role)
  values (new.id, new.owner_id, 'owner')
  on conflict (circle_id, member_id) do update
    set member_role = 'owner';

  return new;
end;
$phase20_owner$;

revoke all on function private.ensure_phase20_circle_owner_membership()
  from public, anon, authenticated;

drop trigger if exists ensure_phase20_circle_owner_membership on public.social_circles;
create trigger ensure_phase20_circle_owner_membership
after insert on public.social_circles
for each row
execute function private.ensure_phase20_circle_owner_membership();

create or replace function private.normalize_phase20_circle_join_request()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $phase20_request$
begin
  if old.status <> 'pending' then
    raise exception 'CIRCLE_REQUEST_ALREADY_DECIDED' using errcode = '22023';
  end if;

  if new.status not in ('approved', 'declined') then
    raise exception 'CIRCLE_REQUEST_DECISION_INVALID' using errcode = '22023';
  end if;

  new.decided_at := now();
  return new;
end;
$phase20_request$;

revoke all on function private.normalize_phase20_circle_join_request()
  from public, anon, authenticated;

drop trigger if exists normalize_phase20_circle_join_request on public.social_circle_join_requests;
create trigger normalize_phase20_circle_join_request
before update of status on public.social_circle_join_requests
for each row
when (old.status is distinct from new.status)
execute function private.normalize_phase20_circle_join_request();

create or replace function private.apply_phase20_circle_join_approval()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $phase20_approval$
begin
  if old.status = 'pending' and new.status = 'approved' then
    insert into public.social_circle_members (circle_id, member_id, member_role)
    values (new.circle_id, new.requester_id, 'member')
    on conflict (circle_id, member_id) do nothing;
  end if;

  return new;
end;
$phase20_approval$;

revoke all on function private.apply_phase20_circle_join_approval()
  from public, anon, authenticated;

drop trigger if exists apply_phase20_circle_join_approval on public.social_circle_join_requests;
create trigger apply_phase20_circle_join_approval
after update of status on public.social_circle_join_requests
for each row
when (old.status is distinct from new.status)
execute function private.apply_phase20_circle_join_approval();

create or replace function private.enforce_social_block_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $phase20_block$
begin
  if auth.uid() is not null and new.blocker_id <> auth.uid() then
    raise exception 'BLOCK_ACTOR_MISMATCH' using errcode = '42501';
  end if;

  delete from public.social_follows follow_row
  where
    (follow_row.follower_id = new.blocker_id and follow_row.followed_id = new.blocked_id)
    or
    (follow_row.follower_id = new.blocked_id and follow_row.followed_id = new.blocker_id);

  delete from public.social_circle_join_requests request
  using public.social_circles circle
  where request.circle_id = circle.id
    and (
      (circle.owner_id = new.blocker_id and request.requester_id = new.blocked_id)
      or
      (circle.owner_id = new.blocked_id and request.requester_id = new.blocker_id)
    );

  delete from public.social_circle_members membership
  using public.social_circles circle
  where membership.circle_id = circle.id
    and membership.member_role <> 'owner'
    and (
      (circle.owner_id = new.blocker_id and membership.member_id = new.blocked_id)
      or
      (circle.owner_id = new.blocked_id and membership.member_id = new.blocker_id)
    );

  return new;
end;
$phase20_block$;

revoke all on function private.enforce_social_block_insert()
  from public, anon, authenticated;

delete from public.social_circle_join_requests request
using public.social_circles circle, public.social_blocks block
where request.circle_id = circle.id
  and (
    (circle.owner_id = block.blocker_id and request.requester_id = block.blocked_id)
    or
    (circle.owner_id = block.blocked_id and request.requester_id = block.blocker_id)
  );

delete from public.social_circle_members membership
using public.social_circles circle, public.social_blocks block
where membership.circle_id = circle.id
  and membership.member_role <> 'owner'
  and (
    (circle.owner_id = block.blocker_id and membership.member_id = block.blocked_id)
    or
    (circle.owner_id = block.blocked_id and membership.member_id = block.blocker_id)
  );
