begin;
set local lock_timeout = '5s';

alter table public.social_post_media
  drop constraint social_post_media_size_bounds;

alter table public.social_post_media
  add constraint social_post_media_size_bounds
  check (
    size_bytes between 1 and 100000000
    and (media_kind <> 'image' or size_bytes <= 8388608)
  )
  not valid;

alter table public.social_post_media
  validate constraint social_post_media_size_bounds;

commit;
