-- Home tabs: personalized For You, chronological Following, and ranked Short Videos.
-- The function is SECURITY INVOKER so social_posts RLS remains the final authority
-- for visibility, moderation, block, and mute rules.

begin;

-- Keep the rollout self-contained for environments that predate the original
-- author-interest preference migration.
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

create index if not exists social_posts_home_top_level_created_idx
  on public.social_posts (created_at desc, id desc)
  where parent_post_id is null
    and circle_id is null
    and post_status = 'published'
    and deleted_at is null;

create index if not exists social_post_media_attached_video_post_idx
  on public.social_post_media (post_id)
  where media_kind = 'video'
    and upload_status = 'attached'
    and post_id is not null;

create or replace function public.social_home_feed(
  p_mode text default 'for_you',
  p_limit integer default 21,
  p_offset integer default 0
)
returns table (
  event_type text,
  post_id uuid,
  actor_id uuid,
  event_at timestamptz,
  event_key text,
  rank_score double precision
)
language sql
stable
security invoker
set search_path = ''
as $$
  with viewer as (
    select auth.uid() as id
  ),
  author_signal_rows as (
    select interacted.author_id,
      case reaction.reaction_type
        when 'like' then 6::double precision
        when 'dislike' then -10::double precision
        else 0::double precision
      end as weight
    from public.social_post_reactions reaction
    join public.social_posts interacted on interacted.id = reaction.post_id
    where reaction.user_id = (select id from viewer)
      and interacted.parent_post_id is null

    union all

    select interacted.author_id, 8::double precision as weight
    from public.social_saved_posts saved
    join public.social_posts interacted on interacted.id = saved.post_id
    where saved.user_id = (select id from viewer)
      and interacted.parent_post_id is null

    union all

    select interacted.author_id, 9::double precision as weight
    from public.social_reposts repost
    join public.social_posts interacted on interacted.id = repost.post_id
    where repost.user_id = (select id from viewer)
      and interacted.parent_post_id is null
  ),
  author_affinity as (
    select author_id, greatest(-20::double precision, least(28::double precision, sum(weight))) as score
    from author_signal_rows
    group by author_id
  ),
  scored as (
    select
      post.id,
      post.author_id,
      post.created_at,
      (
        case when exists (
          select 1
          from public.social_feed_author_interests interest
          where interest.user_id = (select id from viewer)
            and interest.author_id = post.author_id
        ) then 72 else 0 end
        + case when post.author_id = (select id from viewer) then 36 else 0 end
        + case when exists (
          select 1
          from public.social_follows follow
          where follow.follower_id = (select id from viewer)
            and follow.followed_id = post.author_id
        ) then 32 else 0 end
        + coalesce(affinity.score, 0)
        + least(
          24::double precision,
          ln(1 + greatest(0, post.like_count) + (greatest(0, post.comment_count) * 2) + (greatest(0, post.repost_count) * 3)) * 5
        )
        + least(
          22::double precision,
          greatest(
            0::double precision,
            22 - (extract(epoch from (statement_timestamp() - post.created_at)) / 21600.0)
          )
        )
      )::double precision as base_score,
      row_number() over (
        partition by post.author_id
        order by post.created_at desc, post.id desc
      ) as author_position
    from public.social_posts post
    left join author_affinity affinity on affinity.author_id = post.author_id
    where post.parent_post_id is null
      and post.circle_id is null
      and post.visibility in ('public', 'followers')
      and p_mode in ('for_you', 'following', 'short_videos')
      and (
        p_mode <> 'following'
        or post.author_id = (select id from viewer)
        or exists (
          select 1
          from public.social_follows follow
          where follow.follower_id = (select id from viewer)
            and follow.followed_id = post.author_id
        )
      )
      and (
        p_mode <> 'short_videos'
        or exists (
          select 1
          from public.social_post_media media
          where media.post_id = post.id
            and media.media_kind = 'video'
            and media.upload_status = 'attached'
        )
      )
  ),
  diversified as (
    select
      scored.*,
      case
        when p_mode = 'following' then 0::double precision
        else scored.base_score - (greatest(0, scored.author_position - 1) * 11)
      end as final_score
    from scored
  )
  select
    'post'::text as event_type,
    diversified.id as post_id,
    diversified.author_id as actor_id,
    diversified.created_at as event_at,
    diversified.id::text as event_key,
    diversified.final_score as rank_score
  from diversified
  order by
    case when p_mode = 'following' then null else diversified.final_score end desc nulls last,
    diversified.created_at desc,
    diversified.id desc
  limit least(greatest(coalesce(p_limit, 21), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.social_home_feed(text, integer, integer) from public, anon;
grant execute on function public.social_home_feed(text, integer, integer) to authenticated, service_role;

comment on function public.social_home_feed(text, integer, integer) is
  'RLS-aware Home feed. For You ranks explicit interests, follows, recent interactions, freshness, engagement and author diversity; Following remains chronological; Short Videos applies the same ranking to attached videos.';

commit;
