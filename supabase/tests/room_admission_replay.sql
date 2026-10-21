-- Real PostgreSQL role/RLS/trigger regression tests. Synthetic data only.
begin;
do $$ begin
  if current_setting('sautilink.security_test_fixture', true) is distinct from 'rooms-v1' then
    raise exception 'LOCAL_SECURITY_FIXTURE_REQUIRED';
  end if;
end $$;

create temporary table room_admission_checks(label text primary key);
grant all on room_admission_checks to authenticated;
create function pg_temp.admission_user(n integer) returns uuid language sql immutable as $$
 select ('d1000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$$;
create function pg_temp.admission_room(n integer) returns uuid language sql immutable as $$
 select ('d2000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$$;
create function pg_temp.admission_actor(n integer) returns void language sql as $$
 select set_config('request.jwt.claim.sub',pg_temp.admission_user(n)::text,true);
$$;
create function pg_temp.admission_check(ok boolean,label text) returns void language plpgsql security invoker as $$
begin
 if ok is distinct from true then raise exception 'ASSERTION_FAILED: %',label; end if;
 insert into room_admission_checks values(label);
end $$;
create function pg_temp.admission_denied(statement text,expected text,label text) returns void language plpgsql security invoker as $$
begin
 begin
  execute statement;
  raise exception 'UNEXPECTED_SUCCESS: %',label;
 exception when others then
  if position(expected in sqlerrm)=0 then raise; end if;
 end;
 insert into room_admission_checks values(label);
end $$;

select pg_temp.admission_check(
 (select membership_ended_at is not null and status='accepted'
    and created_at='2026-10-01 08:00Z'::timestamptz and decided_at='2026-10-01 09:00Z'::timestamptz
 from public.social_room_invitations where room_id=pg_temp.admission_room(1) and invited_user_id=pg_temp.admission_user(3)),
 'backfill expires removed invitation and preserves accepted decision timestamps');
select pg_temp.admission_check(
 (select membership_ended_at is null from public.social_room_invitations
 where room_id=pg_temp.admission_room(1) and invited_user_id=pg_temp.admission_user(2)),
 'backfill preserves active membership invitation');
select pg_temp.admission_check(not has_column_privilege('authenticated','public.social_room_invitations','membership_ended_at','UPDATE'),
 'caller cannot update server-owned invitation marker');
select pg_temp.admission_check(not has_function_privilege('authenticated','private.expire_room_invitation_after_member_delete()','EXECUTE')
 and not has_function_privilege('anon','private.expire_room_invitation_after_member_delete()','EXECUTE')
 and not has_function_privilege('authenticated','private.enforce_room_invitation_freshness()','EXECUTE'),
 'new trigger functions not directly callable');

select pg_temp.admission_actor(3);
set local role authenticated;
select pg_temp.admission_denied(
 $q$insert into public.social_circle_members(circle_id,member_id,member_role)
 values(pg_temp.admission_room(1),auth.uid(),'member')$q$,
 'ROOM_JOIN_INVITATION_REQUIRED','historical accepted invitation cannot directly rejoin private Room');
select pg_temp.admission_denied(
 $q$select public.room_submit_membership_request(pg_temp.admission_room(1),1,gen_random_uuid(),'[]','accept_invitation')$q$,
 'ROOM_JOIN_INVITATION_REQUIRED','managed SECURITY DEFINER RPC cannot replay historical invitation');
delete from public.social_room_invitations
where room_id=pg_temp.admission_room(1) and invited_user_id=auth.uid();
select pg_temp.admission_denied(
 $q$insert into public.social_circle_members(circle_id,member_id,member_role)
 values(pg_temp.admission_room(1),auth.uid(),'member')$q$,
 'ROOM_JOIN_INVITATION_REQUIRED','clearing expired invitation does not authorize restricted rejoin');

select pg_temp.admission_actor(2);
select pg_temp.admission_check(policy_private.is_room_member(pg_temp.admission_room(1)),'current invited member retained');
delete from public.social_circle_members where circle_id=pg_temp.admission_room(1) and member_id=auth.uid();
select pg_temp.admission_check(
 (select status='accepted' and membership_ended_at is not null and decided_at='2026-10-01 09:00Z'::timestamptz
 from public.social_room_invitations where room_id=pg_temp.admission_room(1) and invited_user_id=auth.uid()),
 'self leave expires invitation atomically with decision audit intact');
select pg_temp.admission_denied(
 $q$insert into public.social_circle_members(circle_id,member_id,member_role)
 values(pg_temp.admission_room(1),auth.uid(),'member')$q$,
 'ROOM_JOIN_INVITATION_REQUIRED','self leave blocks direct accepted invitation replay');
select pg_temp.admission_denied(
 $q$update public.social_room_invitations set membership_ended_at=null
 where room_id=pg_temp.admission_room(1) and invited_user_id=auth.uid()$q$,
 'permission denied','recipient cannot reset expiration marker');
update public.social_room_invitations set status='pending'
where room_id=pg_temp.admission_room(1) and invited_user_id=auth.uid();
-- A row-filtered UPDATE is not an SQL error: its persisted value is decisive.
select pg_temp.admission_check(
 (select status='accepted' and membership_ended_at is not null from public.social_room_invitations
 where room_id=pg_temp.admission_room(1) and invited_user_id=auth.uid()),
 'filtered reset attempt leaves accepted history expired');

select pg_temp.admission_actor(1);
select pg_temp.admission_denied(
 $q$insert into public.social_room_invitations(room_id,invited_user_id,invited_by,membership_ended_at)
 values(pg_temp.admission_room(1),pg_temp.admission_user(8),auth.uid(),now())$q$,
 'row-level security','table INSERT grant cannot forge expiration marker');
delete from public.social_room_invitations where room_id=pg_temp.admission_room(1) and invited_user_id=pg_temp.admission_user(2);
insert into public.social_room_invitations(room_id,invited_user_id,invited_by)
values(pg_temp.admission_room(1),pg_temp.admission_user(2),auth.uid());
select pg_temp.admission_actor(2);
update public.social_room_invitations set status='accepted'
where room_id=pg_temp.admission_room(1) and invited_user_id=auth.uid();
select pg_temp.admission_check(policy_private.is_room_member(pg_temp.admission_room(1))
 and (select membership_ended_at is null from public.social_room_invitations
 where room_id=pg_temp.admission_room(1) and invited_user_id=auth.uid()),
 'fresh authorized pending reinvite admits member');
select pg_temp.admission_actor(1);
delete from public.social_room_invitations where room_id=pg_temp.admission_room(1) and invited_user_id=pg_temp.admission_user(2);
select pg_temp.admission_check(exists(select from public.social_room_invitations
 where room_id=pg_temp.admission_room(1) and invited_user_id=pg_temp.admission_user(2)),
 'active accepted invitation cannot be cleared');
delete from public.social_circle_members where circle_id=pg_temp.admission_room(1) and member_id=pg_temp.admission_user(2);
select pg_temp.admission_actor(2);
select pg_temp.admission_check(not policy_private.is_room_member(pg_temp.admission_room(1))
 and (select membership_ended_at is not null from public.social_room_invitations
 where room_id=pg_temp.admission_room(1) and invited_user_id=auth.uid()),
 'staff removal expires invitation atomically');
select pg_temp.admission_denied(
 $q$select public.room_submit_membership_request(pg_temp.admission_room(1),1,gen_random_uuid(),'[]','accept_invitation')$q$,
 'ROOM_JOIN_INVITATION_REQUIRED','staff removed member cannot replay invitation through RPC');

-- Approval Rooms must also reject stale invitation replay, while normal new
-- join requests and staff approval continue to work.
select pg_temp.admission_actor(1);
insert into public.social_room_invitations(room_id,invited_user_id,invited_by)
values(pg_temp.admission_room(2),pg_temp.admission_user(3),auth.uid());
select pg_temp.admission_actor(3);
update public.social_room_invitations set status='accepted' where room_id=pg_temp.admission_room(2) and invited_user_id=auth.uid();
delete from public.social_circle_members where circle_id=pg_temp.admission_room(2) and member_id=auth.uid();
select pg_temp.admission_denied(
 $q$insert into public.social_circle_members(circle_id,member_id,member_role)
 values(pg_temp.admission_room(2),auth.uid(),'member')$q$,
 'ROOM_JOIN_INVITATION_REQUIRED','approval Room direct stale invitation replay denied');
select pg_temp.admission_check(public.room_submit_membership_request(pg_temp.admission_room(2),1,gen_random_uuid(),'[]','request')->>'status'='pending',
 'removed invitee can submit fresh approval request');
select pg_temp.admission_actor(1);
update public.social_circle_join_requests set status='approved'
where circle_id=pg_temp.admission_room(2) and requester_id=pg_temp.admission_user(3);
select pg_temp.admission_check(policy_private.is_room_member(pg_temp.admission_room(2),pg_temp.admission_user(3)),
 'staff can approve fresh request despite historical invitation');
delete from public.social_room_invitations
where room_id=pg_temp.admission_room(2) and invited_user_id=pg_temp.admission_user(3)
  and status='accepted' and membership_ended_at is not null;
select pg_temp.admission_check(exists(select from public.social_room_invitations
 where room_id=pg_temp.admission_room(2) and invited_user_id=pg_temp.admission_user(3)
   and status='accepted' and membership_ended_at is not null),
 'staff cannot clear ended accepted receipt while fresh approval membership is active');
select pg_temp.admission_actor(3);
delete from public.social_room_invitations
where room_id=pg_temp.admission_room(2) and invited_user_id=auth.uid()
  and status='accepted' and membership_ended_at is not null;
select pg_temp.admission_check(exists(select from public.social_room_invitations
 where room_id=pg_temp.admission_room(2) and invited_user_id=auth.uid()
   and status='accepted' and membership_ended_at is not null),
 'recipient cannot clear ended accepted receipt while fresh approval membership is active');

-- Open leave/rejoin is intentionally unchanged.
select pg_temp.admission_actor(1);
insert into public.social_room_invitations(room_id,invited_user_id,invited_by)
values(pg_temp.admission_room(3),pg_temp.admission_user(8),auth.uid());
select pg_temp.admission_actor(8);
update public.social_room_invitations set status='accepted'
where room_id=pg_temp.admission_room(3) and invited_user_id=auth.uid();
delete from public.social_circle_members where circle_id=pg_temp.admission_room(3) and member_id=auth.uid();
select pg_temp.admission_check((select membership_ended_at is not null from public.social_room_invitations
where room_id=pg_temp.admission_room(3) and invited_user_id=auth.uid()),
 'open Room also records the end of its invited membership');
insert into public.social_circle_members(circle_id,member_id,member_role) values(pg_temp.admission_room(3),auth.uid(),'member');
select pg_temp.admission_check(policy_private.is_room_member(pg_temp.admission_room(3)),
 'open Room ordinary leave and rejoin ignores historical invitation');

-- Exact existing management API and transaction-bound proof checks still run.
select pg_temp.admission_actor(1);
select public.room_update_management(pg_temp.admission_room(4),1,gen_random_uuid(),'[]',
 '[{"id":"d6000000-0000-4000-8000-000000000001","prompt":"Why join?","required":true}]');
insert into public.social_room_invitations(room_id,invited_user_id,invited_by)
values(pg_temp.admission_room(4),pg_temp.admission_user(4),auth.uid());
select pg_temp.admission_actor(4);
select pg_temp.admission_denied(
 $q$update public.social_room_invitations set status='accepted'
 where room_id=pg_temp.admission_room(4) and invited_user_id=auth.uid()$q$,
 'ROOM_QUESTIONS_REQUIRED','question Room direct acceptance still requires transaction proof');
select pg_temp.admission_check(
 (select status='pending' and membership_ended_at is null from public.social_room_invitations
 where room_id=pg_temp.admission_room(4) and invited_user_id=auth.uid()),
 'failed question acceptance leaves invitation pending atomically');
select pg_temp.admission_check(public.room_submit_membership_request(pg_temp.admission_room(4),2,gen_random_uuid(),
 '[{"question_id":"d6000000-0000-4000-8000-000000000001","answer":"Learn together"}]','accept_invitation')->>'status'='member',
 'fresh question-bearing invitation accepts through existing managed proof');
delete from public.social_circle_members where circle_id=pg_temp.admission_room(4) and member_id=auth.uid();
select pg_temp.admission_denied(
 $q$select public.room_submit_membership_request(pg_temp.admission_room(4),2,gen_random_uuid(),
 '[{"question_id":"d6000000-0000-4000-8000-000000000001","answer":"Learn together"}]','accept_invitation')$q$,
 'ROOM_JOIN_INVITATION_REQUIRED','valid answers cannot revive expired accepted invitation');
select pg_temp.admission_check(not policy_private.is_room_member(pg_temp.admission_room(4)),
 'failed managed replay leaves question Room membership absent');

-- Preserve existing role hierarchy: moderators cannot remove admins.
select pg_temp.admission_actor(6);
select pg_temp.admission_denied(
 $q$delete from public.social_circle_members where circle_id=pg_temp.admission_room(5) and member_id=pg_temp.admission_user(5)$q$,
 'ROOM_MEMBER_REMOVAL_FORBIDDEN','moderator still cannot remove admin');
select pg_temp.admission_check(policy_private.is_room_member(pg_temp.admission_room(5),pg_temp.admission_user(5)),
 'forbidden hierarchy removal leaves admin membership intact');
delete from public.social_circle_members where circle_id=pg_temp.admission_room(5) and member_id=pg_temp.admission_user(7);
select pg_temp.admission_check(not policy_private.is_room_member(pg_temp.admission_room(5),pg_temp.admission_user(7)),
 'moderator can still remove ordinary member');
reset role;
select pg_temp.admission_check(not exists(
 select 1 from public.social_circles room
 where room.id in (select pg_temp.admission_room(n) from generate_series(1,5)n)
   and room.member_count<>(select count(*) from public.social_circle_members membership where membership.circle_id=room.id)),
 'all insert leave kick retry and blocked-replay member counts remain exact');
select count(*)::integer as room_admission_assertions from room_admission_checks;
rollback;

