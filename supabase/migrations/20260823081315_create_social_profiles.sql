-- Phase 1 identity and public-profile foundation.
--
-- account_profiles is the private, authoritative SautiLink account record.
-- social_profiles is the deliberately public projection used by the social app.
-- Keeping the two tables separate prevents WhatsApp and notification preferences
-- from being exposed when public profiles are queried.

create schema if not exists private;

create table if not exists public.account_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  full_name text not null,
  avatar_url text,
  email_updates boolean not null default false,
  whatsapp_e164 text,
  whatsapp_updates boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  whatsapp_verified_at timestamptz,
  constraint account_profiles_username_format check (
    username = lower(username)
    and username ~ '^[a-z0-9][a-z0-9._]{2,29}$'
  ),
  constraint account_profiles_username_reserved check (
    username <> all (array[
      'admin', 'administrator', 'root', 'support', 'security', 'sautilink',
      'cloudengine', 'official', 'api', 'help', 'about', 'settings', 'login',
      'signup', 'account'
    ]::text[])
  ),
  constraint account_profiles_full_name_length check (
    char_length(btrim(full_name)) between 1 and 80
  ),
  constraint account_profiles_whatsapp_e164 check (
    whatsapp_e164 is null or whatsapp_e164 ~ '^\+[1-9][0-9]{7,14}$'
  ),
  constraint account_profiles_whatsapp_opt_in_requires_verified_number check (
    whatsapp_updates = false
    or (whatsapp_e164 is not null and whatsapp_verified_at is not null)
  )
);

comment on table public.account_profiles is
  'Private SautiLink Account profile data shared across SautiLink products. Rows are created only after successful email verification; verification remains authoritative in Supabase Auth.';
comment on column public.account_profiles.username is
  'Lowercase, globally unique SautiLink handle. It is not an authorization claim.';
comment on column public.account_profiles.email_updates is
  'Explicit opt-in for non-essential SautiLink ecosystem email updates; false by default.';
comment on column public.account_profiles.whatsapp_updates is
  'Explicit opt-in for non-essential SautiLink ecosystem WhatsApp updates; false by default.';
comment on column public.account_profiles.whatsapp_verified_at is
  'Server-owned timestamp proving the current WhatsApp number completed verification.';

alter table public.account_profiles enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'account_profiles'
      and policyname = 'account_profiles_select_own'
  ) then
    create policy account_profiles_select_own
      on public.account_profiles
      for select
      to authenticated
      using ((select auth.uid()) = id);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'account_profiles'
      and policyname = 'account_profiles_update_own'
  ) then
    create policy account_profiles_update_own
      on public.account_profiles
      for update
      to authenticated
      using ((select auth.uid()) = id)
      with check ((select auth.uid()) = id);
  end if;
end $$;

revoke all on table public.account_profiles from anon, authenticated;
grant select on table public.account_profiles to authenticated;
grant update (
  username,
  full_name,
  avatar_url,
  email_updates,
  whatsapp_e164,
  whatsapp_updates
) on table public.account_profiles to authenticated;
grant select, insert, update, delete on table public.account_profiles to service_role;

create or replace function private.set_account_profile_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists set_account_profile_updated_at
  on public.account_profiles;
create trigger set_account_profile_updated_at
  before update on public.account_profiles
  for each row
  execute function private.set_account_profile_updated_at();

create or replace function private.reset_whatsapp_verification_on_number_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.whatsapp_e164 is distinct from old.whatsapp_e164 then
    new.whatsapp_verified_at := null;
    new.whatsapp_updates := false;
  end if;
  return new;
end;
$$;

drop trigger if exists reset_account_whatsapp_verification
  on public.account_profiles;
create trigger reset_account_whatsapp_verification
  before update of whatsapp_e164 on public.account_profiles
  for each row
  execute function private.reset_whatsapp_verification_on_number_change();

create table public.social_profiles (
  id uuid primary key references public.account_profiles(id) on delete cascade,
  username text not null unique,
  display_name text not null,
  bio text not null default '',
  avatar_key text,
  header_key text,
  website_url text,
  location text,
  is_discoverable boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_profiles_username_format check (
    username = lower(username)
    and username ~ '^[a-z0-9][a-z0-9._]{2,29}$'
  ),
  constraint social_profiles_username_reserved check (
    username <> all (array[
      'admin', 'administrator', 'root', 'support', 'security', 'sautilink',
      'cloudengine', 'official', 'api', 'help', 'about', 'settings', 'login',
      'signup', 'account'
    ]::text[])
  ),
  constraint social_profiles_display_name_length check (
    char_length(btrim(display_name)) between 1 and 80
  ),
  constraint social_profiles_bio_length check (
    char_length(bio) <= 500
  ),
  constraint social_profiles_avatar_key_scope check (
    avatar_key is null
    or (
      char_length(avatar_key) between 1 and 512
      and avatar_key like ('profiles/' || id::text || '/%')
    )
  ),
  constraint social_profiles_header_key_scope check (
    header_key is null
    or (
      char_length(header_key) between 1 and 512
      and header_key like ('profiles/' || id::text || '/%')
    )
  ),
  constraint social_profiles_website_url check (
    website_url is null
    or (
      char_length(website_url) <= 2048
      and website_url ~ '^https?://'
    )
  ),
  constraint social_profiles_location_length check (
    location is null or char_length(location) <= 100
  )
);

comment on table public.social_profiles is
  'Public-facing SautiLink social profiles. Private contact and notification preferences remain in account_profiles.';
comment on column public.social_profiles.username is
  'Server-synchronised public handle. Clients cannot update this column directly.';
comment on column public.social_profiles.avatar_key is
  'Cloudflare R2 object key only; binary media is never stored in Postgres.';
comment on column public.social_profiles.header_key is
  'Cloudflare R2 object key only; binary media is never stored in Postgres.';
comment on column public.social_profiles.is_discoverable is
  'False until the member explicitly completes social-profile onboarding.';

create index social_profiles_discoverable_created_idx
  on public.social_profiles (is_discoverable, created_at desc);

alter table public.social_profiles enable row level security;
alter table public.social_profiles force row level security;

revoke all on table public.social_profiles from anon, authenticated;
grant select on table public.social_profiles to anon, authenticated;
grant update (
  display_name,
  bio,
  avatar_key,
  header_key,
  website_url,
  location,
  is_discoverable
) on table public.social_profiles to authenticated;
grant select, insert, update, delete on table public.social_profiles to service_role;

create policy social_profiles_select_discoverable_or_own
  on public.social_profiles
  for select
  to anon, authenticated
  using (
    is_discoverable
    or (select auth.uid()) = id
  );

create policy social_profiles_update_own
  on public.social_profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create or replace function private.set_social_profile_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger set_social_profile_updated_at
  before update on public.social_profiles
  for each row
  execute function private.set_social_profile_updated_at();

create or replace function private.sync_social_profile_from_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is not null and caller_id <> new.id then
    raise exception 'account profile identity mismatch';
  end if;

  insert into public.social_profiles (id, username, display_name)
  values (new.id, new.username, new.full_name)
  on conflict (id) do update
    set username = excluded.username;

  return new;
end;
$$;

revoke all on function private.sync_social_profile_from_account()
  from public, anon, authenticated;

create trigger sync_social_profile_from_account
  after insert or update of username on public.account_profiles
  for each row
  execute function private.sync_social_profile_from_account();

insert into public.social_profiles (id, username, display_name)
select id, username, full_name
from public.account_profiles
on conflict (id) do update
  set username = excluded.username;
