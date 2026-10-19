do $$ begin if current_database() not like 'sautilink_rooms_test%' then raise exception 'LOCAL_TEST_DATABASE_REQUIRED'; end if; end $$;
set application_name='rooms-approval-race-a';
select id as submission_id from private.room_post_submissions where client_request_id='40000000-0000-4000-8000-000000000071' \gset
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000073',false);
begin;
select public.room_decide_post_submission('20000000-0000-4000-8000-000000000071',:'submission_id','50000000-0000-4000-8000-000000000071',1,'approve');
select pg_sleep(3);
commit;
