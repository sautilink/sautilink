begin;

-- Root posts count every published comment/reply; a comment still counts its direct replies.
-- This private trigger retains the existing privilege boundary and changes no row visibility.
create or replace function private.sync_phase26_reply_counts()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public
as $counts$
declare
  old_counted boolean := false;
  new_counted boolean := false;
begin
  if tg_op <> 'INSERT' then
    old_counted := old.parent_post_id is not null and old.deleted_at is null
      and old.post_status = 'published' and old.moderation_state = 'visible';
  end if;
  if tg_op <> 'DELETE' then
    new_counted := new.parent_post_id is not null and new.deleted_at is null
      and new.post_status = 'published' and new.moderation_state = 'visible';
  end if;
  if tg_op = 'UPDATE' and old_counted = new_counted then
    if old.parent_post_id is not distinct from new.parent_post_id
      and old.root_post_id is not distinct from new.root_post_id then return new; end if;
  end if;
  if old_counted then
    update public.social_posts set comment_count = greatest(comment_count - 1, 0)
      where id in (old.parent_post_id, old.root_post_id);
  end if;
  if new_counted then
    update public.social_posts set comment_count = comment_count + 1
      where id in (new.parent_post_id, new.root_post_id);
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$counts$;
revoke all on function private.sync_phase26_reply_counts() from public, anon, authenticated;

drop trigger if exists sync_phase26_reply_counts on public.social_posts;
create trigger sync_phase26_reply_counts
  after insert or delete or update of parent_post_id, root_post_id, deleted_at, post_status, moderation_state
  on public.social_posts for each row execute function private.sync_phase26_reply_counts();

with eligible as (
  select parent_post_id, root_post_id from public.social_posts
  where parent_post_id is not null and deleted_at is null
    and post_status = 'published' and moderation_state = 'visible'
), contributions as (
  select parent_post_id as target from eligible
  union all
  select root_post_id from eligible where root_post_id is distinct from parent_post_id
), totals as (
  select p.id, count(c.target)::integer as total
  from public.social_posts p left join contributions c on c.target = p.id group by p.id
)
update public.social_posts p set comment_count = totals.total
from totals where p.id = totals.id and p.comment_count is distinct from totals.total;

comment on column public.social_posts.comment_count is
  'Top-level post: all published visible comments and nested replies. Comment: direct published visible replies.';
commit;
