create or replace function public.public_share_post_v1(p_post_id uuid)
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
  author_verification_badge_type text,
  search_indexable boolean,
  media jsonb
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
    author.verification_badge_type,
    (
      author.is_discoverable = true
      and author.allow_external_indexing = true
      and audience_owner.is_discoverable = true
      and audience_owner.allow_external_indexing = true
    ) as search_indexable,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', media.id,
          'kind', media.media_kind,
          'content_type', media.content_type,
          'width', media.width,
          'height', media.height,
          'duration_ms', media.duration_ms,
          'alt_text', media.alt_text,
          'position', media.position
        )
        order by media.position
      )
      from public.social_post_media media
      where media.post_id = post.id
        and media.upload_status = 'attached'
    ), '[]'::jsonb) as media
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
    and not exists (
      select 1
      from public.social_account_deletion_requests deletion
      where deletion.user_id in (author.id, audience_owner.id)
        and deletion.status = 'pending'
    )
  limit 1;
$$;

revoke all on function public.public_share_post_v1(uuid) from public;
revoke all on function public.public_share_post_v1(uuid) from anon, authenticated;
grant execute on function public.public_share_post_v1(uuid) to anon, authenticated;

drop policy if exists social_post_media_select_phase27_anon on public.social_post_media;
create policy social_post_media_select_phase27_anon
  on public.social_post_media
  for select
  to anon
  using (
    upload_status = 'attached'
    and post_id is not null
    and exists (
      select 1
      from public.social_posts post
      join public.social_profiles author on author.id = post.author_id
      join public.social_profiles audience_owner on audience_owner.id = post.audience_owner_id
      where post.id = social_post_media.post_id
        and post.visibility = 'public'
        and post.circle_id is null
        and post.post_status = 'published'
        and post.deleted_at is null
        and post.moderation_state = 'visible'
        and not exists (
          select 1
          from public.social_account_deletion_requests deletion
          where deletion.user_id in (author.id, audience_owner.id)
            and deletion.status = 'pending'
        )
    )
  );

comment on function public.public_share_post_v1(uuid) is
  'Public direct-link projection for share previews and signed-out guest viewing. Public visibility is independent from search indexing; search_indexable reports whether the post may appear in external search.';
