-- Phase 15: bounded owner profile-media metadata.
-- R2 object creation remains server-controlled; authenticated users may only
-- point their own profile at keys inside their own strict avatar/header slots.

begin;

alter table public.social_profiles
  drop constraint if exists social_profiles_avatar_key_scope,
  drop constraint if exists social_profiles_header_key_scope;

alter table public.social_profiles
  add constraint social_profiles_avatar_key_scope check (
    avatar_key is null
    or avatar_key ~ (
      '^profiles/' || id::text ||
      '/avatar/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
    )
  ),
  add constraint social_profiles_header_key_scope check (
    header_key is null
    or header_key ~ (
      '^profiles/' || id::text ||
      '/header/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
    )
  );

revoke update on table public.social_profiles from public, anon, authenticated;
grant update (
  bio,
  location,
  website_url,
  is_discoverable,
  avatar_key,
  header_key
) on table public.social_profiles to authenticated;

comment on column public.social_profiles.avatar_key is
  'Validated Cloudflare R2 avatar key scoped to profiles/{owner-id}/avatar/{uuid}.{jpg|png|webp}.';
comment on column public.social_profiles.header_key is
  'Validated Cloudflare R2 header key scoped to profiles/{owner-id}/header/{uuid}.{jpg|png|webp}.';

commit;
