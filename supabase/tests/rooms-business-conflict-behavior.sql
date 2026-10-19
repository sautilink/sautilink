-- Only public synthetic fixtures in an isolated local database; every row rolls back.
begin;
do $$ begin if current_database() not like 'sautilink_rooms_test_conflicts_%' then raise exception 'LOCAL_TEST_DATABASE_REQUIRED'; end if; end $$;
create temp table conflict_checks(label text primary key);
create temp table conflict_results(label text primary key,value jsonb);
grant all on conflict_checks,conflict_results to authenticated;
create function pg_temp.assert_true(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'ASSERTION_FAILED: %',label; end if; insert into conflict_checks values(label); end $$;
create function pg_temp.expect_error(statement text,expected_state text,expected_message text,label text) returns void language plpgsql as $$
begin
 begin execute statement; raise exception 'UNEXPECTED_SUCCESS: %',label;
 exception when others then
  if sqlstate<>expected_state then raise exception 'EXPECTED_SQLSTATE_%_GOT_%: %',expected_state,sqlstate,label; end if;
  if position(expected_message in sqlerrm)=0 then raise exception 'WRONG_CONFLICT_MESSAGE: %',label; end if;
 end;
 insert into conflict_checks values(label);
end $$;
create function pg_temp.actor(n integer) returns void language sql as $$select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-'||lpad(n::text,12,'0'),true)$$;
insert into public.social_profiles(id,username) select ('f1000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'conflict_fixture_'||i from generate_series(1,6)i;
insert into public.social_circles(id,owner_id,name,slug,join_policy,post_approval_required) values
 ('f2000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001','Conflict fixture','conflict-fixture','approval',true);
insert into public.social_circle_members(circle_id,member_id,member_role) values
 ('f2000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000002','admin'),
 ('f2000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000003','member');
select pg_temp.actor(1);
set local role authenticated;
insert into conflict_results values('config',public.room_update_management('f2000000-0000-4000-8000-000000000001',1,'f4000000-0000-4000-8000-000000000001','[]','[]'));
select pg_temp.expect_error($q$select public.room_update_management('f2000000-0000-4000-8000-000000000001',1,gen_random_uuid(),'[]','[]')$q$,'PT409','ROOM_MANAGEMENT_VERSION_CONFLICT','stale settings returns nonretryable409');
select pg_temp.assert_true(public.room_update_management('f2000000-0000-4000-8000-000000000001',1,'f4000000-0000-4000-8000-000000000001','[]','[]')=(select value from conflict_results where label='config'),'lost settings ACK retry preserved');
select pg_temp.assert_true((public.room_management_state('f2000000-0000-4000-8000-000000000001')->>'version')::int=2,'rejected settings did not increment version');
select pg_temp.actor(3);
select pg_temp.expect_error($q$select public.room_update_management('f2000000-0000-4000-8000-000000000001',2,gen_random_uuid(),'[]','[]')$q$,'42501','ROOM_ADMIN_REQUIRED','settings authority denial preserved');
select pg_temp.actor(4);
select pg_temp.expect_error($q$select public.room_submit_membership_request('f2000000-0000-4000-8000-000000000001',1,gen_random_uuid(),'[]','request')$q$,'PT409','ROOM_MANAGEMENT_VERSION_CONFLICT','stale membership config returns409');
insert into conflict_results values('membership',public.room_submit_membership_request('f2000000-0000-4000-8000-000000000001',2,'f4000000-0000-4000-8000-000000000004','[]','request'));
select pg_temp.assert_true(public.room_submit_membership_request('f2000000-0000-4000-8000-000000000001',2,'f4000000-0000-4000-8000-000000000004','[]','request')=(select value from conflict_results where label='membership'),'membership exact retry ACK preserved');
delete from public.social_circle_join_requests where circle_id='f2000000-0000-4000-8000-000000000001' and requester_id=auth.uid();
select pg_temp.expect_error($q$select public.room_submit_membership_request('f2000000-0000-4000-8000-000000000001',2,'f4000000-0000-4000-8000-000000000004','[]','request')$q$,'PT409','MEMBERSHIP_STATE_CHANGED','canceled membership retry returns409');
select pg_temp.assert_true(not exists(select from public.social_circle_join_requests where circle_id='f2000000-0000-4000-8000-000000000001' and requester_id=auth.uid()),'failed retry cannot recreate canceled request');
reset role;
select pg_temp.actor(5);
insert into private.room_membership_answers(room_id,requester_id,config_version,questions,answers,source,admission_transaction) values
 ('f2000000-0000-4000-8000-000000000001',auth.uid(),2,'[]','[]','open',txid_current());
set local role authenticated;
select pg_temp.expect_error($q$insert into public.social_circle_members(circle_id,member_id,member_role) values('f2000000-0000-4000-8000-000000000001',auth.uid(),'member')$q$,'PT409','MEMBERSHIP_STATE_CHANGED','private admission trigger policy recheck returns409');
select pg_temp.actor(3);
insert into conflict_results values('submission',public.room_submit_post_for_review('f2000000-0000-4000-8000-000000000001','f4000000-0000-4000-8000-000000000020','Conflict fixture pending text'));
select pg_temp.expect_error($q$select public.room_withdraw_post_submission('f2000000-0000-4000-8000-000000000001',(select (value->'submission'->>'id')::uuid from conflict_results where label='submission'),gen_random_uuid(),2)$q$,'PT409','VERSION_CONFLICT','stale withdraw returns409');
select pg_temp.actor(1);
select pg_temp.expect_error($q$select public.room_decide_post_submission('f2000000-0000-4000-8000-000000000001',(select (value->'submission'->>'id')::uuid from conflict_results where label='submission'),gen_random_uuid(),2,'reject','Fixture reason')$q$,'PT409','VERSION_CONFLICT','stale decision returns409');
insert into conflict_results values('decision',public.room_decide_post_submission('f2000000-0000-4000-8000-000000000001',(select (value->'submission'->>'id')::uuid from conflict_results where label='submission'),'f4000000-0000-4000-8000-000000000021',1,'reject','Fixture reason'));
select pg_temp.assert_true(public.room_decide_post_submission('f2000000-0000-4000-8000-000000000001',(select (value->'submission'->>'id')::uuid from conflict_results where label='submission'),'f4000000-0000-4000-8000-000000000021',1,'reject','Fixture reason')=(select value from conflict_results where label='decision'),'decision lost ACK exact retry preserved');
select pg_temp.expect_error($q$select public.room_decide_post_submission('f2000000-0000-4000-8000-000000000001',(select (value->'submission'->>'id')::uuid from conflict_results where label='submission'),gen_random_uuid(),2,'reject','Fixture reason')$q$,'PT409','ALREADY_DECIDED','competing decided request returns409');
select pg_temp.actor(3);
select pg_temp.expect_error($q$select public.room_withdraw_post_submission('f2000000-0000-4000-8000-000000000001',(select (value->'submission'->>'id')::uuid from conflict_results where label='submission'),gen_random_uuid(),2)$q$,'PT409','ALREADY_DECIDED','withdraw decided submission returns409');
insert into conflict_results values('withdrawable',public.room_submit_post_for_review('f2000000-0000-4000-8000-000000000001','f4000000-0000-4000-8000-000000000022','Withdrawable fixture'));
insert into conflict_results values('withdraw',public.room_withdraw_post_submission('f2000000-0000-4000-8000-000000000001',(select (value->'submission'->>'id')::uuid from conflict_results where label='withdrawable'),'f4000000-0000-4000-8000-000000000023',1));
select pg_temp.assert_true(public.room_withdraw_post_submission('f2000000-0000-4000-8000-000000000001',(select (value->'submission'->>'id')::uuid from conflict_results where label='withdrawable'),'f4000000-0000-4000-8000-000000000023',1)=(select value from conflict_results where label='withdraw'),'withdraw lost ACK retry preserved');
select pg_temp.actor(1);
insert into public.social_posts(id,author_id,circle_id,visibility,body) values('f3000000-0000-4000-8000-000000000001',auth.uid(),'f2000000-0000-4000-8000-000000000001','circle','Pin fixture');
select public.room_set_post_pin('f2000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000001',true,'f4000000-0000-4000-8000-000000000030');
select public.room_set_post_pin('f2000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000001',false,'f4000000-0000-4000-8000-000000000031');
select pg_temp.expect_error($q$select public.room_set_post_pin('f2000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000001',true,'f4000000-0000-4000-8000-000000000030')$q$,'PT409','ROOM_PIN_CHANGED','stale pin receipt returns409');
select pg_temp.assert_true(not exists(select from public.social_room_pinned_posts where post_id='f3000000-0000-4000-8000-000000000001'),'stale receipt cannot repin');
reset role;
select pg_temp.assert_true((select count(*)=1 from private.room_management_audit where room_id='f2000000-0000-4000-8000-000000000001' and action='config'),'settings retry/conflict creates no duplicate audit');
select pg_temp.assert_true(not has_function_privilege('authenticated','private.enforce_room_membership_questions()','execute'),'private trigger execute remains denied');
select pg_temp.assert_true(not has_function_privilege('anon','public.room_update_management(uuid,integer,uuid,jsonb,jsonb)','execute'),'anonymous write RPC remains denied');
do $$ begin raise notice 'PASS: % actual business-conflict SQLSTATE/state/idempotency/authority checks.',(select count(*) from conflict_checks); end $$;
table conflict_checks;
rollback;
