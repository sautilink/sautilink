-- Require new SautiLink accounts to accept the published documents and verify a
-- phone before the existing onboarding RPC can create their member profile.
-- The activation timestamp exempts accounts created before this deployment.
create table private.signup_policy (
  singleton boolean primary key default true check (singleton),
  activated_at timestamptz not null default now()
);
insert into private.signup_policy (singleton) values (true);

create table private.signup_acceptances (
  user_id uuid primary key references auth.users(id) on delete cascade,
  terms_version text not null,
  privacy_version text not null,
  accepted_at timestamptz not null default now()
);

alter table private.signup_policy enable row level security;
alter table private.signup_acceptances enable row level security;
revoke all on private.signup_policy, private.signup_acceptances from public, anon, authenticated;

create function public.get_signup_requirements()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  member_id uuid := auth.uid();
  required_for_user boolean;
  phone_verified boolean;
  accepted boolean;
begin
  if member_id is null then
    raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED';
  end if;

  select u.created_at >= p.activated_at, u.phone_confirmed_at is not null
    into required_for_user, phone_verified
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
    'termsAccepted', accepted
  );
end;
$$;

create function public.accept_signup_terms()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  member_id uuid := auth.uid();
begin
  if member_id is null then
    raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED';
  end if;

  insert into private.signup_acceptances (user_id, terms_version, privacy_version)
  values (member_id, '2026-09-09', '2026-09-09')
  on conflict (user_id) do nothing;
end;
$$;

-- An authenticated client cannot insert into account_profiles directly. This
-- trigger protects the existing security-definer onboarding RPC too.
create function private.require_new_signup_ready()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_at timestamptz;
  phone_confirmed_at timestamptz;
  activated_at timestamptz;
begin
  if auth.uid() is distinct from new.id then
    return new;
  end if;

  select u.created_at, u.phone_confirmed_at
    into created_at, phone_confirmed_at
    from auth.users u where u.id = new.id;
  select p.activated_at into activated_at
    from private.signup_policy p where p.singleton = true;

  if created_at >= activated_at then
    if not exists (
      select 1 from private.signup_acceptances a where a.user_id = new.id
    ) then
      raise exception using errcode = '42501', message = 'SIGNUP_TERMS_REQUIRED';
    end if;
    if phone_confirmed_at is null then
      raise exception using errcode = '42501', message = 'VERIFIED_PHONE_REQUIRED';
    end if;
  end if;

  return new;
end;
$$;

create trigger account_profiles_require_new_signup_ready
before insert on public.account_profiles
for each row execute function private.require_new_signup_ready();

revoke all on function public.get_signup_requirements(), public.accept_signup_terms()
  from public, anon;
grant execute on function public.get_signup_requirements(), public.accept_signup_terms()
  to authenticated;
revoke all on function private.require_new_signup_ready() from public, anon, authenticated;
