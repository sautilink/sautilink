begin;

-- Phase 13 exposes only the four owner-editable profile columns to the client.
-- RLS still limits every update to auth.uid() = id.
revoke update on table public.social_profiles from public, anon, authenticated;

grant update (bio, location, website_url, is_discoverable)
  on table public.social_profiles
  to authenticated;

commit;
