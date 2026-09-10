-- Align database media bounds with the existing five-item post media build contract.
-- Room composer added in this release uses the fifth slot for images only.

begin;

alter table public.social_posts
  drop constraint if exists social_posts_media_count_bounds,
  add constraint social_posts_media_count_bounds check (
    media_count >= 0 and media_count <= 5
  );

alter table public.social_post_media
  drop constraint if exists social_post_media_position_bounds,
  add constraint social_post_media_position_bounds check (
    position is null or position between 0 and 4
  ),
  drop constraint if exists social_post_media_attach_shape,
  add constraint social_post_media_attach_shape check (
    (
      upload_status = any (array['pending'::text, 'uploaded'::text, 'ready'::text])
      and post_id is null
      and position is null
      and attached_at is null
    )
    or
    (
      upload_status = 'attached'::text
      and post_id is not null
      and position between 0 and 4
      and finalized_at is not null
      and attached_at is not null
    )
  );

comment on constraint social_posts_media_count_bounds on public.social_posts is
  'Posts may attach up to five media items. Room UI restricts its five-item composer to images.';
comment on constraint social_post_media_position_bounds on public.social_post_media is
  'Attached post media positions are zero-based and support at most five items.';

commit;
