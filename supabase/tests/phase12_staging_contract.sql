begin;

do $$
declare
  expected_tables text[] := array[
    'social_profiles', 'account_settings', 'circles', 'circle_members',
    'follows', 'blocks', 'sautis', 'notifications', 'conversations',
    'messages', 'reports'
  ];
  table_name text;
  policy_count integer;
begin
  foreach table_name in array expected_tables
  loop
    if to_regclass(format('public.%I', table_name)) is null then
      raise exception 'missing table public.%', table_name;
    end if;

    if not exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = table_name
        and c.relrowsecurity
        and c.relforcerowsecurity
    ) then
      raise exception 'RLS is not enabled and forced on public.%', table_name;
    end if;

    select count(*)
      into policy_count
      from pg_policies
      where schemaname = 'public'
        and tablename = table_name;

    if policy_count = 0 then
      raise exception 'public.% has no RLS policies', table_name;
    end if;
  end loop;

  if has_table_privilege('anon', 'public.account_settings', 'SELECT')
     or has_table_privilege('anon', 'public.notifications', 'SELECT')
     or has_table_privilege('anon', 'public.messages', 'SELECT')
     or has_table_privilege('anon', 'public.reports', 'SELECT') then
    raise exception 'anon received access to a private MVP table';
  end if;

  if has_table_privilege('authenticated', 'public.notifications', 'INSERT')
     or has_table_privilege('authenticated', 'public.reports', 'UPDATE')
     or has_table_privilege('authenticated', 'public.conversations', 'UPDATE') then
    raise exception 'authenticated received a server-owned capability';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'enforce_message_sender'
      and not tgisinternal
  ) then
    raise exception 'message sender/block trigger is missing';
  end if;
end;
$$;

rollback;
