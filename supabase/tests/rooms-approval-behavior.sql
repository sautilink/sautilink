-- Run only after rooms-approval-local-bootstrap.sql + new migration on an empty,
-- disposable local database. Uses public synthetic UUID fixtures; rolls back.
begin;
do $$ begin if current_database() not like 'sautilink_rooms_test%' then raise exception 'LOCAL_TEST_DATABASE_REQUIRED'; end if; end $$;
create function pg_temp.check_true(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'ASSERTION_FAILED: %',label; end if; end $$;
insert into public.social_profiles(id,username) select ('10000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'room_qa_'||i from generate_series(1,6) i;
insert into public.social_circles(id,owner_id,name,slug) values
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Approval fixture','approval-fixture'),
 ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000006','Other room','other-room');
insert into public.social_circle_members(circle_id,member_id,member_role)
 select '20000000-0000-4000-8000-000000000001',('10000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
   case i when 1 then 'owner' when 2 then 'admin' when 3 then 'moderator' else 'member' end from generate_series(1,5) i;
insert into public.social_circle_members values('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000006','owner');
insert into public.social_post_media(id,owner_id,object_key,media_kind,content_type,size_bytes) values
 ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000004','fixture/image.jpg','image','image/jpeg',42),
 ('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000004','fixture/image2.jpg','image','image/jpeg',43);
create temporary table fixture_result(name text primary key,result jsonb);
grant all on fixture_result to authenticated;
select pg_temp.check_true(not (select post_approval_required from public.social_circles where id='20000000-0000-4000-8000-000000000001'),'default OFF');
select pg_temp.check_true(not has_table_privilege('authenticated','private.room_post_submissions','select'),'private table ungranted');
select pg_temp.check_true(not has_schema_privilege('authenticated','private','usage'),'private schema ungranted');
select pg_temp.check_true(not has_function_privilege('anon','public.room_post_approval_capabilities()','execute'),'anon RPC denied');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',true);
set local role authenticated;
insert into public.social_posts(author_id,circle_id,visibility,body) values(auth.uid(),'20000000-0000-4000-8000-000000000001','circle','Existing OFF post');
select pg_temp.check_true((public.room_post_approval_capabilities()->>'post_approval')::boolean,'authenticated capability');
reset role;
update public.social_circles set post_approval_required=true where id='20000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$ begin
  begin insert into public.social_posts(author_id,circle_id,visibility,body) values(auth.uid(),'20000000-0000-4000-8000-000000000001','circle','Bypass');
    raise exception 'UNEXPECTED_SUCCESS'; exception when insufficient_privilege then
    if sqlerrm not like '%ROOM_POST_APPROVAL_REQUIRED%' then raise; end if; end;
end $$;
insert into fixture_result values('approved',public.room_submit_post_for_review('20000000-0000-4000-8000-000000000001',
 '40000000-0000-4000-8000-000000000001','Pending image','everyone',null,'[{"id":"30000000-0000-4000-8000-000000000001","alt_text":"QA image"}]'));
select pg_temp.check_true((select result->'submission'->>'state'='pending' from fixture_result where name='approved'),'pending response');
select pg_temp.check_true((select count(*)=1 from public.social_posts),'pending absent published storage');
select pg_temp.check_true(jsonb_array_length(public.room_list_post_submissions('20000000-0000-4000-8000-000000000001')->'submissions')=1,'author mine');
select pg_temp.check_true(public.room_submit_post_for_review('20000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',
 'Pending image','everyone',null,'[{"id":"30000000-0000-4000-8000-000000000001","alt_text":"QA image"}]')=(select result from fixture_result where name='approved'),'lost202 exact retry');
do $$ begin
  begin perform public.room_submit_post_for_review('20000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','Changed',
    'everyone',null,'[{"id":"30000000-0000-4000-8000-000000000001","alt_text":"QA image"}]');
    raise exception 'UNEXPECTED_SUCCESS'; exception when unique_violation then null; end;
  begin delete from public.social_post_media where id='30000000-0000-4000-8000-000000000001'; raise exception 'UNEXPECTED_SUCCESS';
    exception when insufficient_privilege then if sqlerrm not like '%MEDIA_HELD_FOR_ROOM_REVIEW%' then raise; end if; end;
  begin update public.social_post_media set width=10 where id='30000000-0000-4000-8000-000000000001'; raise exception 'UNEXPECTED_SUCCESS';
    exception when insufficient_privilege then if sqlerrm not like '%MEDIA_HELD_FOR_ROOM_REVIEW%' then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000005',true);
select pg_temp.check_true(jsonb_array_length(public.room_list_post_submissions('20000000-0000-4000-8000-000000000001')->'submissions')=0,'other member cannot read mine');
do $$ begin
  begin perform public.room_get_post_submission('20000000-0000-4000-8000-000000000001',(select (result->'submission'->>'id')::uuid from fixture_result where name='approved'));
    raise exception 'UNEXPECTED_SUCCESS'; exception when no_data_found then null; end;
  begin perform public.room_list_post_submissions('20000000-0000-4000-8000-000000000001','staff'); raise exception 'UNEXPECTED_SUCCESS';
    exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
select pg_temp.check_true(jsonb_array_length(public.room_list_post_submissions('20000000-0000-4000-8000-000000000001','staff')->'submissions')=1,'mod queue');
insert into fixture_result values('decision',public.room_decide_post_submission('20000000-0000-4000-8000-000000000001',
 (select (result->'submission'->>'id')::uuid from fixture_result where name='approved'),'50000000-0000-4000-8000-000000000001',1,'approve'));
select pg_temp.check_true((select result->'submission'->>'state'='approved' from fixture_result where name='decision'),'approved state');
select pg_temp.check_true(public.room_decide_post_submission('20000000-0000-4000-8000-000000000001',
 (select (result->'submission'->>'id')::uuid from fixture_result where name='approved'),'50000000-0000-4000-8000-000000000001',1,'approve')=
 (select result from fixture_result where name='decision'),'decision retry idempotent');
do $$ begin
  begin perform public.room_decide_post_submission('20000000-0000-4000-8000-000000000001',
    (select (result->'submission'->>'id')::uuid from fixture_result where name='approved'),'50000000-0000-4000-8000-000000000002',1,'reject','Competing decision');
    raise exception 'UNEXPECTED_SUCCESS'; exception when serialization_failure then null; end;
end $$;
reset role;
select pg_temp.check_true((select count(*)=2 from public.social_posts),'exactly one approved post');
select pg_temp.check_true((select author_id='10000000-0000-4000-8000-000000000004' and media_count=1 from public.social_posts where body='Pending image'),'original author preserved');
select pg_temp.check_true((select upload_status='attached' and alt_text='QA image' and post_id is not null from public.social_post_media where id='30000000-0000-4000-8000-000000000001'),'atomic media attachment');
select pg_temp.check_true((select count(*)=0 from private.room_post_submission_media),'approved holds consumed');
select pg_temp.check_true((select count(*)=1 from private.room_post_decision_audit where action='approved'),'one approval audit');
select pg_temp.check_true((select count(*)=1 from public.social_notifications where circle_event='post_approved'),'one author notice');
select pg_temp.check_true((select count(*)=0 from public.social_notifications where circle_event='post_approval_requested'),'stale staff notices removed');
-- A public Room's published posts still require membership. Neither approval
-- nor the queue changes existing post SELECT/Room visibility semantics.
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000006',true);
set local role authenticated;
select pg_temp.check_true((select count(*)=0 from public.social_posts),'public Room stream remains member-only');
do $$ begin
  begin perform public.room_get_post_submission('20000000-0000-4000-8000-000000000001',(select (result->'submission'->>'id')::uuid from fixture_result where name='approved'));
    raise exception 'UNEXPECTED_SUCCESS'; exception when no_data_found then null; end;
end $$;
reset role;
-- Reject preserves no published row and releases media for the original owner.
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',true);
set local role authenticated;
update public.social_circles set post_approval_required=false where id='20000000-0000-4000-8000-000000000001';
select pg_temp.check_true((select post_approval_required from public.social_circles where id='20000000-0000-4000-8000-000000000001'),'member cannot change approval flag');
insert into fixture_result values('reject',public.room_submit_post_for_review('20000000-0000-4000-8000-000000000001',
 '40000000-0000-4000-8000-000000000004','Reject image','everyone',null,'[{"id":"30000000-0000-4000-8000-000000000002"}]'));
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
select public.room_decide_post_submission('20000000-0000-4000-8000-000000000001',
 (select (result->'submission'->>'id')::uuid from fixture_result where name='reject'),'50000000-0000-4000-8000-000000000004',1,'reject','Fixture rejection');
reset role;
select pg_temp.check_true((select count(*)=2 from public.social_posts),'rejected absent published storage');
select pg_temp.check_true((select count(*)=0 from private.room_post_submission_media),'reject holds released');
select pg_temp.check_true((select count(*)=1 from public.social_notifications where circle_event='post_rejected'),'reject notice');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',true);
set local role authenticated;
insert into fixture_result values('withdraw',public.room_submit_post_for_review('20000000-0000-4000-8000-000000000001',
 '40000000-0000-4000-8000-000000000002','Withdraw image','everyone',null,'[{"id":"30000000-0000-4000-8000-000000000002"}]'));
select public.room_withdraw_post_submission('20000000-0000-4000-8000-000000000001',
 (select (result->'submission'->>'id')::uuid from fixture_result where name='withdraw'),'50000000-0000-4000-8000-000000000003',1);
reset role;
select pg_temp.check_true((select count(*)=0 from private.room_post_submission_media),'withdraw holds released');
select pg_temp.check_true((select upload_status='ready' and post_id is null and expires_at>now() from public.social_post_media where id='30000000-0000-4000-8000-000000000002'),'withdraw media returned');
-- Force failure after post INSERT while attaching the second media row. The
-- public decision call must roll back state, post, attachments, audit and notices.
insert into public.social_post_media(id,owner_id,object_key,media_kind,content_type,size_bytes) values
 ('30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000004','fixture/atomic.jpg','image','image/jpeg',44);
create function pg_temp.fail_second_media() returns trigger language plpgsql as $$
begin if new.id='30000000-0000-4000-8000-000000000003' and new.upload_status='attached' then raise exception 'FIXTURE_MEDIA_ATTACH_FAILURE'; end if; return new; end $$;
create trigger zz_fixture_media_failure before update on public.social_post_media for each row execute function pg_temp.fail_second_media();
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',true);
set local role authenticated;
insert into fixture_result values('atomic',public.room_submit_post_for_review('20000000-0000-4000-8000-000000000001',
 '40000000-0000-4000-8000-000000000009','Atomic failure','everyone',null,
 '[{"id":"30000000-0000-4000-8000-000000000002"},{"id":"30000000-0000-4000-8000-000000000003"}]'));
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
do $$ begin
  begin perform public.room_decide_post_submission('20000000-0000-4000-8000-000000000001',
    (select (result->'submission'->>'id')::uuid from fixture_result where name='atomic'),'50000000-0000-4000-8000-000000000009',1,'approve');
    raise exception 'UNEXPECTED_SUCCESS'; exception when raise_exception then if sqlerrm<>'FIXTURE_MEDIA_ATTACH_FAILURE' then raise; end if; end;
end $$;
select pg_temp.check_true((public.room_get_post_submission('20000000-0000-4000-8000-000000000001',
 (select (result->'submission'->>'id')::uuid from fixture_result where name='atomic'))->'submission'->>'state')='pending','failed attachment rolled back decision');
select pg_temp.check_true((select count(*)=0 from public.social_posts where body='Atomic failure'),'failed attachment rolled back post');
select pg_temp.check_true(jsonb_array_length(public.room_list_post_submissions('20000000-0000-4000-8000-000000000001','staff','all',null,1)->'submissions')=1 and
 public.room_list_post_submissions('20000000-0000-4000-8000-000000000001','staff','all',null,1)->>'next_cursor' is not null,'bounded queue pagination');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',true);
select public.room_withdraw_post_submission('20000000-0000-4000-8000-000000000001',
 (select (result->'submission'->>'id')::uuid from fixture_result where name='atomic'),'50000000-0000-4000-8000-000000000010',1);
reset role;
drop trigger zz_fixture_media_failure on public.social_post_media;
select pg_temp.check_true((select count(*)=0 from private.room_post_decision_audit where action='approved' and
 submission_id=(select (result->'submission'->>'id')::uuid from fixture_result where name='atomic')),'failed approval audit rolled back');
-- Removed staff lose queue authority; removed authors cannot be published.
insert into public.social_post_media(id,owner_id,object_key,media_kind,content_type,size_bytes)
 select ('30000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'10000000-0000-4000-8000-000000000004','fixture/image-'||i||'.jpg','image','image/jpeg',42
 from generate_series(10,14) i;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',true);
set local role authenticated;
insert into fixture_result values('five-images',public.room_submit_post_for_review('20000000-0000-4000-8000-000000000001',
 '40000000-0000-4000-8000-000000000006','Five images','everyone',null,
 (select jsonb_agg(jsonb_build_object('id','30000000-0000-4000-8000-'||lpad(i::text,12,'0')) order by i) from generate_series(10,14) i)));
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
select public.room_decide_post_submission('20000000-0000-4000-8000-000000000001',
 (select (result->'submission'->>'id')::uuid from fixture_result where name='five-images'),'50000000-0000-4000-8000-000000000007',1,'approve');
reset role;
select pg_temp.check_true((select count(*)=5 and max(position)=4 from public.social_post_media where
 post_id=(select published_post_id from private.room_post_submissions where id=(select (result->'submission'->>'id')::uuid from fixture_result where name='five-images'))),'five images and final slot preserved');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000005',true);
set local role authenticated;
insert into fixture_result values('removed-author',public.room_submit_post_for_review('20000000-0000-4000-8000-000000000001',
 '40000000-0000-4000-8000-000000000005','Removed author'));
reset role;
delete from public.social_circle_members where circle_id='20000000-0000-4000-8000-000000000001' and member_id='10000000-0000-4000-8000-000000000005';
update public.social_circle_members set member_role='member' where member_id='10000000-0000-4000-8000-000000000003';
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
set local role authenticated;
do $$ begin
  begin perform public.room_list_post_submissions('20000000-0000-4000-8000-000000000001','staff'); raise exception 'UNEXPECTED_SUCCESS'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
do $$ begin
  begin perform public.room_decide_post_submission('20000000-0000-4000-8000-000000000001',
    (select (result->'submission'->>'id')::uuid from fixture_result where name='removed-author'),'50000000-0000-4000-8000-000000000005',1,'approve');
    raise exception 'UNEXPECTED_SUCCESS'; exception when insufficient_privilege then if sqlerrm not like '%AUTHOR_NO_LONGER_ALLOWED%' then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000005',true);
select public.room_withdraw_post_submission('20000000-0000-4000-8000-000000000001',
 (select (result->'submission'->>'id')::uuid from fixture_result where name='removed-author'),'50000000-0000-4000-8000-000000000006',1);
reset role;
-- Deleting a published post preserves approved history with a NULL pointer.
-- An exact decision retry returns that history and never republishes content.
delete from public.social_posts where id=(select published_post_id from private.room_post_submissions where id=
 (select (result->'submission'->>'id')::uuid from fixture_result where name='five-images'));
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select pg_temp.check_true((public.room_decide_post_submission('20000000-0000-4000-8000-000000000001',
 (select (result->'submission'->>'id')::uuid from fixture_result where name='five-images'),'50000000-0000-4000-8000-000000000007',1,'approve')->'post_id')='null'::jsonb,'deleted approved post stays unavailable');
reset role;
select pg_temp.check_true((select count(*)=2 from public.social_posts),'decision retry never republishes removed approved post');
select pg_temp.check_true((select count(*)=2 from private.room_post_decision_audit where action='approved'),'approved audits preserved after post deletion');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',true);
set local role authenticated;
insert into fixture_result values('delete',public.room_submit_post_for_review('20000000-0000-4000-8000-000000000001',
 '40000000-0000-4000-8000-000000000003','Delete account image','everyone',null,'[{"id":"30000000-0000-4000-8000-000000000002"}]'));
reset role;
delete from public.social_profiles where id='10000000-0000-4000-8000-000000000004';
select pg_temp.check_true((select count(*)=0 from private.room_post_submission_media),'account cascade clears holds');
select 'ROOM_APPROVAL_LOCAL_BEHAVIOR_PASS' as result;
rollback;
