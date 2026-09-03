begin;

do $phase22$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public'
      and table_name='social_notifications'
      and column_name='circle_id'
  ) then
    raise exception 'PHASE22_NOTIFICATION_CIRCLE_ID_MISSING';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public'
      and tablename='social_circle_members'
      and policyname='social_circle_members_select_phase22'
  ) then
    raise exception 'PHASE22_MEMBER_SELECT_POLICY_MISSING';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public'
      and tablename='social_circle_members'
      and policyname='social_circle_members_delete_phase22'
  ) then
    raise exception 'PHASE22_MEMBER_DELETE_POLICY_MISSING';
  end if;

  if has_function_privilege('authenticated', 'private.sync_phase22_circle_notification()', 'EXECUTE') then
    raise exception 'PHASE22_NOTIFICATION_TRIGGER_DIRECT_EXECUTE_ALLOWED';
  end if;

  if not has_function_privilege('authenticated', 'policy_private.is_phase22_circle_owner(uuid)', 'EXECUTE') then
    raise exception 'PHASE22_OWNER_POLICY_HELPER_UNAVAILABLE';
  end if;

  if exists (
    select 1
    from information_schema.role_table_grants
    where table_schema='public'
      and table_name='social_notifications'
      and grantee='authenticated'
      and privilege_type in ('INSERT','DELETE')
  ) then
    raise exception 'PHASE22_BROWSER_NOTIFICATION_WRITE_PRIVILEGE_PRESENT';
  end if;
end;
$phase22$;

rollback;
