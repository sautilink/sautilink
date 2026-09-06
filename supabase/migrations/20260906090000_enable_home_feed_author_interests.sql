-- Persist member-selected Home ranking preferences without exposing them to other members.

create table if not exists public.social_feed_author_interests (
  user_id uuid not null references public.social_profiles(id) on delete cascade,
  author_id uuid not null references public.social_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, author_id),
  constraint social_feed_author_interests_distinct_members check (user_id <> author_id)
);

create index if not exists social_feed_author_interests_author_idx
  on public.social_feed_author_interests (author_id);

alter table public.social_feed_author_interests enable row level security;
alter table public.social_feed_author_interests force row level security;

revoke all on table public.social_feed_author_interests from public, anon, authenticated;
grant select, insert, update, delete on table public.social_feed_author_interests to authenticated;
grant select, insert, update, delete on table public.social_feed_author_interests to service_role;

drop policy if exists social_feed_author_interests_select_own on public.social_feed_author_interests;
drop policy if exists social_feed_author_interests_insert_own on public.social_feed_author_interests;
drop policy if exists social_feed_author_interests_update_own on public.social_feed_author_interests;
drop policy if exists social_feed_author_interests_delete_own on public.social_feed_author_interests;

create policy social_feed_author_interests_select_own
  on public.social_feed_author_interests for select to authenticated
  using ((select auth.uid()) = user_id);

create policy social_feed_author_interests_insert_own
  on public.social_feed_author_interests for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and user_id <> author_id
    and exists (
      select 1
      from public.social_profiles target
      where target.id = author_id
        and target.is_discoverable = true
    )
    and not exists (
      select 1
      from public.social_blocks block
      where (block.blocker_id = user_id and block.blocked_id = author_id)
         or (block.blocker_id = author_id and block.blocked_id = user_id)
    )
  );

create policy social_feed_author_interests_update_own
  on public.social_feed_author_interests for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and user_id <> author_id
    and exists (
      select 1
      from public.social_profiles target
      where target.id = author_id
        and target.is_discoverable = true
    )
  );

create policy social_feed_author_interests_delete_own
  on public.social_feed_author_interests for delete to authenticated
  using ((select auth.uid()) = user_id);

comment on table public.social_feed_author_interests is
  'Private per-member author preferences used to prioritize posts in Home.';
