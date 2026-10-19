do $$ begin
  if current_database() not like 'sautilink_rooms_test%' then raise exception 'LOCAL_TEST_DATABASE_REQUIRED'; end if;
  if (select count(*) from public.social_posts where circle_id='20000000-0000-4000-8000-000000000071')<>1 or
    (select state from private.room_post_submissions where client_request_id='40000000-0000-4000-8000-000000000071')<>'approved' or
    (select count(*) from private.room_post_decision_audit where room_id='20000000-0000-4000-8000-000000000071' and action in('approved','rejected'))<>1 then
    raise exception 'CONCURRENT_DECISION_ASSERTION_FAILED';
  end if;
end $$;
select 'ROOM_APPROVAL_CONCURRENT_DECISION_PASS';
delete from public.social_profiles where id in('10000000-0000-4000-8000-000000000071','10000000-0000-4000-8000-000000000073','10000000-0000-4000-8000-000000000074');
delete from private.room_post_decision_audit where request_id in('40000000-0000-4000-8000-000000000071','50000000-0000-4000-8000-000000000071');
