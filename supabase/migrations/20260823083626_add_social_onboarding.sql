-- Phase 1 authentication onboarding boundary.
-- A verified Supabase user can claim exactly one SautiLink account/profile.

alter table public.account_profiles
  drop constraint if exists account_profiles_username_reserved;
alter table public.account_profiles
  add constraint account_profiles_username_reserved check (
    username <> all (array[
      'admin', 'administrator', 'root', 'support', 'security', 'sautilink',
      'cloudengine', 'official', 'api', 'help', 'about', 'settings', 'login',
      'signup', 'account', 'privacy', 'terms', 'contact', 'waitlist'
    ]::text[])
  );

alter table public.social_profiles
  drop constraint if exists social_profiles_username_reserved;
alter table public.social_profiles
  add constraint social_profiles_username_reserved check (
    username <> all (array[
      'admin', 'administrator', 'root', 'support', 'security', 'sautilink',
      'cloudengine', 'official', 'api', 'help', 'about', 'settings', 'login',
      'signup', 'account', 'privacy', 'terms', 'contact', 'waitlist'
    ]::text[])
  );

-- Username changes will use a rate-limited server workflow in the Profiles slice.
-- Until then, clients cannot bypass onboarding by updating the private account row.
revoke update (username) on table public.account_profiles from authenticated;

create or replace function public.complete_social_onboarding(
  p_username text,
  p_display_name text
)
returns public.social_profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  member_id uuid := auth.uid();
  confirmed_at timestamptz;
  requested_username text := lower(regexp_replace(btrim(coalesce(p_username, '')), '^@+', ''));
  requested_display_name text := btrim(coalesce(p_display_name, ''));
  existing_username text;
  completed_profile public.social_profiles;
begin
  if member_id is null then
    raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED';
  end if;

  select email_confirmed_at
    into confirmed_at
    from auth.users
   where id = member_id;

  if confirmed_at is null then
    raise exception using errcode = '42501', message = 'VERIFIED_EMAIL_REQUIRED';
  end if;

  if requested_username !~ '^[a-z0-9][a-z0-9._]{2,29}$' then
    raise exception using errcode = '22023', message = 'INVALID_USERNAME';
  end if;

  if requested_username = any (array[
    'admin', 'administrator', 'root', 'support', 'security', 'sautilink',
    'cloudengine', 'official', 'api', 'help', 'about', 'settings', 'login',
    'signup', 'account', 'privacy', 'terms', 'contact', 'waitlist'
  ]::text[]) then
    raise exception using errcode = '22023', message = 'RESERVED_USERNAME';
  end if;

  if char_length(requested_display_name) not between 1 and 80 then
    raise exception using errcode = '22023', message = 'INVALID_DISPLAY_NAME';
  end if;

  select username
    into existing_username
    from public.account_profiles
   where id = member_id;

  if existing_username is null then
    begin
      insert into public.account_profiles (
        id,
        username,
        full_name,
        email_updates,
        whatsapp_updates
      ) values (
        member_id,
        requested_username,
        requested_display_name,
        false,
        false
      );
    exception
      when unique_violation then
        raise exception using errcode = 'P0001', message = 'USERNAME_TAKEN';
    end;
  elsif existing_username <> requested_username then
    raise exception using errcode = 'P0001', message = 'ACCOUNT_USERNAME_MISMATCH';
  end if;

  insert into public.social_profiles (
    id,
    username,
    display_name,
    is_discoverable
  ) values (
    member_id,
    requested_username,
    requested_display_name,
    true
  )
  on conflict (id) do update
    set display_name = excluded.display_name,
        is_discoverable = true;

  select *
    into completed_profile
    from public.social_profiles
   where id = member_id;

  return completed_profile;
end;
$$;

comment on function public.complete_social_onboarding(text, text) is
  'Completes a verified member social profile without trusting user metadata for authorization.';

revoke all on function public.complete_social_onboarding(text, text)
  from public, anon;
grant execute on function public.complete_social_onboarding(text, text)
  to authenticated, service_role;
