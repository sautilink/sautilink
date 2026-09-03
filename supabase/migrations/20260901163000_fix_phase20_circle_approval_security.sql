-- Phase 20 follow-up: isolate Circle policy helpers and make approval
-- membership creation atomic without exposing privileged browser writes.

create schema if not exists policy_private;
revoke all on schema policy_private from public, anon, authenticated;
grant usage on schema policy_private to authenticated;

create or replace function policy_private.can_insert_phase20_circle_member(
  p_circle_id uuid,
  p_member_id uuid,
  p_member_role text
)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $phase20_policy_helper$
  select case
    when auth.uid() is null then false
    when p_member_role = 'owner' then exists (
      select 1
      from public.social_circles circle
      where circle.id = p_circle_id
        and circle.owner_id = auth.uid()
        and p_member_id = auth.uid()
    )
    when p_member_role = 'member' and p_member_id = auth.uid() then exists (
      select 1
      from public.social_circles circle
      where circle.id = p_circle_id
        and circle.join_policy = 'open'
        and circle.owner_id <> auth.uid()
        and not exists (
          select 1
          from public.social_blocks block
          where
            (block.blocker_id = circle.owner_id and block.blocked_id = auth.uid())
            or
            (block.blocker_id = auth.uid() and block.blocked_id = circle.owner_id)
        )
    )
    else false
  end;
$phase20_policy_helper$;

revoke all on function policy_private.can_insert_phase20_circle_member(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function policy_private.can_insert_phase20_circle_member(uuid, uuid, text)
  to authenticated;

drop policy if exists social_circle_members_insert_phase20 on public.social_circle_members;

create policy social_circle_members_insert_phase20
on public.social_circle_members
for insert
to authenticated
with check (
  policy_private.can_insert_phase20_circle_member(circle_id, member_id, member_role)
);

create or replace function private.ensure_phase20_circle_owner_membership()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $phase20_owner_fix$
begin
  insert into public.social_circle_members (circle_id, member_id, member_role)
  values (new.id, new.owner_id, 'owner')
  on conflict (circle_id, member_id) do nothing;

  return new;
end;
$phase20_owner_fix$;

revoke all on function private.ensure_phase20_circle_owner_membership()
  from public, anon, authenticated;

create or replace function private.apply_phase20_circle_join_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $phase20_approval_fix$
declare
  actor uuid := auth.uid();
  circle_owner uuid;
begin
  if old.status = 'pending' and new.status = 'approved' then
    select circle.owner_id
      into circle_owner
    from public.social_circles circle
    where circle.id = new.circle_id;

    if actor is null or actor <> circle_owner then
      raise exception 'CIRCLE_APPROVAL_NOT_ALLOWED' using errcode = '42501';
    end if;

    insert into public.social_circle_members (circle_id, member_id, member_role)
    values (new.circle_id, new.requester_id, 'member')
    on conflict (circle_id, member_id) do nothing;
  end if;

  return new;
end;
$phase20_approval_fix$;

revoke all on function private.apply_phase20_circle_join_approval()
  from public, anon, authenticated;

drop function if exists private.can_insert_phase20_circle_member(uuid, uuid, text);
