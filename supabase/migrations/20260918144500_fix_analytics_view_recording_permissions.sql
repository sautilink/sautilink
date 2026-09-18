begin;

-- The analytics RPCs use INSERT ... ON CONFLICT to deduplicate views. PostgreSQL
-- requires SELECT privilege on the conflict target table for that operation.
-- Keep viewer identities private with RLS: authenticated users receive table-level
-- SELECT privilege, but there is intentionally no SELECT policy exposing rows.
grant select, insert on table public.social_post_views to authenticated;
grant select, insert on table public.social_profile_views to authenticated;

comment on table public.social_post_views is
  'Unique authenticated member views of social posts. Authenticated SELECT privilege exists only so INSERT ... ON CONFLICT can deduplicate; RLS exposes no viewer rows.';
comment on table public.social_profile_views is
  'Privacy-preserving daily unique authenticated profile views. Authenticated SELECT privilege exists only so INSERT ... ON CONFLICT can deduplicate; RLS exposes no viewer rows.';

commit;
