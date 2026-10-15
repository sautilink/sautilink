do $$ begin if current_database() not like 'sautilink_rooms_test%' then raise exception 'LOCAL_TEST_DATABASE_REQUIRED'; end if; end $$;
update public.social_circles set post_permission='all_members' where id='a2000000-0000-4000-8000-000000000001';
insert into public.social_circle_members(circle_id,member_id,member_role) values
 ('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000002','admin'),
 ('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000003','member') on conflict do nothing;
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000003',false);
set role authenticated;
select public.room_submit_post_for_review('a2000000-0000-4000-8000-000000000001',
 'a4000000-0000-4000-8000-000000000001','Membership race fixture','everyone',null,'[]');
