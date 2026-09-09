-- Private Rooms remain discoverable by metadata while their posts stay member-only.
-- This lets people understand a Room's topic/category before requesting access.

begin;

drop policy if exists social_circles_select_rooms on public.social_circles;
create policy social_circles_select_rooms
on public.social_circles
for select
to authenticated
using (
  not exists (
    select 1
    from public.social_blocks block
    where
      (block.blocker_id = owner_id and block.blocked_id = (select auth.uid()))
      or
      (block.blocker_id = (select auth.uid()) and block.blocked_id = owner_id)
  )
);

-- The existing decision trigger owns decided_at, but the enhanced Room UI submits
-- the field alongside status. RLS still limits decisions to Room staff.
grant update (status, decided_at) on table public.social_circle_join_requests to authenticated;

comment on column public.social_circles.privacy is
  'Room content privacy. Public and private Room metadata can be discovered; Room posts remain member-only through social_posts RLS.';

commit;
