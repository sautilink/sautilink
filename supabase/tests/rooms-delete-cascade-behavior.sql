-- Local canonical Rooms fixture only. Every test/data/policy addition rolls back.
-- Media rows below are synthetic metadata; this does not test R2 byte cleanup.
begin;
do $$ begin if current_database() <> 'sautilink_rooms_test_delete_cascade_20261016' then
 raise exception 'EXPECTED_ISOLATED_CASCADE_DATABASE_REQUIRED'; end if; end $$;
-- final4 omits the original owner DELETE policy. Restore its exact canonical
-- predicate in this test transaction, not in the product migration.
do $$ begin if not exists(select from pg_policies where schemaname='public'
 and tablename='social_circles' and policyname='social_circles_delete_phase20') then
 execute 'create policy social_circles_delete_phase20 on public.social_circles for delete to authenticated using ((select auth.uid()) = owner_id)';
end if; end $$;
create temporary table cascade_checks(label text primary key);
grant all on cascade_checks to authenticated;
create function pg_temp.check_true(ok boolean,label text) returns void language plpgsql security invoker as $$
begin if ok is distinct from true then raise exception 'ASSERTION_FAILED: %',label; end if;
 insert into cascade_checks values(label); end $$;
create function pg_temp.expect_rows(statement text,expected integer,label text) returns void language plpgsql security invoker as $$
declare n integer; begin execute statement; get diagnostics n=row_count;
 perform pg_temp.check_true(n=expected,label); end $$;
create function pg_temp.expect_error(statement text,expected text,label text) returns void language plpgsql security invoker as $$
begin begin execute statement; raise exception 'UNEXPECTED_SUCCESS: %',label;
 exception when others then if position(expected in sqlerrm)=0 then raise; end if; end;
 insert into cascade_checks values(label); end $$;
create function pg_temp.actor(n integer) returns void language sql security invoker as $$
 select set_config('request.jwt.claim.sub','9f100000-0000-4000-8000-'||lpad(n::text,12,'0'),true); $$;
select set_config('request.jwt.claim.sub','',true);
insert into public.social_profiles(id,username) select
 ('9f100000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'delete_cascade_fixture_'||i from generate_series(1,12)i;
insert into public.social_circles(id,owner_id,name,slug,join_policy,post_approval_required) select
 ('9f200000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 ('9f100000-0000-4000-8000-'||lpad((case when i=4 then 9 else 1 end)::text,12,'0'))::uuid,
 'Delete cascade fixture '||i,'delete-cascade-fixture-'||i,'open',i in(2,3,4,6)
 from generate_series(1,6)i;
insert into public.social_circle_members(circle_id,member_id,member_role) select
 ('9f200000-0000-4000-8000-'||lpad(r::text,12,'0'))::uuid,
 ('9f100000-0000-4000-8000-'||lpad(m::text,12,'0'))::uuid,
 case m when 2 then 'admin' else 'member' end
 from generate_series(1,4)r cross join unnest(array[2,4])m;
insert into public.social_circle_members(circle_id,member_id,member_role) select
 '9f200000-0000-4000-8000-000000000005',
 ('9f100000-0000-4000-8000-'||lpad(m::text,12,'0'))::uuid,
 case when m in(2,6) then 'admin' when m in(3,7) then 'moderator' else 'member' end
 from unnest(array[2,3,4,5,6,7,10])m;
insert into public.social_circle_members(circle_id,member_id,member_role) values
 ('9f200000-0000-4000-8000-000000000006','9f100000-0000-4000-8000-000000000002','admin'),
 ('9f200000-0000-4000-8000-000000000006','9f100000-0000-4000-8000-000000000010','member');
insert into public.social_post_media(id,owner_id,object_key,media_kind,content_type,size_bytes,width,height,duration_ms) select
 ('9f300000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 ('9f100000-0000-4000-8000-'||lpad((case when i>6 then 10 else 4 end)::text,12,'0'))::uuid,
 'synthetic-delete-cascade-'||i,case when i%2=1 then 'image' else 'video' end,
 case when i%2=1 then 'image/jpeg' else 'video/mp4' end,128,64,64,case when i%2=0 then 5000 else null end
 from generate_series(1,8)i;
create temporary table cascade_submissions(room_no integer primary key,response jsonb);
grant all on cascade_submissions to authenticated;
select pg_temp.actor(4);
set local role authenticated;
insert into cascade_submissions select r,public.room_submit_post_for_review(
 ('9f200000-0000-4000-8000-'||lpad(r::text,12,'0'))::uuid,
 ('9f400000-0000-4000-8000-'||lpad(r::text,12,'0'))::uuid,'Synthetic image/video delete fixture','everyone',null,
 jsonb_build_array(jsonb_build_object('id',('9f300000-0000-4000-8000-'||lpad((2*r-3)::text,12,'0'))),
 jsonb_build_object('id',('9f300000-0000-4000-8000-'||lpad((2*r-2)::text,12,'0'))))) from generate_series(2,4)r;
select pg_temp.actor(10);
insert into cascade_submissions values(6,public.room_submit_post_for_review(
 '9f200000-0000-4000-8000-000000000006','9f400000-0000-4000-8000-000000000006','Synthetic author delete fixture','everyone',null,
 '[{"id":"9f300000-0000-4000-8000-000000000007"},{"id":"9f300000-0000-4000-8000-000000000008"}]'));
select pg_temp.actor(2);
select pg_temp.check_true(public.room_decide_post_submission('9f200000-0000-4000-8000-000000000002',
 (select (response->'submission'->>'id')::uuid from cascade_submissions where room_no=2),
 '9f500000-0000-4000-8000-000000000002',1,'approve')->'submission'->>'state'='approved','real approval before Room deletion');
reset role;
select pg_temp.check_true((select count(*)=0 from private.room_post_submission_media where media_id in
 ('9f300000-0000-4000-8000-000000000001','9f300000-0000-4000-8000-000000000002')),'approved media holds already consumed');
select pg_temp.check_true((select count(*)=6 from private.room_post_submission_media where media_id::text like '9f300000-%'),'pending photo and video holds established');

-- Regression target: these all failed ROOM_MEMBER_REMOVAL_FORBIDDEN before fix.
select pg_temp.actor(1);
set local role authenticated;
select pg_temp.expect_rows($q$delete from public.social_circles where id='9f200000-0000-4000-8000-000000000001'$q$,1,'owner deletes plain three-member Room');
select pg_temp.expect_rows($q$delete from public.social_circles where id='9f200000-0000-4000-8000-000000000002'$q$,1,'owner deletes approved photo/video Room');
select pg_temp.expect_rows($q$delete from public.social_circles where id='9f200000-0000-4000-8000-000000000003'$q$,1,'owner deletes pending photo/video Room');
reset role;
select pg_temp.check_true(not exists(select from public.social_circle_members where circle_id in
 ('9f200000-0000-4000-8000-000000000001','9f200000-0000-4000-8000-000000000002','9f200000-0000-4000-8000-000000000003')),'deleted Rooms leave no memberships');
select pg_temp.check_true(not exists(select from public.social_posts where circle_id='9f200000-0000-4000-8000-000000000002'),'approved published post cascades with Room');
select pg_temp.check_true(not exists(select from public.social_post_media where id in
 ('9f300000-0000-4000-8000-000000000001','9f300000-0000-4000-8000-000000000002')),'approved attached metadata cascades with published post');
select pg_temp.check_true(not exists(select from private.room_post_submissions where room_id in
 ('9f200000-0000-4000-8000-000000000002','9f200000-0000-4000-8000-000000000003')),'deleted Rooms leave no approved or pending queue');
select pg_temp.check_true(not exists(select from private.room_post_submission_media where media_id in
 ('9f300000-0000-4000-8000-000000000003','9f300000-0000-4000-8000-000000000004')),'pending Room deletion releases both holds');
select pg_temp.check_true((select count(*)=2 from public.social_post_media where id in
 ('9f300000-0000-4000-8000-000000000003','9f300000-0000-4000-8000-000000000004') and post_id is null and upload_status='ready'),'pending Room deletion preserves author ready unattached uploads');

-- Parent-present policies/hierarchy must retain their exact previous behavior.
select pg_temp.actor(4);
set local role authenticated;
select pg_temp.expect_rows($q$delete from public.social_circles where id='9f200000-0000-4000-8000-000000000005'$q$,0,'ordinary member cannot delete Room');
select pg_temp.expect_rows($q$delete from public.social_circle_members where circle_id='9f200000-0000-4000-8000-000000000005' and member_id='9f100000-0000-4000-8000-000000000005'$q$,0,'ordinary member cannot remove another member');
select set_config('sautilink.room_deleted','true',true);
select pg_temp.expect_rows($q$delete from public.social_circle_members where circle_id='9f200000-0000-4000-8000-000000000005' and member_id='9f100000-0000-4000-8000-000000000005'$q$,0,'forged GUC cannot authorize member removal');
select pg_temp.expect_rows($q$delete from public.social_circle_members where circle_id='9f200000-0000-4000-8000-000000000099'$q$,0,'nonexistent Room identity grants no deletion');
select pg_temp.actor(8);
select pg_temp.expect_rows($q$delete from public.social_circles where id='9f200000-0000-4000-8000-000000000005'$q$,0,'outsider cannot delete Room');
select pg_temp.expect_rows($q$delete from public.social_circle_members where circle_id='9f200000-0000-4000-8000-000000000005' and member_id='9f100000-0000-4000-8000-000000000005'$q$,0,'outsider cannot remove member');
select pg_temp.actor(2);
select pg_temp.expect_rows($q$delete from public.social_circles where id='9f200000-0000-4000-8000-000000000005'$q$,0,'admin cannot delete Room');
select pg_temp.expect_error($q$delete from public.social_circle_members where circle_id='9f200000-0000-4000-8000-000000000005' and member_id='9f100000-0000-4000-8000-000000000006'$q$,'ROOM_MEMBER_REMOVAL_FORBIDDEN','admin cannot remove peer admin');
select pg_temp.expect_error($q$update public.social_circle_members set member_role='member' where circle_id='9f200000-0000-4000-8000-000000000005' and member_id='9f100000-0000-4000-8000-000000000006'$q$,'ROOM_ADMIN_CANNOT_MANAGE_ADMIN','peer admin role protection unchanged');
select pg_temp.expect_error($q$update public.social_circle_members set circle_id='9f200000-0000-4000-8000-000000000006' where circle_id='9f200000-0000-4000-8000-000000000005' and member_id='9f100000-0000-4000-8000-000000000006'$q$,'permission denied','membership identity update remains unavailable');
reset role;
insert into public.social_blocks values('9f100000-0000-4000-8000-000000000001','9f100000-0000-4000-8000-000000000002');
set local role authenticated;
select pg_temp.check_true(not exists(select from public.social_circles where id='9f200000-0000-4000-8000-000000000005'),'blocked admin cannot see parent through RLS');
select pg_temp.expect_error($q$delete from public.social_circle_members where circle_id='9f200000-0000-4000-8000-000000000005' and member_id='9f100000-0000-4000-8000-000000000006'$q$,'ROOM_MEMBER_REMOVAL_FORBIDDEN','RLS-hidden parent cannot forge physical cascade absence');
reset role;
delete from public.social_blocks where blocker_id='9f100000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.actor(3);
select pg_temp.expect_rows($q$delete from public.social_circles where id='9f200000-0000-4000-8000-000000000005'$q$,0,'moderator cannot delete Room');
select pg_temp.expect_error($q$delete from public.social_circle_members where circle_id='9f200000-0000-4000-8000-000000000005' and member_id='9f100000-0000-4000-8000-000000000002'$q$,'ROOM_MEMBER_REMOVAL_FORBIDDEN','moderator cannot remove admin');
select pg_temp.expect_error($q$delete from public.social_circle_members where circle_id='9f200000-0000-4000-8000-000000000005' and member_id='9f100000-0000-4000-8000-000000000007'$q$,'ROOM_MEMBER_REMOVAL_FORBIDDEN','moderator cannot remove peer moderator');
select pg_temp.expect_rows($q$delete from public.social_circle_members where circle_id='9f200000-0000-4000-8000-000000000005' and member_id='9f100000-0000-4000-8000-000000000005'$q$,1,'moderator may remove ordinary member');
select pg_temp.actor(2);
select pg_temp.expect_rows($q$delete from public.social_circle_members where circle_id='9f200000-0000-4000-8000-000000000005' and member_id='9f100000-0000-4000-8000-000000000007'$q$,1,'admin may remove moderator');
select pg_temp.actor(1);
select pg_temp.expect_rows($q$delete from public.social_circle_members where circle_id='9f200000-0000-4000-8000-000000000005' and member_id=auth.uid()$q$,0,'owner membership remains directly undeletable');
select pg_temp.expect_error($q$update public.social_circle_members set member_role='member' where circle_id='9f200000-0000-4000-8000-000000000005' and member_id=auth.uid()$q$,'ROOM_OWNER_ROLE_IMMUTABLE','owner role remains immutable');
select pg_temp.expect_rows($q$delete from public.social_circle_members where circle_id='9f200000-0000-4000-8000-000000000005' and member_id='9f100000-0000-4000-8000-000000000006'$q$,1,'owner may remove admin');
select pg_temp.actor(4);
select pg_temp.expect_rows($q$delete from public.social_circle_members where circle_id='9f200000-0000-4000-8000-000000000005' and member_id=auth.uid()$q$,1,'ordinary member self leave preserved');
reset role;
select pg_temp.check_true((select member_count=(select count(*) from public.social_circle_members where circle_id=r.id) from public.social_circles r where id='9f200000-0000-4000-8000-000000000005'),'existing member-count trigger remains correct');

-- Simulate trusted account-deletion service SQL with the real departing auth UID.
-- No additional client DELETE grant/policy is introduced for social_profiles.
select pg_temp.actor(9);
delete from public.social_profiles where id='9f100000-0000-4000-8000-000000000009';
select pg_temp.check_true(not exists(select from public.social_circles where id='9f200000-0000-4000-8000-000000000004'),'owner profile deletion cascades multi-member Room');
select pg_temp.check_true(not exists(select from private.room_post_submission_media where media_id in
 ('9f300000-0000-4000-8000-000000000005','9f300000-0000-4000-8000-000000000006')),'owner profile Room cascade releases other author holds');
select pg_temp.check_true((select count(*)=2 from public.social_post_media where id in
 ('9f300000-0000-4000-8000-000000000005','9f300000-0000-4000-8000-000000000006') and post_id is null and upload_status='ready'),'owner profile Room cascade preserves other author uploads');
select pg_temp.actor(10);
delete from public.social_profiles where id='9f100000-0000-4000-8000-000000000010';
select pg_temp.check_true(not exists(select from private.room_post_submissions where author_id='9f100000-0000-4000-8000-000000000010'),'author profile deletion releases authored queue');
select pg_temp.check_true(not exists(select from public.social_post_media where id in
 ('9f300000-0000-4000-8000-000000000007','9f300000-0000-4000-8000-000000000008')),'author profile deletion cascades own pending upload metadata');
select pg_temp.check_true(exists(select from public.social_circles where id='9f200000-0000-4000-8000-000000000006'),'nonowner account deletion preserves Room');
select pg_temp.check_true((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid='private.enforce_room_member_removal()'::regprocedure),'guard remains definer with empty search path');
select pg_temp.check_true(not has_function_privilege('authenticated','private.enforce_room_member_removal()','execute')
 and not has_function_privilege('anon','private.enforce_room_member_removal()','execute'),'trigger function cannot be invoked by API roles');
select count(*) as cascade_behavior_checks_passed from cascade_checks;
table cascade_checks;
rollback;
