do $$ begin if current_database() not like 'sautilink_rooms_test%' then raise exception 'LOCAL_TEST_DATABASE_REQUIRED'; end if; end $$;
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',false);
set role authenticated;
update public.social_circles set post_permission='staff_only' where id='a2000000-0000-4000-8000-000000000001';
