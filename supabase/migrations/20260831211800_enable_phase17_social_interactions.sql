-- Phase 17: reactions, comments, reposts and follow relationships.
-- Supabase remains canonical. New public tables use explicit grants + forced RLS.

begin;

alter table public.social_profiles
  add column if not exists followers_count integer not null default 0,
  add column if not exists following_count integer not null default 0;

alter table public.social_profiles
  drop constraint if exists social_profiles_followers_count_nonnegative,
  drop constraint if exists social_profiles_following_count_nonnegative;

alter table public.social_profiles
  add constraint social_profiles_followers_count_nonnegative check (followers_count >= 0),
  add constraint social_profiles_following_count_nonnegative check (following_count >= 0);

alter table public.social_posts
  add column if not exists like_count integer not null default 0,
  add column if not exists comment_count integer not null default 0,
  add column if not exists repost_count integer not null default 0;

alter table public.social_posts
  drop constraint if exists social_posts_like_count_nonnegative,
  drop constraint if exists social_posts_comment_count_nonnegative,
  drop constraint if exists social_posts_repost_count_nonnegative;

alter table public.social_posts
  add constraint social_posts_like_count_nonnegative check (like_count >= 0),
  add constraint social_posts_comment_count_nonnegative check (comment_count >= 0),
  add constraint social_posts_repost_count_nonnegative check (repost_count >= 0);

create table if not exists public.social_post_reactions (
  post_id uuid not null references public.social_posts(id) on delete cascade,
  user_id uuid not null references public.social_profiles(id) on delete cascade,
  reaction_type text not null default 'like',
  created_at timestamptz not null default now(),
  primary key (post_id, user_id),
  constraint social_post_reactions_type_phase17 check (reaction_type = 'like')
);

create index if not exists social_post_reactions_user_created_idx
  on public.social_post_reactions (user_id, created_at desc);

create table if not exists public.social_post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.social_posts(id) on delete cascade,
  author_id uuid not null references public.social_profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  constraint social_post_comments_body_length check (
    char_length(btrim(body)) between 1 and 500
  )
);

create index if not exists social_post_comments_post_created_idx
  on public.social_post_comments (post_id, created_at, id);
create index if not exists social_post_comments_author_created_idx
  on public.social_post_comments (author_id, created_at desc);

create table if not exists public.social_reposts (
  post_id uuid not null references public.social_posts(id) on delete cascade,
  user_id uuid not null references public.social_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index if not exists social_reposts_user_created_idx
  on public.social_reposts (user_id, created_at desc);
create index if not exists social_reposts_stream_idx
  on public.social_reposts (created_at desc, post_id, user_id);

alter table public.social_post_reactions enable row level security;
alter table public.social_post_reactions force row level security;
alter table public.social_post_comments enable row level security;
alter table public.social_post_comments force row level security;
alter table public.social_reposts enable row level security;
alter table public.social_reposts force row level security;

revoke all on table
  public.social_post_reactions,
  public.social_post_comments,
  public.social_reposts
from public, anon, authenticated;

grant select, insert, delete on table public.social_post_reactions to authenticated;
grant select on table public.social_post_comments, public.social_reposts to anon;
grant select, insert, delete on table public.social_post_comments, public.social_reposts to authenticated;

grant select, insert, update, delete on table
  public.social_post_reactions,
  public.social_post_comments,
  public.social_reposts
to service_role;

drop policy if exists social_follows_select_authenticated on public.social_follows;
drop policy if exists social_follows_insert_own on public.social_follows;
drop policy if exists social_follows_delete_own on public.social_follows;
drop policy if exists social_follows_select_involved on public.social_follows;
drop policy if exists social_follows_insert_phase17 on public.social_follows;
drop policy if exists social_follows_delete_phase17 on public.social_follows;

create policy social_follows_select_involved
  on public.social_follows for select to authenticated
  using (
    (select auth.uid()) = follower_id
    or (select auth.uid()) = followed_id
  );

create policy social_follows_insert_phase17
  on public.social_follows for insert to authenticated
  with check (
    (select auth.uid()) = follower_id
    and follower_id <> followed_id
    and exists (
      select 1
      from public.social_profiles target
      where target.id = followed_id
        and target.is_discoverable = true
    )
    and not exists (
      select 1
      from public.social_blocks block
      where (block.blocker_id = follower_id and block.blocked_id = followed_id)
         or (block.blocker_id = followed_id and block.blocked_id = follower_id)
    )
  );

create policy social_follows_delete_phase17
  on public.social_follows for delete to authenticated
  using ((select auth.uid()) = follower_id);

drop policy if exists social_post_reactions_select_own on public.social_post_reactions;
drop policy if exists social_post_reactions_insert_own on public.social_post_reactions;
drop policy if exists social_post_reactions_delete_own on public.social_post_reactions;

create policy social_post_reactions_select_own
  on public.social_post_reactions for select to authenticated
  using ((select auth.uid()) = user_id);

create policy social_post_reactions_insert_own
  on public.social_post_reactions for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and reaction_type = 'like'
    and exists (
      select 1
      from public.social_posts post
      where post.id = post_id
    )
  );

create policy social_post_reactions_delete_own
  on public.social_post_reactions for delete to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists social_post_comments_select_anon on public.social_post_comments;
drop policy if exists social_post_comments_select_authenticated on public.social_post_comments;
drop policy if exists social_post_comments_insert_own on public.social_post_comments;
drop policy if exists social_post_comments_delete_own on public.social_post_comments;

create policy social_post_comments_select_anon
  on public.social_post_comments for select to anon
  using (
    exists (
      select 1
      from public.social_posts post
      where post.id = post_id
    )
    and exists (
      select 1
      from public.social_profiles profile
      where profile.id = author_id
        and profile.is_discoverable = true
    )
  );

create policy social_post_comments_select_authenticated
  on public.social_post_comments for select to authenticated
  using (
    exists (
      select 1
      from public.social_posts post
      where post.id = post_id
    )
    and (
      (select auth.uid()) = author_id
      or exists (
        select 1
        from public.social_profiles profile
        where profile.id = author_id
          and profile.is_discoverable = true
      )
    )
    and not exists (
      select 1
      from public.social_blocks block
      where (block.blocker_id = (select auth.uid()) and block.blocked_id = author_id)
         or (block.blocker_id = author_id and block.blocked_id = (select auth.uid()))
    )
  );

create policy social_post_comments_insert_own
  on public.social_post_comments for insert to authenticated
  with check (
    (select auth.uid()) = author_id
    and exists (
      select 1
      from public.social_posts post
      where post.id = post_id
    )
  );

create policy social_post_comments_delete_own
  on public.social_post_comments for delete to authenticated
  using ((select auth.uid()) = author_id);

drop policy if exists social_reposts_select_anon on public.social_reposts;
drop policy if exists social_reposts_select_authenticated on public.social_reposts;
drop policy if exists social_reposts_insert_own on public.social_reposts;
drop policy if exists social_reposts_delete_own on public.social_reposts;

create policy social_reposts_select_anon
  on public.social_reposts for select to anon
  using (
    exists (
      select 1
      from public.social_posts post
      where post.id = post_id
    )
    and exists (
      select 1
      from public.social_profiles profile
      where profile.id = user_id
        and profile.is_discoverable = true
    )
  );

create policy social_reposts_select_authenticated
  on public.social_reposts for select to authenticated
  using (
    exists (
      select 1
      from public.social_posts post
      where post.id = post_id
    )
    and (
      (select auth.uid()) = user_id
      or exists (
        select 1
        from public.social_profiles profile
        where profile.id = user_id
          and profile.is_discoverable = true
      )
    )
    and not exists (
      select 1
      from public.social_blocks block
      where (block.blocker_id = (select auth.uid()) and block.blocked_id = user_id)
         or (block.blocker_id = user_id and block.blocked_id = (select auth.uid()))
    )
  );

create policy social_reposts_insert_own
  on public.social_reposts for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.social_posts post
      where post.id = post_id
    )
  );

create policy social_reposts_delete_own
  on public.social_reposts for delete to authenticated
  using ((select auth.uid()) = user_id);

update public.social_profiles profile
set followers_count = (
      select count(*)::integer
      from public.social_follows follow
      where follow.followed_id = profile.id
    ),
    following_count = (
      select count(*)::integer
      from public.social_follows follow
      where follow.follower_id = profile.id
    );

create or replace function private.sync_social_follow_counts()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    update public.social_profiles
    set following_count = following_count + 1
    where id = new.follower_id;

    update public.social_profiles
    set followers_count = followers_count + 1
    where id = new.followed_id;

    return new;
  end if;

  if tg_op = 'DELETE' then
    update public.social_profiles
    set following_count = greatest(following_count - 1, 0)
    where id = old.follower_id;

    update public.social_profiles
    set followers_count = greatest(followers_count - 1, 0)
    where id = old.followed_id;

    return old;
  end if;

  return null;
end;
$$;

revoke all on function private.sync_social_follow_counts() from public, anon, authenticated;

drop trigger if exists sync_social_follow_counts on public.social_follows;
create trigger sync_social_follow_counts
after insert or delete on public.social_follows
for each row execute function private.sync_social_follow_counts();

create or replace function private.sync_social_post_interaction_counts()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_post_id uuid;
  delta integer;
begin
  if tg_op = 'INSERT' then
    target_post_id := new.post_id;
    delta := 1;
  elsif tg_op = 'DELETE' then
    target_post_id := old.post_id;
    delta := -1;
  else
    return null;
  end if;

  if tg_table_name = 'social_post_reactions' then
    update public.social_posts
    set like_count = greatest(like_count + delta, 0)
    where id = target_post_id;
  elsif tg_table_name = 'social_post_comments' then
    update public.social_posts
    set comment_count = greatest(comment_count + delta, 0)
    where id = target_post_id;
  elsif tg_table_name = 'social_reposts' then
    update public.social_posts
    set repost_count = greatest(repost_count + delta, 0)
    where id = target_post_id;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function private.sync_social_post_interaction_counts() from public, anon, authenticated;

drop trigger if exists sync_social_post_reaction_counts on public.social_post_reactions;
create trigger sync_social_post_reaction_counts
after insert or delete on public.social_post_reactions
for each row execute function private.sync_social_post_interaction_counts();

drop trigger if exists sync_social_post_comment_counts on public.social_post_comments;
create trigger sync_social_post_comment_counts
after insert or delete on public.social_post_comments
for each row execute function private.sync_social_post_interaction_counts();

drop trigger if exists sync_social_repost_counts on public.social_reposts;
create trigger sync_social_repost_counts
after insert or delete on public.social_reposts
for each row execute function private.sync_social_post_interaction_counts();

drop view if exists public.social_stream_events;

create view public.social_stream_events
with (security_invoker = true)
as
select
  'post'::text as event_type,
  post.id as post_id,
  post.author_id as actor_id,
  post.created_at as event_at,
  post.id::text as event_key
from public.social_posts post
union all
select
  'repost'::text as event_type,
  repost.post_id,
  repost.user_id as actor_id,
  repost.created_at as event_at,
  repost.post_id::text || ':' || repost.user_id::text as event_key
from public.social_reposts repost;

revoke all on table public.social_stream_events from public, anon, authenticated;
grant select on table public.social_stream_events to anon, authenticated;

comment on table public.social_post_reactions is
  'Phase 17 canonical post reactions. The live reaction type is like.';
comment on table public.social_post_comments is
  'Phase 17 one-level text comments on visible public Sauti.';
comment on table public.social_reposts is
  'Phase 17 canonical repost events referencing original Sauti.';
comment on view public.social_stream_events is
  'Security-invoker Phase 17 chronological union of visible original Sauti and visible repost events.';

commit;
