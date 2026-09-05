-- Restrict signed-out visitors to a deliberately small discoverable profile teaser.
-- Full social content remains available only to authenticated SautiLink members.

begin;

-- Guests may resolve only the identity fields required by the profile teaser and
-- public profile-media endpoint. RLS still limits these reads to discoverable profiles.
revoke select on table public.social_profiles from anon;
grant select (
  id,
  username,
  display_name,
  avatar_key,
  header_key,
  is_discoverable,
  is_verified,
  verification_badge_type,
  followers_count
) on table public.social_profiles to anon;

-- Content is member-only. Remove both privileges and the legacy anonymous read
-- policies so a future broad grant cannot accidentally reopen public content.
revoke select on table public.social_posts from anon;
revoke select on table public.social_post_comments from anon;
revoke select on table public.social_post_media from anon;
revoke select on table public.social_post_polls from anon;
revoke select on table public.social_post_poll_options from anon;
revoke select on table public.social_reposts from anon;
revoke select on table public.social_stream_events from anon;

drop policy if exists social_posts_select_phase29_anon on public.social_posts;
drop policy if exists social_post_comments_select_phase29_anon on public.social_post_comments;
drop policy if exists social_post_media_select_phase27_anon on public.social_post_media;
drop policy if exists social_post_polls_select_anon on public.social_post_polls;
drop policy if exists social_post_poll_options_select_anon on public.social_post_poll_options;
drop policy if exists social_reposts_select_anon on public.social_reposts;

commit;
