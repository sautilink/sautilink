do $$ begin if current_database() not like 'sautilink_rooms_test%' then raise exception 'LOCAL_TEST_DATABASE_REQUIRED'; end if; end $$;
set application_name='rooms-production-contract-race-a';
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000002',false);
select id as submission_id from private.room_post_submissions where client_request_id='a4000000-0000-4000-8000-000000000001' \gset
begin;
-- Pause immediately after the exact first lock taken by the real RPC.
select (private.room_approval_room('a2000000-0000-4000-8000-000000000001')).id;
select pg_sleep(2);
set local role authenticated;
select public.room_decide_post_submission('a2000000-0000-4000-8000-000000000001',:'submission_id',
 'a5000000-0000-4000-8000-000000000001',1,'approve');
commit;
