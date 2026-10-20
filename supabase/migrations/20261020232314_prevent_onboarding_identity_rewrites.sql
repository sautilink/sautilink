-- Onboarding creates identity once. Existing identities must use the audited,
-- rate-limited identity workflow, including when a signup request is retried.
begin;

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
  account_row public.account_profiles%rowtype;
  completed_profile public.social_profiles;
begin
  if member_id is null then
    raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED';
  end if;

  -- Serialize signup retries for this user without relying on caller metadata.
  select email_confirmed_at into confirmed_at
  from auth.users where id = member_id for update;
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

  select * into account_row from public.account_profiles where id = member_id;
  if found and account_row.username <> requested_username then
    raise exception using errcode = 'P0001', message = 'ACCOUNT_USERNAME_MISMATCH';
  end if;

  select * into completed_profile from public.social_profiles where id = member_id;
  if found then
    -- Do not rewrite the name, username, verification or discoverability.
    return completed_profile;
  end if;

  if account_row.id is null then
    begin
      insert into public.account_profiles (
        id, username, full_name, email_updates, whatsapp_updates
      ) values (
        member_id, requested_username, requested_display_name, false, false
      ) returning * into account_row;
    exception when unique_violation then
      raise exception using errcode = 'P0001', message = 'USERNAME_TAKEN';
    end;
  end if;

  -- Repair a missing social bootstrap using the existing authoritative account
  -- identity. The account insert trigger may already have created this profile.
  insert into public.social_profiles (id, username, display_name, is_discoverable)
  values (member_id, account_row.username, account_row.full_name, true)
  on conflict (id) do nothing;

  select * into completed_profile from public.social_profiles where id = member_id;
  return completed_profile;
end;
$$;

comment on function public.complete_social_onboarding(text, text) is
  'Creates a verified-email member identity once; retries return the existing profile without changing identity or visibility.';
revoke all on function public.complete_social_onboarding(text, text) from public, anon;
grant execute on function public.complete_social_onboarding(text, text) to authenticated, service_role;

commit;
