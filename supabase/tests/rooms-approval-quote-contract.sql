-- Actual canonical production post SELECT/insert predicates must already be loaded.
-- expect_bug=true proves old RPC eligibility differs from normal authenticated reads.
begin;
do $$ begin if current_database() not like 'sautilink_rooms_test%' then raise exception 'LOCAL_TEST_DATABASE_REQUIRED'; end if; end $$;
select set_config('room_test.expect_bug', :'expect_bug', true);
insert into public.social_circle_members(circle_id,member_id,member_role) values
 ('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000002','admin'),
 ('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000003','member') on conflict do nothing;
create temporary table quote_results(label text primary key, readable boolean, accepted boolean, error_text text);
grant all on quote_results to authenticated;
create function pg_temp.exercise_quote(label text, target uuid, expected_readable boolean)
returns void language plpgsql security invoker as $$
declare readable boolean; accepted boolean:=false; failure text;
begin
  readable:=exists(select from public.social_posts where id=target);
  if readable is distinct from expected_readable then raise exception 'FIXTURE_RLS_MISMATCH: %',label; end if;
  begin
    perform public.room_submit_post_for_review('a2000000-0000-4000-8000-000000000001',gen_random_uuid(),
      'Quote contract fixture','everyone',target,'[]');
    accepted:=true;
  exception when others then
    failure:=sqlerrm;
    if failure not like '%QUOTE_UNAVAILABLE%' then raise; end if;
  end;
  insert into quote_results values(label,readable,accepted,failure);
end;
$$;
create function pg_temp.exercise_decision(label text, submission uuid, expected_readable boolean)
returns void language plpgsql security invoker as $$
declare accepted boolean:=false; failure text;
begin
  begin
    perform public.room_decide_post_submission('a2000000-0000-4000-8000-000000000001',submission,
      gen_random_uuid(),1,'approve');
    accepted:=true;
  exception when others then
    failure:=sqlerrm;
    if failure not like '%QUOTE_UNAVAILABLE%' then raise; end if;
  end;
  insert into quote_results values(label,expected_readable,accepted,failure);
end;
$$;

-- Other author's public root and public reply. The actual phase26 trigger sets audience ownership.
insert into public.social_posts(id,author_id,visibility,body) values
 ('a3000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000004','public','Visible root'),
 ('a3000000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000003','public','Own root');
insert into public.social_posts(id,author_id,visibility,body,parent_post_id) values
 ('a3000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000005','public','Visible reply',
  'a3000000-0000-4000-8000-000000000001');
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000003',true);
set local role authenticated;
select pg_temp.exercise_quote('visible public root','a3000000-0000-4000-8000-000000000001',true);
select pg_temp.exercise_quote('visible public reply','a3000000-0000-4000-8000-000000000002',true);
reset role;
update public.social_posts set moderation_state='removed' where id='a3000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.exercise_quote('other moderated root','a3000000-0000-4000-8000-000000000001',false);
reset role;
update public.social_posts set moderation_state='visible' where id='a3000000-0000-4000-8000-000000000001';
update public.social_profiles set is_discoverable=false where id='a1000000-0000-4000-8000-000000000004';
set local role authenticated;
select pg_temp.exercise_quote('hidden root author','a3000000-0000-4000-8000-000000000001',false);
select pg_temp.exercise_quote('hidden reply audience owner','a3000000-0000-4000-8000-000000000002',false);
reset role;
update public.social_profiles set is_discoverable=true where id='a1000000-0000-4000-8000-000000000004';
update public.social_profiles set is_discoverable=false where id='a1000000-0000-4000-8000-000000000005';
set local role authenticated;
select pg_temp.exercise_quote('hidden reply author','a3000000-0000-4000-8000-000000000002',false);
reset role;
update public.social_profiles set is_discoverable=true where id='a1000000-0000-4000-8000-000000000005';
insert into public.social_mutes values('a1000000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000004');
set local role authenticated;
select pg_temp.exercise_quote('muted root author','a3000000-0000-4000-8000-000000000001',false);
select pg_temp.exercise_quote('muted reply audience owner','a3000000-0000-4000-8000-000000000002',false);
reset role;
delete from public.social_mutes;
insert into public.social_blocks values('a1000000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000004');
set local role authenticated;
select pg_temp.exercise_quote('blocked root author','a3000000-0000-4000-8000-000000000001',false);
select pg_temp.exercise_quote('blocked reply audience owner','a3000000-0000-4000-8000-000000000002',false);
reset role;
delete from public.social_blocks;
insert into public.social_blocks values('a1000000-0000-4000-8000-000000000004','a1000000-0000-4000-8000-000000000003');
set local role authenticated;
select pg_temp.exercise_quote('reverse-blocked reply audience owner','a3000000-0000-4000-8000-000000000002',false);
reset role;
delete from public.social_blocks;
-- Preserve existing site-staff/report exceptions without widening audience discovery.
insert into private.moderation_staff(user_id,staff_role,active) values
 ('a1000000-0000-4000-8000-000000000003','reviewer',true);
insert into public.social_reports(target_type,target_id) values('post','a3000000-0000-4000-8000-000000000001');
update public.social_posts set moderation_state='removed' where id='a3000000-0000-4000-8000-000000000001';
insert into public.social_blocks values('a1000000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000004');
insert into public.social_mutes values('a1000000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000004');
set local role authenticated;
select pg_temp.exercise_quote('reported staff exception preserves read','a3000000-0000-4000-8000-000000000001',true);
reset role;
update public.social_profiles set is_discoverable=false where id='a1000000-0000-4000-8000-000000000004';
set local role authenticated;
select pg_temp.exercise_quote('staff cannot widen hidden audience','a3000000-0000-4000-8000-000000000001',false);
reset role;
update public.social_profiles set is_discoverable=true where id='a1000000-0000-4000-8000-000000000004';
delete from public.social_reports;
set local role authenticated;
select pg_temp.exercise_quote('staff without report cannot bypass moderation','a3000000-0000-4000-8000-000000000001',false);
reset role;
insert into public.social_reports(target_type,target_id) values('post','a3000000-0000-4000-8000-000000000001');
update private.moderation_staff set active=false;
set local role authenticated;
select pg_temp.exercise_quote('inactive staff exception denied','a3000000-0000-4000-8000-000000000001',false);
reset role;
delete from private.moderation_staff;
delete from public.social_reports;
delete from public.social_blocks;
delete from public.social_mutes;
update public.social_posts set moderation_state='visible' where id='a3000000-0000-4000-8000-000000000001';
update public.social_posts set moderation_state='removed' where id='a3000000-0000-4000-8000-000000000003';
update public.social_profiles set is_discoverable=false where id='a1000000-0000-4000-8000-000000000003';
set local role authenticated;
select pg_temp.exercise_quote('own moderated hidden post remains readable','a3000000-0000-4000-8000-000000000003',true);
reset role;
update public.social_profiles set is_discoverable=true where id='a1000000-0000-4000-8000-000000000003';

-- Eligibility must be checked again as the original author when staff approve.
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000003',true);
set local role authenticated;
select (public.room_submit_post_for_review('a2000000-0000-4000-8000-000000000001',gen_random_uuid(),
  'Recheck moderated target','everyone','a3000000-0000-4000-8000-000000000001','[]')->'submission'->>'id') as recheck_moderation \gset
reset role;
update public.social_posts set moderation_state='removed' where id='a3000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000002',true);
select pg_temp.exercise_decision('decision rechecks moderation',:'recheck_moderation',false);
reset role;
update public.social_posts set moderation_state='visible' where id='a3000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000003',true);
set local role authenticated;
select (public.room_submit_post_for_review('a2000000-0000-4000-8000-000000000001',gen_random_uuid(),
  'Recheck hidden target','everyone','a3000000-0000-4000-8000-000000000001','[]')->'submission'->>'id') as recheck_hidden \gset
reset role;
update public.social_profiles set is_discoverable=false where id='a1000000-0000-4000-8000-000000000004';
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select pg_temp.exercise_decision('decision rechecks discoverability',:'recheck_hidden',false);
reset role;

table quote_results;
do $$ declare mismatches integer; total integer;
begin
  select count(*),count(*) filter(where readable is distinct from accepted) into total,mismatches from quote_results;
  if current_setting('room_test.expect_bug')='true' then
    if mismatches<4 then raise exception 'BASELINE_REPRO_FAILED: % mismatches',mismatches; end if;
    raise notice 'REPRODUCED: % of % quote/decision cases bypass current production visibility.',mismatches,total;
  else
    if mismatches<>0 then raise exception 'QUOTE_PARITY_FAILED: % of % mismatches',mismatches,total; end if;
    raise notice 'PASS: % quote/decision cases match actual production RLS visibility.',total;
  end if;
end $$;
rollback;
