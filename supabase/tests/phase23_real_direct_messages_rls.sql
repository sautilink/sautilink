begin;

do $phase23$
declare
  conversation_insert_columns text[];
  message_insert_columns text[];
  message_update_columns text[];
begin
  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relname='dm_conversations'
      and c.relrowsecurity
      and c.relforcerowsecurity
  ) then
    raise exception 'PHASE23_CONVERSATION_RLS_NOT_FORCED';
  end if;

  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relname='dm_messages'
      and c.relrowsecurity
      and c.relforcerowsecurity
  ) then
    raise exception 'PHASE23_MESSAGES_RLS_NOT_FORCED';
  end if;

  if exists (
    select 1
    from information_schema.role_table_grants
    where table_schema='public'
      and table_name in ('dm_conversations','dm_messages','dm_conversation_states')
      and grantee='anon'
  ) then
    raise exception 'PHASE23_ANON_DM_PRIVILEGE_PRESENT';
  end if;

  select array_agg(column_name order by column_name)
    into conversation_insert_columns
  from information_schema.column_privileges
  where table_schema='public'
    and table_name='dm_conversations'
    and grantee='authenticated'
    and privilege_type='INSERT';

  if conversation_insert_columns is distinct from array['created_by','member_one_id','member_two_id']::text[] then
    raise exception 'PHASE23_CONVERSATION_INSERT_COLUMNS_UNEXPECTED';
  end if;

  select array_agg(column_name order by column_name)
    into message_insert_columns
  from information_schema.column_privileges
  where table_schema='public'
    and table_name='dm_messages'
    and grantee='authenticated'
    and privilege_type='INSERT';

  if message_insert_columns is distinct from array['body','conversation_id','sender_id']::text[] then
    raise exception 'PHASE23_MESSAGE_INSERT_COLUMNS_UNEXPECTED';
  end if;

  select array_agg(column_name order by column_name)
    into message_update_columns
  from information_schema.column_privileges
  where table_schema='public'
    and table_name='dm_messages'
    and grantee='authenticated'
    and privilege_type='UPDATE';

  if message_update_columns is distinct from array['deleted_at']::text[] then
    raise exception 'PHASE23_MESSAGE_UPDATE_COLUMNS_UNEXPECTED';
  end if;

  if has_table_privilege('authenticated','public.dm_conversation_states','INSERT') then
    raise exception 'PHASE23_BROWSER_STATE_INSERT_ALLOWED';
  end if;

  if not has_function_privilege('authenticated','public.open_dm_conversation_phase23(uuid)','EXECUTE') then
    raise exception 'PHASE23_OPEN_DM_RPC_UNAVAILABLE';
  end if;

  if not has_function_privilege('authenticated','public.dm_inbox_phase23()','EXECUTE') then
    raise exception 'PHASE23_INBOX_RPC_UNAVAILABLE';
  end if;

  if has_function_privilege('authenticated','private.enforce_phase23_dm_message_insert()','EXECUTE')
     or has_function_privilege('authenticated','private.touch_phase23_dm_conversation()','EXECUTE')
     or has_function_privilege('authenticated','private.normalize_phase23_dm_message_delete()','EXECUTE') then
    raise exception 'PHASE23_PRIVATE_TRIGGER_EXECUTE_ALLOWED';
  end if;
end;
$phase23$;

rollback;
