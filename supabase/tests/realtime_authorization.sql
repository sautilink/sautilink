begin;
create function pg_temp.expect_realtime_code(expected text, ids_allowed boolean default true)
returns void language plpgsql security invoker as $$
declare value jsonb;
begin
  value := public.dm_realtime_authorize_v1('73000000-0000-4000-8000-000000000010');
  if value->>'code' <> expected or (value->>'allowed')::boolean <> (expected='OK') then
    raise exception 'REALTIME_AUTH_EXPECTED_%_GOT_%',expected,value; end if;
  if value ? 'last_seen_at' or value ? 'activity_status' then raise exception 'REALTIME_PRIVATE_DATA_RETURNED'; end if;
  if not ids_allowed and (value ? 'peer_id' or value ? 'user_id' or value ? 'conversation_id') then
    raise exception 'REALTIME_NONPARTICIPANT_IDENTIFIERS_LEAKED'; end if;
end;
$$;
insert into auth.sessions values
('73000000-0000-4000-8000-000000000011','73000000-0000-4000-8000-000000000001',null),
('73000000-0000-4000-8000-000000000012','73000000-0000-4000-8000-000000000002',now()-interval '1 second'),
('73000000-0000-4000-8000-000000000013','73000000-0000-4000-8000-000000000003',null);
insert into public.dm_conversations values
('73000000-0000-4000-8000-000000000010','73000000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000002');
insert into public.social_member_preferences values
('73000000-0000-4000-8000-000000000001',true),('73000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select set_config('request.jwt.claim.sub','73000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"session_id":"73000000-0000-4000-8000-000000000011"}',true);
select pg_temp.expect_realtime_code('OK');
do $$ begin
  if (select count(*) from public.social_member_preferences) <> 1 then raise exception 'FIXTURE_PEER_PREF_NOT_HIDDEN'; end if;
end; $$;
reset role;
update public.social_member_preferences set activity_status=false where user_id='73000000-0000-4000-8000-000000000002';
set local role authenticated;
select pg_temp.expect_realtime_code('ACTIVITY_STATUS_DISABLED');
reset role;
update public.social_member_preferences set activity_status=true;
update public.social_member_preferences set activity_status=false where user_id='73000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.expect_realtime_code('ACTIVITY_STATUS_DISABLED');
reset role;
update public.social_member_preferences set activity_status=true;
insert into public.social_blocks values ('73000000-0000-4000-8000-000000000002','73000000-0000-4000-8000-000000000001');
set local role authenticated;
do $$ begin
  if (select count(*) from public.social_blocks) <> 0 then raise exception 'FIXTURE_PEER_BLOCK_NOT_HIDDEN'; end if;
end; $$;
select pg_temp.expect_realtime_code('MESSAGING_BLOCKED');
reset role;
delete from public.social_blocks;
insert into public.social_blocks values ('73000000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000002');
set local role authenticated;
select pg_temp.expect_realtime_code('MESSAGING_BLOCKED');
reset role;
delete from public.social_blocks;
delete from public.social_member_preferences where user_id='73000000-0000-4000-8000-000000000002';
set local role authenticated;
select pg_temp.expect_realtime_code('ACTIVITY_STATUS_DISABLED');
select set_config('request.jwt.claim.sub','73000000-0000-4000-8000-000000000003',true);
select set_config('request.jwt.claims','{"session_id":"73000000-0000-4000-8000-000000000013"}',true);
select pg_temp.expect_realtime_code('CONVERSATION_UNAVAILABLE',false);
select set_config('request.jwt.claims','{"session_id":"73000000-0000-4000-8000-000000000011"}',true);
select pg_temp.expect_realtime_code('AUTH_REQUIRED',false);
select set_config('request.jwt.claim.sub','73000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"session_id":"73000000-0000-4000-8000-000000000012"}',true);
select pg_temp.expect_realtime_code('AUTH_REQUIRED',false);
select set_config('request.jwt.claim.sub','73000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"session_id":"not-a-uuid"}',true);
select pg_temp.expect_realtime_code('AUTH_REQUIRED',false);
select set_config('request.jwt.claims','{}',true);
select pg_temp.expect_realtime_code('AUTH_REQUIRED',false);
reset role;
delete from auth.sessions where id='73000000-0000-4000-8000-000000000011';
set local role authenticated;
select set_config('request.jwt.claims','{"session_id":"73000000-0000-4000-8000-000000000011"}',true);
select pg_temp.expect_realtime_code('AUTH_REQUIRED',false);
reset role;
do $$ begin
  if has_function_privilege('anon','public.dm_realtime_authorize_v1(uuid)','execute') then
    raise exception 'REALTIME_ANONYMOUS_RPC_EXECUTE'; end if;
  if has_function_privilege('anon','private.dm_realtime_authorize_v1_privileged(uuid)','execute') then
    raise exception 'REALTIME_ANONYMOUS_HELPER_EXECUTE'; end if;
  if (select prosecdef from pg_proc where oid='public.dm_realtime_authorize_v1(uuid)'::regprocedure) then
    raise exception 'REALTIME_PUBLIC_RPC_IS_DEFINER'; end if;
end; $$;
select 'REALTIME_AUTHORIZATION_SECURITY_PASS' as result;
rollback;
