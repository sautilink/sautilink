-- Run after add_social_onboarding on a local or preview database.

begin;

do $$
declare
  function_is_definer boolean;
  function_config text[];
  account_reserved_definition text;
  social_reserved_definition text;
begin
  if to_regprocedure('public.complete_social_onboarding(text,text)') is null then
    raise exception 'complete_social_onboarding is missing';
  end if;

  select prosecdef, proconfig
    into function_is_definer, function_config
    from pg_proc
   where oid = 'public.complete_social_onboarding(text,text)'::regprocedure;

  if not function_is_definer then
    raise exception 'onboarding must use its verified security-definer boundary';
  end if;

  if function_config is null or not ('search_path=""' = any (function_config)) then
    raise exception 'onboarding function must use an empty search_path';
  end if;

  if has_function_privilege('anon', 'public.complete_social_onboarding(text,text)', 'execute') then
    raise exception 'anon must not execute social onboarding';
  end if;

  if not has_function_privilege('authenticated', 'public.complete_social_onboarding(text,text)', 'execute') then
    raise exception 'authenticated members must execute social onboarding';
  end if;

  if has_table_privilege('authenticated', 'public.account_profiles', 'insert') then
    raise exception 'authenticated members must not bypass onboarding with direct account inserts';
  end if;

  if has_table_privilege('authenticated', 'public.social_profiles', 'insert') then
    raise exception 'authenticated members must not bypass onboarding with direct social-profile inserts';
  end if;

  if has_column_privilege('authenticated', 'public.account_profiles', 'username', 'update') then
    raise exception 'authenticated members must not change usernames outside the server workflow';
  end if;

  select pg_get_constraintdef(oid)
    into account_reserved_definition
    from pg_constraint
   where conrelid = 'public.account_profiles'::regclass
     and conname = 'account_profiles_username_reserved';

  select pg_get_constraintdef(oid)
    into social_reserved_definition
    from pg_constraint
   where conrelid = 'public.social_profiles'::regclass
     and conname = 'social_profiles_username_reserved';

  if account_reserved_definition not ilike '%privacy%'
     or social_reserved_definition not ilike '%waitlist%' then
    raise exception 'reserved route names must be protected in both profile tables';
  end if;
end;
$$;

rollback;
