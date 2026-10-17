-- DRAFT ONLY. Not installed and deliberately outside supabase/migrations.
-- Requires owner approval before promotion or execution. No Auth settings change.
-- Email verification, agreement records, existing account exemptions and RLS stay intact.
begin;

alter table private.signup_policy
  add column phone_required boolean not null default false;

comment on column private.signup_policy.phone_required is
  'Server-owned signup policy. False permits verified-email signup without a phone; supplied phones use the existing verification flow.';

create or replace function public.get_signup_requirements()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  member_id uuid := auth.uid();
  required_for_user boolean;
  phone_verified boolean;
  require_phone boolean;
  accepted boolean;
begin
  if member_id is null then
    raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED';
  end if;

  select u.created_at >= p.activated_at, u.phone_confirmed_at is not null, p.phone_required
    into required_for_user, phone_verified, require_phone
    from auth.users u cross join private.signup_policy p
   where u.id = member_id and p.singleton = true;

  if required_for_user is null then
    raise exception using errcode = '42501', message = 'ACCOUNT_NOT_FOUND';
  end if;

  select exists (
    select 1 from private.signup_acceptances a where a.user_id = member_id
  ) into accepted;

  return jsonb_build_object(
    'required', required_for_user,
    'phoneVerified', phone_verified,
    'termsAccepted', accepted,
    'phoneRequired', require_phone
  );
end;
$$;

create or replace function private.require_new_signup_ready()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_at timestamptz;
  account_email text;
  email_confirmed_at timestamptz;
  phone_confirmed_at timestamptz;
  activated_at timestamptz;
  require_phone boolean;
begin
  select u.created_at, u.email, u.email_confirmed_at, u.phone_confirmed_at
    into created_at, account_email, email_confirmed_at, phone_confirmed_at
    from auth.users u where u.id = new.id;
  select p.activated_at, p.phone_required into activated_at, require_phone
    from private.signup_policy p where p.singleton = true;

  -- Email is the mandatory identity for new signup, including trusted inserts.
  -- Keep old-account exemptions and the existing privileged agreement/phone split.
  if created_at >= activated_at and
      (nullif(btrim(account_email), '') is null or email_confirmed_at is null) then
    raise exception using errcode = '42501', message = 'VERIFIED_EMAIL_REQUIRED';
  end if;

  if auth.uid() is distinct from new.id then
    return new;
  end if;

  if created_at >= activated_at then
    if not exists (
      select 1 from private.signup_acceptances a where a.user_id = new.id
    ) then
      raise exception using errcode = '42501', message = 'SIGNUP_TERMS_REQUIRED';
    end if;
    if require_phone and phone_confirmed_at is null then
      raise exception using errcode = '42501', message = 'VERIFIED_PHONE_REQUIRED';
    end if;
  end if;

  return new;
end;
$$;

-- CREATE OR REPLACE preserves the previous function privileges. Assert them
-- explicitly so a migration cannot accidentally make either function public.
revoke all on function public.get_signup_requirements() from public, anon;
grant execute on function public.get_signup_requirements() to authenticated;
revoke all on function private.require_new_signup_ready() from public, anon, authenticated;

commit;
