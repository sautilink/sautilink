-- Execute against the isolated canonical Rooms fixture and new management migration.
-- All fixture data and test-only grants are rolled back.
begin;
do $$ begin if current_database() not like 'sautilink_rooms_test%' then raise exception 'LOCAL_TEST_DATABASE_REQUIRED'; end if; end $$;
create temporary table management_checks(label text primary key);
grant all on management_checks to authenticated;
create function pg_temp.check_true(ok boolean,label text) returns void language plpgsql security invoker as $$
begin if ok is distinct from true then raise exception 'ASSERTION_FAILED: %',label; end if; insert into management_checks values(label); end $$;
create function pg_temp.expect_error(statement text,expected text,label text) returns void language plpgsql security invoker as $$
begin
 begin execute statement; raise exception 'UNEXPECTED_SUCCESS: %',label;
 exception when others then if position(expected in sqlerrm)=0 then raise; end if; end;
 insert into management_checks values(label);
end $$;
create function pg_temp.actor(n integer) returns void language sql security invoker as $$
 select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-'||lpad(n::text,12,'0'),true);
$$;
insert into public.social_profiles(id,username) select ('b1000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'management_fixture_'||i from generate_series(1,12)i;
insert into public.social_circles(id,owner_id,name,slug,join_policy) select
 ('b2000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'b1000000-0000-4000-8000-000000000001','Management fixture '||i,'management-fixture-'||i,
 case i when 1 then 'approval' when 3 then 'private' when 5 then 'approval' when 6 then 'private' else 'open' end from generate_series(1,6)i;
insert into public.social_circle_members(circle_id,member_id,member_role) select
 'b2000000-0000-4000-8000-000000000001',('b1000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 case i when 2 then 'admin' when 3 then 'moderator' when 10 then 'admin' when 11 then 'moderator' else 'member' end from unnest(array[2,3,9,10,11])i;
select pg_temp.actor(8);
set local role authenticated;
insert into public.social_circle_join_requests(circle_id,requester_id) values('b2000000-0000-4000-8000-000000000001',auth.uid());
select pg_temp.actor(9);
select pg_temp.check_true(public.room_management_state('b2000000-0000-4000-8000-000000000001')->'questions'='[]','default questions empty');
select pg_temp.check_true((public.room_management_capabilities()->>'management_version')::int=1,'separate management capability version');
select pg_temp.expect_error($q$select public.room_update_management('b2000000-0000-4000-8000-000000000001',1,gen_random_uuid(),'[]','[]')$q$,'ROOM_ADMIN_REQUIRED','member cannot configure');
select pg_temp.expect_error($q$insert into public.social_room_pinned_posts(room_id,post_id) values('b2000000-0000-4000-8000-000000000001',gen_random_uuid())$q$,'permission denied','direct pin writes denied');
select pg_temp.check_true(not has_table_privilege('authenticated','private.room_membership_answers','select'),'answers private despite existing schema usage');
select pg_temp.check_true(not has_function_privilege('authenticated','private.enforce_room_membership_questions()','execute'),'question proof helper internal only');
select pg_temp.actor(2);
select public.room_update_management('b2000000-0000-4000-8000-000000000001',1,'b4000000-0000-4000-8000-000000000001',
 '[{"id":"b5000000-0000-4000-8000-000000000001","title":" Be kind ","body":" Respect other members. "}]',
 '[{"id":"b6000000-0000-4000-8000-000000000001","prompt":" Why join? ","required":true},{"id":"b6000000-0000-4000-8000-000000000002","prompt":"Interests?","required":false}]');
select pg_temp.check_true((public.room_management_state('b2000000-0000-4000-8000-000000000001')->>'version')::int=2,'config increments exactly once');
select pg_temp.check_true(public.room_management_state('b2000000-0000-4000-8000-000000000001')->'rules'->0->>'title'='Be kind','config trims bounded text');
select pg_temp.check_true((public.room_update_management('b2000000-0000-4000-8000-000000000001',1,'b4000000-0000-4000-8000-000000000001',
 '[{"id":"b5000000-0000-4000-8000-000000000001","title":"Be kind","body":"Respect other members."}]',
 '[{"id":"b6000000-0000-4000-8000-000000000001","prompt":"Why join?","required":true},{"id":"b6000000-0000-4000-8000-000000000002","prompt":"Interests?","required":false}]')->>'version')::int=2,'config exact lost ACK retry');
select pg_temp.expect_error($q$select public.room_update_management('b2000000-0000-4000-8000-000000000001',1,'b4000000-0000-4000-8000-000000000001','[]','[]')$q$,'REQUEST_PAYLOAD_CONFLICT','config request payload immutable');
select pg_temp.expect_error($q$select public.room_update_management('b2000000-0000-4000-8000-000000000001',1,gen_random_uuid(),'[]','[]')$q$,'ROOM_MANAGEMENT_VERSION_CONFLICT','stale config save rejected');
select pg_temp.expect_error($q$select public.room_update_management('b2000000-0000-4000-8000-000000000001',2,gen_random_uuid(),'{}','[]')$q$,'INVALID_ROOM_MANAGEMENT','non-array rules rejected');
select pg_temp.expect_error($q$select public.room_update_management('b2000000-0000-4000-8000-000000000001',2,gen_random_uuid(),'[]','[{"id":"b6000000-0000-4000-8000-000000000001","prompt":"Question","required":"true"}]')$q$,'INVALID_ROOM_MANAGEMENT','question requires boolean type');
select pg_temp.expect_error($q$select public.room_update_management('b2000000-0000-4000-8000-000000000001',2,gen_random_uuid(),'[]','[{"id":"b6000000-0000-4000-8000-000000000001","prompt":"One","required":true},{"id":"b6000000-0000-4000-8000-000000000001","prompt":"Two","required":false}]')$q$,'INVALID_ROOM_MANAGEMENT','duplicate question IDs rejected');
select pg_temp.actor(3);
select pg_temp.expect_error($q$select public.room_update_management('b2000000-0000-4000-8000-000000000001',2,gen_random_uuid(),'[]','[]')$q$,'ROOM_ADMIN_REQUIRED','moderator cannot change manager settings');
select pg_temp.actor(4);
select pg_temp.expect_error($q$insert into public.social_circle_join_requests(circle_id,requester_id) values('b2000000-0000-4000-8000-000000000001',auth.uid())$q$,'ROOM_QUESTIONS_REQUIRED','direct request bypass denied when configured');
select set_config('sautilink.room_questions_authorized','true',true);
select pg_temp.expect_error($q$insert into public.social_circle_join_requests(circle_id,requester_id) values('b2000000-0000-4000-8000-000000000001',auth.uid())$q$,'ROOM_QUESTIONS_REQUIRED','caller GUC cannot forge question proof');
select pg_temp.expect_error($q$select public.room_submit_membership_request('b2000000-0000-4000-8000-000000000001',1,gen_random_uuid(),'[]','request')$q$,'ROOM_MANAGEMENT_VERSION_CONFLICT','stale membership question version rejected');
select pg_temp.expect_error($q$select public.room_submit_membership_request('b2000000-0000-4000-8000-000000000001',2,gen_random_uuid(),'[]','request')$q$,'INVALID_ROOM_ANSWERS','required answer missing denied');
select pg_temp.expect_error($q$select public.room_submit_membership_request('b2000000-0000-4000-8000-000000000001',2,gen_random_uuid(),'[{"question_id":"b6000000-0000-4000-8000-000000000099","answer":"Wrong"}]','request')$q$,'INVALID_ROOM_ANSWERS','unknown question ID rejected');
select pg_temp.check_true(public.room_submit_membership_request('b2000000-0000-4000-8000-000000000001',2,'b4000000-0000-4000-8000-000000000004',
 '[{"question_id":"b6000000-0000-4000-8000-000000000001","answer":" Learn together "}]','request')->>'status'='pending','valid answer and pending request atomic');
select pg_temp.check_true(public.room_submit_membership_request('b2000000-0000-4000-8000-000000000001',2,'b4000000-0000-4000-8000-000000000004',
 '[{"question_id":"b6000000-0000-4000-8000-000000000001","answer":"Learn together"}]','request')->>'status'='pending','membership exact retry does not duplicate');
select pg_temp.expect_error($q$select public.room_submit_membership_request('b2000000-0000-4000-8000-000000000001',2,'b4000000-0000-4000-8000-000000000004','[{"question_id":"b6000000-0000-4000-8000-000000000001","answer":"Changed"}]','request')$q$,'REQUEST_PAYLOAD_CONFLICT','membership retry cannot alter answers');
select pg_temp.check_true(public.room_membership_request_answers('b2000000-0000-4000-8000-000000000001',auth.uid())->'answers'->0->>'answer'='Learn together','applicant reads own answer snapshot');
select pg_temp.check_true(not (public.room_membership_request_answers('b2000000-0000-4000-8000-000000000001',auth.uid()) ? 'admission_transaction'),'internal transaction proof not disclosed');
select pg_temp.actor(9);
select pg_temp.expect_error($q$select public.room_membership_request_answers('b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000004')$q$,'MEMBERSHIP_ANSWERS_UNAVAILABLE','ordinary member cannot read other answers');
select pg_temp.actor(2);
select pg_temp.check_true(public.room_membership_request_answers('b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000004')->>'config_version'='2','current staff reads versioned answer snapshot');
update public.social_circle_join_requests set status='approved' where circle_id='b2000000-0000-4000-8000-000000000001' and requester_id='b1000000-0000-4000-8000-000000000004';
select pg_temp.check_true(policy_private.is_room_member('b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000004'),'fixed current admin approval inserts member');
update public.social_circle_join_requests set status='approved' where circle_id='b2000000-0000-4000-8000-000000000001' and requester_id='b1000000-0000-4000-8000-000000000008';
select pg_temp.check_true(policy_private.is_room_member('b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000008'),'pending request predating enablement preserved');
select pg_temp.actor(5);
select public.room_submit_membership_request('b2000000-0000-4000-8000-000000000001',2,'b4000000-0000-4000-8000-000000000005','[{"question_id":"b6000000-0000-4000-8000-000000000001","answer":"Join the discussion"}]','request');
select pg_temp.actor(3);
update public.social_circle_join_requests set status='approved' where circle_id='b2000000-0000-4000-8000-000000000001' and requester_id='b1000000-0000-4000-8000-000000000005';
select pg_temp.check_true(policy_private.is_room_member('b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000005'),'fixed current moderator approval inserts member');
select pg_temp.actor(1);
select public.room_update_management('b2000000-0000-4000-8000-000000000001',2,'b4000000-0000-4000-8000-000000000002','[]','[{"id":"b6000000-0000-4000-8000-000000000001","prompt":"New question wording","required":true}]');
select pg_temp.actor(4);
select pg_temp.check_true(public.room_membership_request_answers('b2000000-0000-4000-8000-000000000001',auth.uid())->'questions'->0->>'prompt'='Why join?','saved answers retain original question text');
select pg_temp.check_true(public.room_submit_membership_request('b2000000-0000-4000-8000-000000000001',2,'b4000000-0000-4000-8000-000000000004','[{"question_id":"b6000000-0000-4000-8000-000000000001","answer":"Learn together"}]','request')->>'status'='member','approved lost request ACK reflects current membership');
select pg_temp.actor(6);
select public.room_submit_membership_request('b2000000-0000-4000-8000-000000000001',3,'b4000000-0000-4000-8000-000000000006','[{"question_id":"b6000000-0000-4000-8000-000000000001","answer":"Please join"}]','request');
reset role;
insert into public.social_blocks values('b1000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000006');
set local role authenticated;
select pg_temp.actor(3);
select pg_temp.expect_error($q$update public.social_circle_join_requests set status='approved' where circle_id='b2000000-0000-4000-8000-000000000001' and requester_id='b1000000-0000-4000-8000-000000000006'$q$,'ROOM_UNAVAILABLE','approval rechecks original applicant owner block');
select pg_temp.check_true(not policy_private.is_room_member('b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000006'),'blocked failed approval creates no member');
reset role;
delete from public.social_blocks where blocked_id='b1000000-0000-4000-8000-000000000006';
set local role authenticated;
select pg_temp.actor(6);
delete from public.social_circle_join_requests where circle_id='b2000000-0000-4000-8000-000000000001' and requester_id=auth.uid();
select pg_temp.expect_error($q$select public.room_submit_membership_request('b2000000-0000-4000-8000-000000000001',3,'b4000000-0000-4000-8000-000000000006','[{"question_id":"b6000000-0000-4000-8000-000000000001","answer":"Please join"}]','request')$q$,'MEMBERSHIP_STATE_CHANGED','canceled request retry cannot fake pending');

-- Configure open/private Rooms and prove unchanged policy modes/invitation effect.
select pg_temp.actor(1);
select public.room_update_management('b2000000-0000-4000-8000-000000000002',1,gen_random_uuid(),'[]','[{"id":"b6000000-0000-4000-8000-000000000001","prompt":"Why join?","required":true}]');
select public.room_update_management('b2000000-0000-4000-8000-000000000003',1,gen_random_uuid(),'[]','[{"id":"b6000000-0000-4000-8000-000000000001","prompt":"Why join?","required":true}]');
insert into public.social_room_invitations(room_id,invited_user_id,invited_by) values
 ('b2000000-0000-4000-8000-000000000003','b1000000-0000-4000-8000-000000000006',auth.uid()),
 ('b2000000-0000-4000-8000-000000000006','b1000000-0000-4000-8000-000000000006',auth.uid());
select pg_temp.actor(6);
select pg_temp.expect_error($q$insert into public.social_circle_members(circle_id,member_id,member_role) values('b2000000-0000-4000-8000-000000000002',auth.uid(),'member')$q$,'ROOM_QUESTIONS_REQUIRED','configured open join cannot bypass answers');
select pg_temp.check_true(public.room_submit_membership_request('b2000000-0000-4000-8000-000000000002',2,'b4000000-0000-4000-8000-000000000026','[{"question_id":"b6000000-0000-4000-8000-000000000001","answer":"Interested"}]','join')->>'status'='member','open admission and answers commit together');
select pg_temp.expect_error($q$update public.social_room_invitations set status='accepted' where room_id='b2000000-0000-4000-8000-000000000003' and invited_user_id=auth.uid()$q$,'ROOM_QUESTIONS_REQUIRED','configured invitation old-client bypass denied atomically');
select pg_temp.check_true((select status='pending' from public.social_room_invitations where room_id='b2000000-0000-4000-8000-000000000003' and invited_user_id=auth.uid()),'denied acceptance leaves invitation pending');
select pg_temp.check_true(public.room_submit_membership_request('b2000000-0000-4000-8000-000000000003',2,'b4000000-0000-4000-8000-000000000036','[{"question_id":"b6000000-0000-4000-8000-000000000001","answer":"Invited"}]','accept_invitation')->>'status'='member','private pending invitation atomically accepted with answers');
select pg_temp.check_true((select status='accepted' from public.social_room_invitations where room_id='b2000000-0000-4000-8000-000000000003' and invited_user_id=auth.uid()),'existing invitation acceptance semantics retained');
delete from public.social_circle_members where circle_id='b2000000-0000-4000-8000-000000000003' and member_id=auth.uid();
select pg_temp.expect_error($q$select public.room_submit_membership_request('b2000000-0000-4000-8000-000000000003',2,'b4000000-0000-4000-8000-000000000036','[{"question_id":"b6000000-0000-4000-8000-000000000001","answer":"Invited"}]','accept_invitation')$q$,'MEMBERSHIP_STATE_CHANGED','left-member lost ACK retry cannot rejoin silently');
insert into public.social_circle_members(circle_id,member_id,member_role) values('b2000000-0000-4000-8000-000000000004',auth.uid(),'member');
select pg_temp.check_true(policy_private.is_room_member('b2000000-0000-4000-8000-000000000004'),'default-empty open Room unchanged');
update public.social_room_invitations set status='accepted' where room_id='b2000000-0000-4000-8000-000000000006' and invited_user_id=auth.uid();
select pg_temp.check_true(policy_private.is_room_member('b2000000-0000-4000-8000-000000000006'),'default-empty private invitation acceptance unchanged');
select pg_temp.actor(7);
select pg_temp.expect_error($q$select public.room_submit_membership_request('b2000000-0000-4000-8000-000000000003',2,gen_random_uuid(),'[{"question_id":"b6000000-0000-4000-8000-000000000001","answer":"Interested"}]','accept_invitation')$q$,'ROOM_JOIN_INVITATION_REQUIRED','private Room still requires invitation');
select pg_temp.expect_error($q$select public.room_pinned_posts('b2000000-0000-4000-8000-000000000001')$q$,'ROOM_UNAVAILABLE','nonmember cannot list Room pin metadata');

-- Canonical phase26 insert/phase29 SELECT/count/role triggers remain active.
reset role;
-- Trusted synthetic seed of a former member. Real actor admissions are already
-- exercised above; an owner cannot bypass configured questions with a raw INSERT.
select set_config('request.jwt.claim.sub','',true);
insert into public.social_circle_members(circle_id,member_id,member_role) values('b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000007','member');
insert into public.social_posts(id,author_id,circle_id,visibility,body) select
 ('b3000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 ('b1000000-0000-4000-8000-'||lpad((case i when 1 then 9 when 2 then 4 when 3 then 5 when 4 then 1 when 5 then 10 when 6 then 11 when 7 then 7 when 10 then 3 else 9 end)::text,12,'0'))::uuid,
 case when i=8 then null else 'b2000000-0000-4000-8000-000000000001'::uuid end,
 case when i=8 then 'public' else 'circle' end,'Management fixture post '||i
 from unnest(array[1,2,3,4,5,6,7,8,10])i;
insert into public.social_posts(id,author_id,circle_id,visibility,body,parent_post_id) values
 ('b3000000-0000-4000-8000-000000000009','b1000000-0000-4000-8000-000000000009','b2000000-0000-4000-8000-000000000001','circle','Reply fixture','b3000000-0000-4000-8000-000000000001');
select pg_temp.actor(1);
delete from public.social_circle_members where circle_id='b2000000-0000-4000-8000-000000000001' and member_id='b1000000-0000-4000-8000-000000000007';
set local role authenticated;
select pg_temp.actor(2);
select public.room_set_post_pin('b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001',true,'b4000000-0000-4000-8000-000000000101');
select public.room_set_post_pin('b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000002',true,'b4000000-0000-4000-8000-000000000102');
select public.room_set_post_pin('b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000003',true,'b4000000-0000-4000-8000-000000000103');
select pg_temp.expect_error($q$select public.room_set_post_pin('b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000004',true,gen_random_uuid())$q$,'ROOM_PIN_LIMIT','pin limit is enforced server-side');
select pg_temp.check_true(jsonb_array_length(public.room_pinned_posts('b2000000-0000-4000-8000-000000000001')->'posts')=3,'three pinned posts visible to member');
select pg_temp.check_true((public.room_set_post_pin('b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001',true,'b4000000-0000-4000-8000-000000000101')->>'pinned')::boolean,'pin lost ACK idempotent');
select pg_temp.actor(9);
select pg_temp.expect_error($q$select public.room_set_post_pin('b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000004',true,gen_random_uuid())$q$,'ROOM_STAFF_REQUIRED','ordinary member cannot pin');
reset role;
insert into public.social_blocks values('b1000000-0000-4000-8000-000000000009','b1000000-0000-4000-8000-000000000004');
set local role authenticated;
select pg_temp.check_true(jsonb_array_length(public.room_pinned_posts('b2000000-0000-4000-8000-000000000001')->'posts')=2,'pins preserve actual post block RLS');
reset role;
insert into public.social_mutes values('b1000000-0000-4000-8000-000000000009','b1000000-0000-4000-8000-000000000005');
set local role authenticated;
select pg_temp.check_true(jsonb_array_length(public.room_pinned_posts('b2000000-0000-4000-8000-000000000001')->'posts')=1,'pins preserve actual post mute RLS');
reset role;
delete from public.social_blocks where blocker_id='b1000000-0000-4000-8000-000000000009';
delete from public.social_mutes where muter_id='b1000000-0000-4000-8000-000000000009';
set local role authenticated;
select pg_temp.actor(2);
select public.room_set_post_pin('b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000002',false,gen_random_uuid());
select pg_temp.expect_error($q$select public.room_set_post_pin('b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000002',true,'b4000000-0000-4000-8000-000000000102')$q$,'ROOM_PIN_CHANGED','old pin ACK cannot claim a later unpin is pinned');
select pg_temp.expect_error($q$select public.room_set_post_pin('b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000008',true,gen_random_uuid())$q$,'ROOM_POST_UNAVAILABLE','public post cannot be pinned into Room');
select pg_temp.expect_error($q$select public.room_set_post_pin('b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000009',true,gen_random_uuid())$q$,'ROOM_POST_UNAVAILABLE','reply cannot be featured as top-level post');
select pg_temp.expect_error($q$select public.room_moderate_published_post('b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000004',gen_random_uuid(),'remove','Rule violation')$q$,'ROOM_MODERATION_FORBIDDEN','admin cannot remove owner post');
select pg_temp.expect_error($q$select public.room_moderate_published_post('b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000005',gen_random_uuid(),'remove','Rule violation')$q$,'ROOM_MODERATION_FORBIDDEN','admin cannot remove peer admin post');
select pg_temp.actor(3);
select pg_temp.expect_error($q$select public.room_moderate_published_post('b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000006',gen_random_uuid(),'remove','Rule violation')$q$,'ROOM_MODERATION_FORBIDDEN','moderator cannot remove peer moderator post');
select pg_temp.expect_error($q$select public.room_moderate_published_post('b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001',gen_random_uuid(),'remove',' ')$q$,'INVALID_ROOM_MODERATION','post removal requires reason');
select pg_temp.check_true((public.room_moderate_published_post('b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000007',gen_random_uuid(),'remove','Former member rule violation')->>'removed')::boolean,'moderator may remove former member post');
select pg_temp.check_true((public.room_moderate_published_post('b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000201','remove','Rule violation')->>'removed')::boolean,'moderator removes ordinary member post');
select pg_temp.check_true((public.room_moderate_published_post('b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000201','remove','Rule violation')->>'removed')::boolean,'removal exact retry confirmed');
select pg_temp.expect_error($q$select public.room_moderate_published_post('b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000201','remove','Changed')$q$,'REQUEST_PAYLOAD_CONFLICT','removal audit payload immutable');
select pg_temp.actor(9);
select pg_temp.check_true(not exists(select from public.social_posts where id='b3000000-0000-4000-8000-000000000001'),'soft removal hidden by unchanged published post RLS even from author');
select pg_temp.expect_error($q$select public.room_moderate_published_post('b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000002',gen_random_uuid(),'remove','Rule violation')$q$,'ROOM_STAFF_REQUIRED','ordinary author does not gain staff removal API');
reset role;
select pg_temp.expect_error($q$update public.social_posts set deleted_at=null where id='b3000000-0000-4000-8000-000000000001'$q$,'ROOM_POST_REMOVED','guard prevents undelete even with privileged test-only update');
select pg_temp.expect_error($q$update public.social_posts set circle_id=null,visibility='public' where id='b3000000-0000-4000-8000-000000000001'$q$,'ROOM_POST_REMOVED','guard prevents moving removed content into public');
update public.social_posts set body='Unrelated existing update stays supported' where id='b3000000-0000-4000-8000-000000000008';
select pg_temp.check_true((select body='Unrelated existing update stays supported' from public.social_posts where id='b3000000-0000-4000-8000-000000000008'),'unrelated post update preserved');
select pg_temp.check_true((select deleted_at is not null and author_id='b1000000-0000-4000-8000-000000000009' from public.social_posts where id='b3000000-0000-4000-8000-000000000001'),'soft removal preserves original author and stored post');
select pg_temp.check_true(not exists(select from public.social_room_pinned_posts where post_id='b3000000-0000-4000-8000-000000000001'),'removed post unpinned atomically');
select pg_temp.check_true((select count(*)=1 from private.room_management_audit where request_id='b4000000-0000-4000-8000-000000000201'),'idempotent removal creates one audit');
select pg_temp.check_true((select member_count=(select count(*) from public.social_circle_members where circle_id=room.id) from public.social_circles room where id='b2000000-0000-4000-8000-000000000001'),'canonical membership count remains exact');
select pg_temp.check_true(not has_function_privilege('anon','public.room_management_capabilities()','execute'),'anon management RPC denied');
do $$ declare n integer; begin select count(*) into n from management_checks; raise notice 'PASS: % actual Rooms management behavior assertions with canonical production RLS/triggers.',n; end $$;
table management_checks;
rollback;
