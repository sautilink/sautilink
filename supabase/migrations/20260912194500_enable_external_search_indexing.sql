-- External search indexing for explicitly opted-in public SautiLink profiles and posts.
-- This does not reopen social tables to anon. Crawlers receive only deliberately
-- projected data through SECURITY DEFINER functions with strict privacy predicates.

begin;

create or replace function public.external_index_profile_v1(p_username text)
returns table (
  username text,
  display_name text,
  bio text,
  website_url text,
  location text,
  avatar_key text,
  updated_at timestamptz,
  followers_count integer,
  is_verified boolean,
  verification_badge_type text,
  professional_category_slug text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    profile.username,
    profile.display_name,
    profile.bio,
    profile.website_url,
    profile.location,
    profile.avatar_key,
    profile.updated_at,
    profile.followers_count,
    profile.is_verified,
    profile.verification_badge_type,
    profile.professional_category_slug
  from public.social_profiles profile
  where profile.username = lower(btrim(p_username))
    and profile.is_discoverable = true
    and profile.allow_external_indexing = true
    and not exists (
      select 1
      from public.social_account_deletion_requests deletion
      where deletion.user_id = profile.id
        and deletion.status = 'pending'
    )
  limit 1;
$$;

create or replace function public.external_index_post_v1(p_post_id uuid)
returns table (
  post_id uuid,
  body text,
  created_at timestamptz,
  updated_at timestamptz,
  media_count smallint,
  like_count integer,
  comment_count integer,
  repost_count integer,
  author_username text,
  author_display_name text,
  author_avatar_key text,
  author_is_verified boolean,
  author_verification_badge_type text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    post.id,
    post.body,
    post.created_at,
    post.updated_at,
    post.media_count,
    post.like_count,
    post.comment_count,
    post.repost_count,
    author.username,
    author.display_name,
    author.avatar_key,
    author.is_verified,
    author.verification_badge_type
  from public.social_posts post
  join public.social_profiles author
    on author.id = post.author_id
  join public.social_profiles audience_owner
    on audience_owner.id = post.audience_owner_id
  where post.id = p_post_id
    and post.visibility = 'public'
    and post.circle_id is null
    and post.post_status = 'published'
    and post.deleted_at is null
    and post.moderation_state = 'visible'
    and author.is_discoverable = true
    and author.allow_external_indexing = true
    and audience_owner.is_discoverable = true
    and audience_owner.allow_external_indexing = true
    and not exists (
      select 1
      from public.social_account_deletion_requests deletion
      where deletion.user_id in (author.id, audience_owner.id)
        and deletion.status = 'pending'
    )
  limit 1;
$$;

create or replace function public.external_index_sitemap_counts_v1()
returns table (
  profile_count bigint,
  post_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (
      select count(*)
      from public.social_profiles profile
      where profile.is_discoverable = true
        and profile.allow_external_indexing = true
        and not exists (
          select 1
          from public.social_account_deletion_requests deletion
          where deletion.user_id = profile.id
            and deletion.status = 'pending'
        )
    )::bigint as profile_count,
    (
      select count(*)
      from public.social_posts post
      join public.social_profiles author
        on author.id = post.author_id
      join public.social_profiles audience_owner
        on audience_owner.id = post.audience_owner_id
      where post.visibility = 'public'
        and post.circle_id is null
        and post.post_status = 'published'
        and post.deleted_at is null
        and post.moderation_state = 'visible'
        and author.is_discoverable = true
        and author.allow_external_indexing = true
        and audience_owner.is_discoverable = true
        and audience_owner.allow_external_indexing = true
        and not exists (
          select 1
          from public.social_account_deletion_requests deletion
          where deletion.user_id in (author.id, audience_owner.id)
            and deletion.status = 'pending'
        )
    )::bigint as post_count;
$$;

create or replace function public.external_index_profiles_page_v1(
  p_offset integer default 0,
  p_limit integer default 1000
)
returns table (
  username text,
  updated_at timestamptz,
  is_verified boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    profile.username,
    profile.updated_at,
    profile.is_verified
  from public.social_profiles profile
  where profile.is_discoverable = true
    and profile.allow_external_indexing = true
    and not exists (
      select 1
      from public.social_account_deletion_requests deletion
      where deletion.user_id = profile.id
        and deletion.status = 'pending'
    )
  order by profile.is_verified desc, profile.updated_at desc, profile.username asc
  offset greatest(coalesce(p_offset, 0), 0)
  limit least(greatest(coalesce(p_limit, 1000), 1), 1000);
$$;

create or replace function public.external_index_posts_page_v1(
  p_offset integer default 0,
  p_limit integer default 1000
)
returns table (
  post_id uuid,
  updated_at timestamptz,
  author_is_verified boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    post.id,
    post.updated_at,
    author.is_verified
  from public.social_posts post
  join public.social_profiles author
    on author.id = post.author_id
  join public.social_profiles audience_owner
    on audience_owner.id = post.audience_owner_id
  where post.visibility = 'public'
    and post.circle_id is null
    and post.post_status = 'published'
    and post.deleted_at is null
    and post.moderation_state = 'visible'
    and author.is_discoverable = true
    and author.allow_external_indexing = true
    and audience_owner.is_discoverable = true
    and audience_owner.allow_external_indexing = true
    and not exists (
      select 1
      from public.social_account_deletion_requests deletion
      where deletion.user_id in (author.id, audience_owner.id)
        and deletion.status = 'pending'
    )
  order by author.is_verified desc, post.updated_at desc, post.id asc
  offset greatest(coalesce(p_offset, 0), 0)
  limit least(greatest(coalesce(p_limit, 1000), 1), 1000);
$$;

revoke all on function public.external_index_profile_v1(text) from public;
revoke all on function public.external_index_post_v1(uuid) from public;
revoke all on function public.external_index_sitemap_counts_v1() from public;
revoke all on function public.external_index_profiles_page_v1(integer, integer) from public;
revoke all on function public.external_index_posts_page_v1(integer, integer) from public;

grant execute on function public.external_index_profile_v1(text) to anon, authenticated;
grant execute on function public.external_index_post_v1(uuid) to anon, authenticated;
grant execute on function public.external_index_sitemap_counts_v1() to anon, authenticated;
grant execute on function public.external_index_profiles_page_v1(integer, integer) to anon, authenticated;
grant execute on function public.external_index_posts_page_v1(integer, integer) to anon, authenticated;

comment on function public.external_index_profile_v1(text) is
  'Public indexing projection. Returns a profile only when discoverable and explicitly opted in to external indexing.';
comment on function public.external_index_post_v1(uuid) is
  'Public indexing projection. Returns only visible public posts whose author and audience owner are discoverable and opted in to external indexing.';
comment on function public.external_index_sitemap_counts_v1() is
  'Counts only privacy-eligible profile and post URLs for external sitemap generation.';
comment on function public.external_index_profiles_page_v1(integer, integer) is
  'Paged privacy-eligible profile URLs for external sitemap generation, with verified profiles ordered first.';
comment on function public.external_index_posts_page_v1(integer, integer) is
  'Paged privacy-eligible post URLs for external sitemap generation, with verified authors ordered first.';

commit;
