-- Run after applying migrations to a local or preview database.
-- This file changes no data and fails fast when the Phase 1 boundary drifts.

begin;

do $$
declare
  account_count bigint;
  social_count bigint;
  hidden_count bigint;
begin
  if to_regclass('public.account_profiles') is null then
    raise exception 'account_profiles is missing';
  end if;

  if to_regclass('public.social_profiles') is null then
    raise exception 'social_profiles is missing';
  end if;

  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'social_profiles'
      and c.relrowsecurity
      and c.relforcerowsecurity
  ) then
    raise exception 'social_profiles must enable and force RLS';
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'social_profiles'
      and policyname = 'social_profiles_select_discoverable_or_own'
  ) then
    raise exception 'social profile select policy is missing';
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'social_profiles'
      and policyname = 'social_profiles_update_own'
  ) then
    raise exception 'social profile update policy is missing';
  end if;

  if has_table_privilege('anon', 'public.account_profiles', 'select') then
    raise exception 'anon must not read private account profiles';
  end if;

  if has_column_privilege('authenticated', 'public.social_profiles', 'username', 'update') then
    raise exception 'authenticated users must not update public usernames directly';
  end if;

  if not has_column_privilege('authenticated', 'public.social_profiles', 'bio', 'update') then
    raise exception 'authenticated users must be able to update their own bio';
  end if;

  if has_column_privilege('authenticated', 'public.account_profiles', 'updated_at', 'update') then
    raise exception 'authenticated users must not forge account update timestamps';
  end if;

  select count(*) into account_count from public.account_profiles;
  select count(*) into social_count from public.social_profiles;

  if account_count <> social_count then
    raise exception 'every account profile must have a social profile projection';
  end if;

  set local role anon;
  select count(*) into hidden_count
  from public.social_profiles
  where not is_discoverable;
  reset role;

  if hidden_count <> 0 then
    raise exception 'anon must not read hidden social profiles';
  end if;
end;
$$;

rollback;
