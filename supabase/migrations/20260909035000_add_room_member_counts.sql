-- Denormalized Room member counts keep discovery cards useful without exposing private rosters.

begin;

alter table public.social_circles
  add column if not exists member_count integer not null default 0;

update public.social_circles room
set member_count = counts.total
from (
  select membership.circle_id, count(*)::integer as total
  from public.social_circle_members membership
  group by membership.circle_id
) counts
where counts.circle_id = room.id;

alter table public.social_circles
  drop constraint if exists social_circles_member_count_nonnegative,
  add constraint social_circles_member_count_nonnegative check (member_count >= 0);

create or replace function private.sync_room_member_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $room_member_count$
begin
  if tg_op = 'INSERT' then
    update public.social_circles
    set member_count = member_count + 1,
        updated_at = now()
    where id = new.circle_id;
    return new;
  end if;

  if tg_op = 'DELETE' then
    update public.social_circles
    set member_count = greatest(member_count - 1, 0),
        updated_at = now()
    where id = old.circle_id;
    return old;
  end if;

  return new;
end;
$room_member_count$;

revoke all on function private.sync_room_member_count() from public, anon, authenticated;
drop trigger if exists sync_room_member_count on public.social_circle_members;
create trigger sync_room_member_count
after insert or delete on public.social_circle_members
for each row execute function private.sync_room_member_count();

revoke update (member_count) on table public.social_circles from authenticated;

comment on column public.social_circles.member_count is
  'Denormalized Room membership count maintained by trigger; browser clients cannot edit it.';

commit;
