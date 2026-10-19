do $$ begin if current_database() not like 'sautilink_rooms_test%' then raise exception 'LOCAL_TEST_DATABASE_REQUIRED'; end if; end $$;
set application_name='rooms-production-policy-locker';
begin;
select member_id from public.social_circle_members where circle_id='a2000000-0000-4000-8000-000000000001'
  and member_id='a1000000-0000-4000-8000-000000000003' for update;
select pg_sleep(3);
commit;
