do $$ begin if current_database() not like 'sautilink_rooms_test%' then raise exception 'LOCAL_TEST_DATABASE_REQUIRED'; end if; end $$;
select id as submission_id from private.room_post_submissions where client_request_id='40000000-0000-4000-8000-000000000071' \gset
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000071',false);
select public.room_decide_post_submission('20000000-0000-4000-8000-000000000071',:'submission_id','50000000-0000-4000-8000-000000000072',1,'reject','Concurrent rejection');
-- Expected failure: ALREADY_DECIDED; execute with ON_ERROR_STOP=1.
