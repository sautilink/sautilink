begin;

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
  select
    'post'::text as event_type,
    post.id as post_id,
    post.author_id as actor_id,
    post.created_at as event_at,
    post.id::text as event_key,
    0::double precision as rank_score
  from public.social_posts post
  where post.parent_post_id is null
    and post.circle_id is null
    and post.visibility in ('public', 'followers')
    and p_mode in ('for_you', 'following', 'short_videos')
    and (
      p_mode <> 'following'
      or exists (
        select 1
        from public.social_follows follow
        where follow.follower_id = (select auth.uid())
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
  order by post.created_at desc, post.id desc
  limit least(greatest(coalesce(p_limit, 21), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.social_home_feed(text, integer, integer) from public, anon;
grant execute on function public.social_home_feed(text, integer, integer) to authenticated, service_role;

comment on function public.social_home_feed(text, integer, integer) is
  'RLS-aware chronological Home feeds: For You includes all accessible platform posts, Following includes followed authors only, and Short Videos includes all accessible attached videos.';

commit;
