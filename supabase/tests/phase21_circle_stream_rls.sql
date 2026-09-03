begin;

do $phase21$
declare
  view_sql text;
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'social_posts'
      and policyname = 'social_posts_select_phase21_authenticated'
  ) then
    raise exception 'PHASE21_SELECT_POLICY_MISSING';
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'social_posts'
      and policyname = 'social_posts_insert_phase21_own'
  ) then
    raise exception 'PHASE21_INSERT_POLICY_MISSING';
  end if;

  select pg_get_viewdef('public.social_stream_events'::regclass, true)
  into view_sql;

  if view_sql not ilike '%circle_id IS NULL%'
     or view_sql not ilike '%visibility = ''public''%' then
    raise exception 'CIRCLE_CONTENT_CAN_REACH_HOME_STREAM';
  end if;

  if exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'social_posts'
      and grantee = 'anon'
      and privilege_type <> 'SELECT'
  ) then
    raise exception 'ANON_POST_WRITE_PRIVILEGE_PRESENT';
  end if;

  if exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'social_posts'
      and grantee = 'authenticated'
      and privilege_type = 'UPDATE'
  ) then
    raise exception 'AUTHENTICATED_POST_UPDATE_PRIVILEGE_PRESENT';
  end if;

  if has_function_privilege(
    'authenticated',
    'private.sync_phase19_notification()',
    'EXECUTE'
  ) then
    raise exception 'NOTIFICATION_TRIGGER_DIRECT_EXECUTE_ALLOWED';
  end if;
end;
$phase21$;

rollback;
