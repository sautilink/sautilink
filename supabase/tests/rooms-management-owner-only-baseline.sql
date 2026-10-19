-- Prove the current production trigger contradicts the later staff-review RLS.
begin;
do $$ begin if current_database() not like 'sautilink_rooms_test%' then raise exception 'LOCAL_TEST_DATABASE_REQUIRED'; end if; end $$;
insert into public.social_profiles(id,username) select
 ('b1000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'management_baseline_'||i from generate_series(1,5) i;
insert into public.social_circles(id,owner_id,name,slug,join_policy) values
 ('b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','Management baseline','management-baseline','approval');
insert into public.social_circle_members(circle_id,member_id,member_role) values
 ('b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000002','admin'),
 ('b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000003','moderator');
insert into public.social_circle_join_requests(circle_id,requester_id) values
 ('b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000004');
set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000002',true);
do $$ begin
 begin
  update public.social_circle_join_requests set status='approved' where circle_id='b2000000-0000-4000-8000-000000000001' and requester_id='b1000000-0000-4000-8000-000000000004';
  raise exception 'BASELINE_REPRO_FAILED';
 exception when insufficient_privilege then
  if sqlerrm<>'CIRCLE_APPROVAL_NOT_ALLOWED' then raise; end if;
 end;
 raise notice 'REPRODUCED: admin passes current request RLS but canonical owner-only approval trigger rejects atomically.';
end $$;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000003',true);
do $$ begin
 begin
  update public.social_circle_join_requests set status='approved' where circle_id='b2000000-0000-4000-8000-000000000001' and requester_id='b1000000-0000-4000-8000-000000000004';
  raise exception 'BASELINE_REPRO_FAILED';
 exception when insufficient_privilege then
  if sqlerrm<>'CIRCLE_APPROVAL_NOT_ALLOWED' then raise; end if;
 end;
 raise notice 'REPRODUCED: moderator passes current request RLS but canonical owner-only approval trigger rejects atomically.';
end $$;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
update public.social_circle_join_requests set status='approved' where circle_id='b2000000-0000-4000-8000-000000000001' and requester_id='b1000000-0000-4000-8000-000000000004';
do $$ begin
 if not exists(select from public.social_circle_members where circle_id='b2000000-0000-4000-8000-000000000001' and member_id='b1000000-0000-4000-8000-000000000004') then raise exception 'OWNER_BASELINE_BROKEN'; end if;
 raise notice 'PASS: previous owner approval path remains atomic and creates the member.';
end $$;
rollback;
