-- Phase 20 follow-up: remove Circle membership policy recursion and
-- keep browser privileges least-privilege.

create or replace function private.can_insert_phase20_circle_member(
  p_circle_id uuid,
  p_member_id uuid,
  p_member_role text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $phase20_member_check$
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
    when p_member_role = 'member' then exists (
      select 1
      from public.social_circles circle
      join public.social_circle_join_requests request
        on request.circle_id = circle.id
       and request.requester_id = p_member_id
       and request.status = 'approved'
      where circle.id = p_circle_id
        and circle.owner_id = auth.uid()
    )
    else false
  end;
$phase20_member_check$;

revoke all on function private.can_insert_phase20_circle_member(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function private.can_insert_phase20_circle_member(uuid, uuid, text)
  to authenticated;

drop policy if exists social_circle_members_insert_phase20 on public.social_circle_members;

create policy social_circle_members_insert_phase20
on public.social_circle_members
for insert
to authenticated
with check (
  private.can_insert_phase20_circle_member(circle_id, member_id, member_role)
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
