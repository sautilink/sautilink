-- Phase 24: private Saved Sauti foundation.

create table if not exists public.social_saved_posts (
  user_id uuid not null references public.social_profiles(id) on delete cascade,
  post_id uuid not null references public.social_posts(id) on delete cascade,
  saved_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

alter table public.social_saved_posts enable row level security;
alter table public.social_saved_posts force row level security;

revoke all on table public.social_saved_posts from public, anon, authenticated;

grant select, delete on table public.social_saved_posts to authenticated;
grant insert (user_id, post_id) on table public.social_saved_posts to authenticated;

drop policy if exists social_saved_posts_select_own_phase24 on public.social_saved_posts;
create policy social_saved_posts_select_own_phase24
  on public.social_saved_posts
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists social_saved_posts_insert_own_phase24 on public.social_saved_posts;
create policy social_saved_posts_insert_own_phase24
  on public.social_saved_posts
  for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.social_posts post
      where post.id = social_saved_posts.post_id
    )
  );

drop policy if exists social_saved_posts_delete_own_phase24 on public.social_saved_posts;
create policy social_saved_posts_delete_own_phase24
  on public.social_saved_posts
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create index if not exists social_saved_posts_user_saved_idx
  on public.social_saved_posts (user_id, saved_at desc, post_id);

create index if not exists social_saved_posts_post_idx
  on public.social_saved_posts (post_id);

comment on table public.social_saved_posts is
  'Phase 24 private per-member Saved Sauti relationships. Save state is never public.';
