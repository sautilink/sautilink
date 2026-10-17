begin;
do $$ begin if current_database() not like 'sautilink_rooms_test%' then raise exception 'LOCAL_TEST_DATABASE_REQUIRED'; end if; end $$;
create temporary table management_edge_checks(label text primary key);
grant all on management_edge_checks to authenticated;
create function pg_temp.edge_true(ok boolean,label text) returns void language plpgsql security invoker as $$
begin if ok is distinct from true then raise exception 'ASSERTION_FAILED: %',label; end if; insert into management_edge_checks values(label); end $$;
create function pg_temp.edge_error(statement text,expected text,label text) returns void language plpgsql security invoker as $$
begin begin execute statement; raise exception 'UNEXPECTED_SUCCESS: %',label;
 exception when others then if position(expected in sqlerrm)=0 then raise; end if; end;
 insert into management_edge_checks values(label); end $$;
create function pg_temp.edge_actor(n integer) returns void language sql security invoker as $$
 select set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-'||lpad(n::text,12,'0'),true);
$$;
insert into public.social_profiles(id,username) select ('e1000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'management_edge_'||i from generate_series(1,7)i;
insert into public.social_circles(id,owner_id,name,slug,join_policy) values
 ('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','Management edges','management-edges','open');
insert into public.social_circle_members(circle_id,member_id,member_role) select
 'e2000000-0000-4000-8000-000000000001',('e1000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 case i when 2 then 'admin' when 3 then 'moderator' else 'member' end from unnest(array[2,3,4,7])i;
select pg_temp.edge_actor(1);
set local role authenticated;
insert into public.social_room_invitations(room_id,invited_user_id,invited_by) values
 ('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000005',auth.uid());
select pg_temp.edge_actor(4);
insert into public.social_room_invitations(room_id,invited_user_id,invited_by) values
 ('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000006',auth.uid());
select pg_temp.edge_true((select count(*)=1 from public.social_room_invitations where room_id='e2000000-0000-4000-8000-000000000001'),'member outgoing list restricted to own invitation');
select pg_temp.edge_actor(7);
select pg_temp.edge_true((select count(*)=0 from public.social_room_invitations where room_id='e2000000-0000-4000-8000-000000000001'),'unrelated member cannot read outgoing invitations');
with changed as (update public.social_room_invitations set status='accepted' where room_id='e2000000-0000-4000-8000-000000000001' returning invited_user_id)
 select pg_temp.edge_true((select count(*)=0 from changed),'unrelated actor cannot accept another invitation');
select pg_temp.edge_actor(2);
select pg_temp.edge_true((select count(*)=2 from public.social_room_invitations where room_id='e2000000-0000-4000-8000-000000000001'),'current staff may list outgoing invitations');
with changed as (update public.social_room_invitations set status='accepted' where room_id='e2000000-0000-4000-8000-000000000001' returning invited_user_id)
 select pg_temp.edge_true((select count(*)=0 from changed),'staff cannot accept on recipient behalf');
select pg_temp.edge_actor(5);
update public.social_room_invitations set status='declined' where room_id='e2000000-0000-4000-8000-000000000001' and invited_user_id=auth.uid();
select pg_temp.edge_true(not policy_private.is_room_member('e2000000-0000-4000-8000-000000000001'),'decline has no membership side effect');
select pg_temp.edge_actor(1);
with changed as (delete from public.social_room_invitations where room_id='e2000000-0000-4000-8000-000000000001' and invited_user_id='e1000000-0000-4000-8000-000000000005' and status='pending' returning invited_user_id)
 select pg_temp.edge_true((select count(*)=0 from changed),'filtered pending revoke cannot claim declined invitation');
select pg_temp.edge_actor(6);
update public.social_room_invitations set status='accepted' where room_id='e2000000-0000-4000-8000-000000000001' and invited_user_id=auth.uid();
select pg_temp.edge_true(policy_private.is_room_member('e2000000-0000-4000-8000-000000000001'),'recipient legacy acceptance fixed under actual RLS');
with changed as (update public.social_room_invitations set status='accepted' where room_id='e2000000-0000-4000-8000-000000000001' and invited_user_id=auth.uid() returning invited_user_id)
 select pg_temp.edge_true((select count(*)=0 from changed),'legacy accepted retry truthfully affects zero pending rows');
select pg_temp.edge_true(public.room_submit_membership_request('e2000000-0000-4000-8000-000000000001',1,'e4000000-0000-4000-8000-000000000006','[]','accept_invitation')->>'status'='member','new accepted invitation retry confirms actual member');
select pg_temp.edge_actor(4);
with changed as (delete from public.social_room_invitations where room_id='e2000000-0000-4000-8000-000000000001' and invited_user_id='e1000000-0000-4000-8000-000000000006' returning invited_user_id)
 select pg_temp.edge_true((select count(*)=0 from changed),'inviter cannot revoke accepted membership by deleting invitation');

select pg_temp.edge_actor(1);
select pg_temp.edge_true(public.room_update_management('e2000000-0000-4000-8000-000000000001',1,gen_random_uuid(),
 (select jsonb_agg(jsonb_build_object('id',gen_random_uuid(),'title',repeat('🌍',120),'body',repeat('🌍',1000))) from generate_series(1,10)),
 (select jsonb_agg(jsonb_build_object('id',('e6000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'prompt',repeat('🌍',300),'required',false)) from generate_series(1,3)i))
 ->>'version'='2','maximum counts and Unicode code-point bounds accepted');
select pg_temp.edge_error($q$select public.room_update_management('e2000000-0000-4000-8000-000000000001',2,gen_random_uuid(),(select jsonb_agg(jsonb_build_object('id',gen_random_uuid(),'title','Rule','body','')) from generate_series(1,11)),'[]')$q$,'INVALID_ROOM_MANAGEMENT','eleventh rule rejected');
select pg_temp.edge_error($q$select public.room_update_management('e2000000-0000-4000-8000-000000000001',2,gen_random_uuid(),'[]',(select jsonb_agg(jsonb_build_object('id',gen_random_uuid(),'prompt','Question','required',false)) from generate_series(1,4)))$q$,'INVALID_ROOM_MANAGEMENT','fourth question rejected');
select pg_temp.edge_error($q$select public.room_update_management('e2000000-0000-4000-8000-000000000001',2,gen_random_uuid(),jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'title',repeat('x',121),'body','')),'[]')$q$,'INVALID_ROOM_MANAGEMENT','title121 rejected');
select pg_temp.edge_error($q$select public.room_update_management('e2000000-0000-4000-8000-000000000001',2,gen_random_uuid(),jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'title','Rule','body',repeat('x',1001))),'[]')$q$,'INVALID_ROOM_MANAGEMENT','body1001 rejected');
select pg_temp.edge_error($q$select public.room_update_management('e2000000-0000-4000-8000-000000000001',2,gen_random_uuid(),'[]',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'prompt',repeat('x',301),'required',false)))$q$,'INVALID_ROOM_MANAGEMENT','prompt301 rejected');
select pg_temp.edge_error($q$select public.room_update_management('e2000000-0000-4000-8000-000000000001',2,gen_random_uuid(),'[{"id":"00000000-0000-0000-0000-000000000000","title":"Rule","body":""}]','[]')$q$,'INVALID_ROOM_MANAGEMENT','config UUID must remain Worker-compatible');
select pg_temp.edge_actor(5);
select pg_temp.edge_error($q$select public.room_submit_membership_request('e2000000-0000-4000-8000-000000000001',2,gen_random_uuid(),'[]','request')$q$,'MEMBERSHIP_STATE_CHANGED','explicit request cannot join an open Room');
select pg_temp.edge_error($q$select public.room_submit_membership_request('e2000000-0000-4000-8000-000000000001',2,gen_random_uuid(),'[]','accept_invitation')$q$,'ROOM_JOIN_INVITATION_REQUIRED','declined invitation cannot be accepted');
select pg_temp.edge_error($q$select public.room_submit_membership_request('e2000000-0000-4000-8000-000000000001',2,gen_random_uuid(),jsonb_build_array(jsonb_build_object('question_id','e6000000-0000-4000-8000-000000000001','answer',repeat('x',1001))),'join')$q$,'INVALID_ROOM_ANSWERS','answer1001 rejected');
select pg_temp.edge_error($q$select public.room_submit_membership_request('e2000000-0000-4000-8000-000000000001',2,gen_random_uuid(),'[{"question_id":"e6000000-0000-4000-8000-000000000001","answer":"a"},{"question_id":"e6000000-0000-4000-8000-000000000001","answer":"b"}]','join')$q$,'INVALID_ROOM_ANSWERS','duplicate answer IDs rejected');
select pg_temp.edge_true(public.room_submit_membership_request('e2000000-0000-4000-8000-000000000001',2,'e4000000-0000-4000-8000-000000000005',jsonb_build_array(jsonb_build_object('question_id','e6000000-0000-4000-8000-000000000001','answer',repeat('🌍',1000))),'join')->>'status'='member','maximum Unicode answer admitted and snapshotted');
select pg_temp.edge_error($q$select public.room_submit_membership_request('e2000000-0000-4000-8000-000000000001',2,'e4000000-0000-4000-8000-000000000005',jsonb_build_array(jsonb_build_object('question_id','e6000000-0000-4000-8000-000000000001','answer',repeat('🌍',1000))),'request')$q$,'REQUEST_PAYLOAD_CONFLICT','request ID cannot change explicit admission intent');

reset role;
insert into public.social_blocks values('e1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000004');
set local role authenticated;
select pg_temp.edge_actor(4);
select pg_temp.edge_error($q$select public.room_management_state('e2000000-0000-4000-8000-000000000001')$q$,'ROOM_UNAVAILABLE','owner blocking actor protects Room management metadata');
reset role;
delete from public.social_blocks;
insert into public.social_blocks values('e1000000-0000-4000-8000-000000000004','e1000000-0000-4000-8000-000000000001');
set local role authenticated;
select pg_temp.edge_error($q$select public.room_management_state('e2000000-0000-4000-8000-000000000001')$q$,'ROOM_UNAVAILABLE','actor blocking owner protects Room management metadata');
reset role;
delete from public.social_blocks;
insert into public.social_posts(id,author_id,circle_id,visibility,body) values
 ('e3000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000004','e2000000-0000-4000-8000-000000000001','circle','Pinner lifecycle fixture');
set local role authenticated;
select pg_temp.edge_actor(2);
select public.room_set_post_pin('e2000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001',true,gen_random_uuid());
reset role;
select pg_temp.edge_actor(1);
delete from public.social_circle_members where circle_id='e2000000-0000-4000-8000-000000000001' and member_id='e1000000-0000-4000-8000-000000000002';
set local role authenticated;
select pg_temp.edge_actor(2);
select pg_temp.edge_error($q$select public.room_set_post_pin('e2000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001',false,gen_random_uuid())$q$,'ROOM_STAFF_REQUIRED','removed staff cannot mutate pins');
reset role;
select pg_temp.edge_actor(1);
delete from public.social_profiles where id='e1000000-0000-4000-8000-000000000002';
set local role authenticated;
select pg_temp.edge_actor(4);
select pg_temp.edge_true(public.room_pinned_posts('e2000000-0000-4000-8000-000000000001')->'posts'->0->'pinned_by'='null','deleted former pinner retains pin with truthful null actor');

reset role;
do $$ declare p record; tab text; n integer:=0; begin
 foreach tab in array array['room_management_config','room_membership_answers','room_management_receipts','room_management_post_removals','room_management_audit'] loop
  if has_table_privilege('authenticated','private.'||tab,'select,insert,update,delete') or
    has_table_privilege('anon','private.'||tab,'select,insert,update,delete') or
    not exists(select from pg_class where oid=('private.'||tab)::regclass and relrowsecurity and relforcerowsecurity) then raise exception 'PRIVATE_AUTHORITY_FAILED: %',tab; end if;
 end loop;
 if has_sequence_privilege('authenticated','private.room_management_audit_id_seq','usage,select,update') then raise exception 'AUDIT_SEQUENCE_EXPOSED'; end if;
 for p in select oid,proname,prosecdef,proconfig,proowner,proacl from pg_proc where pronamespace='public'::regnamespace and proname=any(array[
  'room_management_capabilities','room_management_state','room_update_management','room_submit_membership_request',
  'room_membership_request_answers','room_pinned_posts','room_set_post_pin','room_moderate_published_post']) loop
   n:=n+1;
   if p.proconfig is null or not p.proconfig @> array['search_path=""'] or
      (p.proname='room_pinned_posts' and p.prosecdef) or (p.proname<>'room_pinned_posts' and not p.prosecdef) or
      has_function_privilege('anon',p.oid,'execute') or not has_function_privilege('authenticated',p.oid,'execute') or
      exists(select from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) where grantee=0 and privilege_type='EXECUTE') then raise exception 'RPC_AUTHORITY_FAILED: %',p.proname; end if;
 end loop;
 if n<>8 then raise exception 'RPC_COVERAGE_FAILED: %',n; end if;
 perform pg_temp.edge_true(true,'all five private tables FORCE RLS and ungranted, audit sequence ungranted, eight RPCs scoped and safe search path');
end $$;
select set_config('request.jwt.claim.sub','',true);
set local role authenticated;
select pg_temp.edge_error($q$select public.room_management_capabilities()$q$,'AUTH_REQUIRED','authenticated role without actual actor rejected');
reset role;
do $$ declare n integer; begin select count(*) into n from management_edge_checks; raise notice 'PASS: % actual Rooms management authority/limit/lifecycle assertions.',n; end $$;
table management_edge_checks;
rollback;
