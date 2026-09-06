-- Restore the Phase 26 Home stream contract after the repost-profile migration.
-- Home contains top-level public/follower posts only; threaded replies remain in
-- their conversation and profile Replies surfaces. Plain reposts remain profile-only.

begin;

create or replace view public.social_stream_events
with (security_invoker = true)
as
select
  'post'::text as event_type,
  post.id as post_id,
  post.author_id as actor_id,
  post.created_at as event_at,
  post.id::text as event_key
from public.social_posts post
where post.parent_post_id is null
  and post.circle_id is null
  and post.visibility in ('public', 'followers');

revoke all on table public.social_stream_events from public, anon, authenticated;
grant select on table public.social_stream_events to anon, authenticated;

comment on view public.social_stream_events is
  'Security-invoker Home stream of visible top-level public/follower posts. Threaded replies and Sautify posts stay on their dedicated surfaces; plain reposts remain profile activity.';

commit;
