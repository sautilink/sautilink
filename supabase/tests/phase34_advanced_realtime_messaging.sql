begin;

do $$
declare
  policy_count integer;
  trigger_count integer;
  function_count integer;
  unsafe_execute_count integer;
begin
  select count(*) into policy_count
  from pg_policies
  where schemaname = 'realtime'
    and tablename = 'messages'
    and policyname in ('dm_realtime_receive_phase34', 'dm_realtime_send_phase34');

  if policy_count <> 2 then
    raise exception 'PHASE34_REALTIME_POLICY_COUNT_FAILED:%', policy_count;
  end if;

  select count(*) into trigger_count
  from pg_trigger
  where tgname in ('dm_messages_realtime_phase34', 'dm_conversation_states_realtime_phase34')
    and not tgisinternal;

  if trigger_count <> 2 then
    raise exception 'PHASE34_REALTIME_TRIGGER_COUNT_FAILED:%', trigger_count;
  end if;

  select count(*) into function_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private'
    and p.proname in ('broadcast_dm_message_phase34', 'broadcast_dm_state_phase34')
    and p.prosecdef = true;

  if function_count <> 2 then
    raise exception 'PHASE34_REALTIME_FUNCTION_COUNT_FAILED:%', function_count;
  end if;

  select count(*) into unsafe_execute_count
  from information_schema.routine_privileges
  where routine_schema = 'private'
    and routine_name in ('broadcast_dm_message_phase34', 'broadcast_dm_state_phase34')
    and grantee in ('PUBLIC', 'anon', 'authenticated')
    and privilege_type = 'EXECUTE';

  if unsafe_execute_count <> 0 then
    raise exception 'PHASE34_PRIVATE_FUNCTION_EXECUTE_LEAK:%', unsafe_execute_count;
  end if;

  raise notice 'PHASE34_REALTIME_SCHEMA_PASS';
end
$$;

rollback;
