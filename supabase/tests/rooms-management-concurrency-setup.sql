-- Durable synthetic setup only for the bounded two-session runner.
do $$ begin if current_database() not like 'sautilink_rooms_test%' then raise exception 'LOCAL_TEST_DATABASE_REQUIRED'; end if; end $$;
select set_config('request.jwt.claim.sub','',false);
insert into public.social_profiles(id,username) select ('d1000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'management_race_'||i from generate_series(1,8)i on conflict do nothing;
insert into public.social_circles(id,owner_id,name,slug,join_policy) select
 ('d2000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'d1000000-0000-4000-8000-000000000001','Management race '||i,'management-race-'||i,
 case i when 3 then 'approval' else 'open' end from generate_series(1,3)i on conflict do nothing;
delete from private.room_management_receipts where room_id in(select id from public.social_circles where slug like 'management-race-%');
delete from public.social_room_pinned_posts where room_id='d2000000-0000-4000-8000-000000000001';
delete from public.social_circle_join_requests where circle_id in('d2000000-0000-4000-8000-000000000002','d2000000-0000-4000-8000-000000000003');
delete from private.room_membership_answers where room_id in('d2000000-0000-4000-8000-000000000002','d2000000-0000-4000-8000-000000000003');
delete from public.social_circle_members where circle_id in('d2000000-0000-4000-8000-000000000002','d2000000-0000-4000-8000-000000000003') and member_role<>'owner';
update private.room_management_config set version=1,rules='[]',questions='[]' where room_id in('d2000000-0000-4000-8000-000000000002','d2000000-0000-4000-8000-000000000003');
insert into public.social_circle_members(circle_id,member_id,member_role) values
 ('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000002','admin'),
 ('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000004','member') on conflict do nothing;
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',false);
update public.social_circle_members set member_role='admin' where circle_id='d2000000-0000-4000-8000-000000000001' and member_id='d1000000-0000-4000-8000-000000000002';
insert into public.social_posts(id,author_id,circle_id,visibility,body) select
 ('d3000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'d1000000-0000-4000-8000-000000000004',
 'd2000000-0000-4000-8000-000000000001','circle','Management race post '||i from generate_series(1,4)i on conflict do nothing;
select public.room_set_post_pin('d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001',true,'d4000000-0000-4000-8000-000000000001');
select public.room_set_post_pin('d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000002',true,'d4000000-0000-4000-8000-000000000002');
