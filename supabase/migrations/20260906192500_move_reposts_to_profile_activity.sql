-- Keep plain reposts as profile activity instead of publishing them as new Home feed events.
-- The canonical repost rows, repost counts and existing repost action remain unchanged.

begin;

create or replace function public.profile_activity_state_phase33(p_username text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_viewer uuid := auth.uid();
  v_target record;
  v_owner boolean;
  v_likes text := 'private';
  v_saves text := 'private';
  v_hashtags text := 'private';
begin
  if v_viewer is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select p.id, p.username, p.display_name, p.is_verified, p.verification_badge_type
  into v_target
  from public.social_profiles p
  where p.username = lower(trim(p_username))
  limit 1;

  if not found then
    return jsonb_build_object('available', false);
  end if;

  v_owner := v_target.id = v_viewer;

  if v_owner then
    select pref.likes_visibility, pref.saves_visibility, pref.hashtags_visibility
    into v_likes, v_saves, v_hashtags
    from public.social_profile_activity_preferences pref
    where pref.user_id = v_target.id;

    v_likes := coalesce(v_likes, 'private');
    v_saves := coalesce(v_saves, 'private');
    v_hashtags := coalesce(v_hashtags, 'private');
  end if;

  return jsonb_build_object(
    'available', true,
    'profile', jsonb_build_object(
      'id', v_target.id,
      'username', v_target.username,
      'display_name', v_target.display_name,
      'is_verified', v_target.is_verified,
      'verification_badge_type', v_target.verification_badge_type
    ),
    'owner', v_owner,
    'viewer_follows', case when v_owner then false else exists (
      select 1 from public.social_follows f
      where f.follower_id = v_viewer and f.followed_id = v_target.id
    ) end,
    'tabs', jsonb_build_object(
      'posts', true,
      'reposts', true,
      'replies', true,
      'likes', private.profile_activity_allowed_phase33(v_target.id, 'likes'),
      'saves', private.profile_activity_allowed_phase33(v_target.id, 'saves'),
      'hashtags', private.profile_activity_allowed_phase33(v_target.id, 'hashtags')
    ),
    'preferences', case when v_owner then jsonb_build_object(
      'likes', v_likes,
      'saves', v_saves,
      'hashtags', v_hashtags
    ) else null end,
    'pin_limit', 3
  );
end;
$$;

create or replace function public.profile_reposts_feed_phase35(
  p_username text,
  p_limit integer default 40,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_viewer uuid := auth.uid();
  v_target_id uuid;
  v_limit integer := greatest(1, least(coalesce(p_limit, 40), 50));
  v_offset integer := greatest(0, least(coalesce(p_offset, 0), 500));
  v_items jsonb := '[]'::jsonb;
begin
  if v_viewer is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select p.id into v_target_id
  from public.social_profiles p
  where p.username = lower(trim(p_username))
  limit 1;

  if v_target_id is null then
    return jsonb_build_object('available', false, 'allowed', false, 'items', '[]'::jsonb);
  end if;

  with rows_for_page as (
    select
      p.*,
      repost.created_at as activity_at,
      a.username as author_username,
      a.display_name as author_display_name,
      a.avatar_key as author_avatar_key,
      a.updated_at as author_updated_at,
      a.is_verified as author_is_verified,
      a.verification_badge_type as author_verification_badge_type
    from public.social_reposts repost
    join public.social_posts p on p.id = repost.post_id
    join public.social_profiles a on a.id = p.author_id
    where repost.user_id = v_target_id
      and p.circle_id is null
    order by repost.created_at desc, p.created_at desc
    limit v_limit offset v_offset
  ),
  payload as (
    select
      jsonb_build_object(
        'id', row.id,
        'author_id', row.author_id,
        'body', row.body,
        'visibility', row.visibility,
        'created_at', row.created_at,
        'activity_at', row.activity_at,
        'like_count', row.like_count,
        'comment_count', row.comment_count,
        'repost_count', row.repost_count,
        'reply_to_post_id', row.reply_to_post_id,
        'parent_post_id', row.parent_post_id,
        'root_post_id', row.root_post_id,
        'thread_depth', row.thread_depth,
        'quote_post_id', row.quote_post_id,
        'media_count', row.media_count,
        'pin_position', null,
        'is_pinned', false,
        'viewer_liked', exists (
          select 1 from public.social_post_reactions reaction
          where reaction.post_id = row.id
            and reaction.user_id = v_viewer
            and reaction.reaction_type = 'like'
        ),
        'viewer_reposted', exists (
          select 1 from public.social_reposts viewer_repost
          where viewer_repost.post_id = row.id
            and viewer_repost.user_id = v_viewer
        ),
        'viewer_saved', exists (
          select 1 from public.social_saved_posts saved
          where saved.post_id = row.id
            and saved.user_id = v_viewer
        ),
        'author', jsonb_build_object(
          'username', row.author_username,
          'display_name', row.author_display_name,
          'avatar_key', row.author_avatar_key,
          'updated_at', row.author_updated_at,
          'is_verified', row.author_is_verified,
          'verification_badge_type', row.author_verification_badge_type
        ),
        'replying_to', case when row.parent_post_id is null then null else (
          select jsonb_build_object(
            'post_id', parent.id,
            'username', parent_author.username,
            'display_name', parent_author.display_name
          )
          from public.social_posts parent
          join public.social_profiles parent_author on parent_author.id = parent.author_id
          where parent.id = row.parent_post_id
          limit 1
        ) end,
        'media', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', media.id,
            'kind', media.media_kind,
            'content_type', media.content_type,
            'width', media.width,
            'height', media.height,
            'duration_ms', media.duration_ms,
            'alt_text', media.alt_text,
            'position', media.position
          ) order by media.position)
          from public.social_post_media media
          where media.post_id = row.id
            and media.upload_status = 'attached'
        ), '[]'::jsonb)
      ) as item,
      row.activity_at as sort_time
    from rows_for_page row
  )
  select coalesce(
    jsonb_agg(payload.item order by payload.sort_time desc),
    '[]'::jsonb
  )
  into v_items
  from payload;

  return jsonb_build_object(
    'available', true,
    'allowed', true,
    'items', coalesce(v_items, '[]'::jsonb),
    'limit', v_limit,
    'offset', v_offset
  );
end;
$$;

revoke all on function public.profile_activity_state_phase33(text) from public, anon;
grant execute on function public.profile_activity_state_phase33(text) to authenticated;
revoke all on function public.profile_reposts_feed_phase35(text, integer, integer) from public, anon;
grant execute on function public.profile_reposts_feed_phase35(text, integer, integer) to authenticated;

-- Home is a feed of original/quoted posts. A plain repost remains an interaction and
-- is surfaced on the reposter's profile instead of being promoted as a fresh Home item.
create or replace view public.social_stream_events
with (security_invoker = true)
as
select
  'post'::text as event_type,
  post.id as post_id,
  post.author_id as actor_id,
  post.created_at as event_at,
  post.id::text as event_key
from public.social_posts post;

revoke all on table public.social_stream_events from public, anon, authenticated;
grant select on table public.social_stream_events to anon, authenticated;

comment on view public.social_stream_events is
  'Security-invoker chronological Home stream of visible original posts. Plain reposts remain profile activity.';
comment on function public.profile_reposts_feed_phase35(text, integer, integer) is
  'Visible plain reposts for the requested profile, ordered by repost time and filtered by caller RLS.';

commit;
