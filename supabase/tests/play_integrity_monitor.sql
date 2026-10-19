-- Run against a disposable local/test database with the migration installed.
-- This transaction creates only synthetic fixtures and always rolls back.
begin;

create function pg_temp.assert_integrity(p_condition boolean, p_description text)
returns void language plpgsql as $$
begin
  if p_condition is distinct from true then raise exception 'Integrity check failed: %', p_description; end if;
end;
$$;

select pg_temp.assert_integrity(not has_table_privilege('anon', 'play_integrity_private.monitor_state', 'SELECT'), 'anon cannot read state');
select pg_temp.assert_integrity(not has_table_privilege('authenticated', 'play_integrity_private.monitor_state', 'SELECT,INSERT,UPDATE,DELETE'), 'users cannot access state table');
select pg_temp.assert_integrity(not has_table_privilege('authenticated', 'play_integrity_private.daily_budget', 'SELECT,INSERT,UPDATE,DELETE'), 'users cannot access global counter');
select pg_temp.assert_integrity(not has_function_privilege('anon', 'public.begin_play_integrity_observation_v1(integer)', 'EXECUTE'), 'anon cannot issue');
select pg_temp.assert_integrity(not has_function_privilege('authenticated', 'public.record_play_integrity_observation_v1(uuid,uuid,uuid,jsonb)', 'EXECUTE'), 'users cannot inject verdicts');
select pg_temp.assert_integrity(has_function_privilege('service_role', 'public.record_play_integrity_observation_v1(uuid,uuid,uuid,jsonb)', 'EXECUTE'), 'server can record');
select pg_temp.assert_integrity((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class where oid in ('play_integrity_private.monitor_state'::regclass, 'play_integrity_private.daily_budget'::regclass)), 'private tables have forced RLS');
select pg_temp.assert_integrity(not (select prosecdef from pg_proc where oid = 'public.begin_play_integrity_observation_v1(integer)'::regprocedure), 'public issue wrapper is invoker');
select pg_temp.assert_integrity(not (select prosecdef from pg_proc where oid = 'public.record_play_integrity_observation_v1(uuid,uuid,uuid,jsonb)'::regprocedure), 'public result RPC is invoker');

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, is_anonymous, created_at, updated_at)
values
 ('aaf0848c-1000-4000-8000-000000000001', 'authenticated', 'authenticated', 'integrity-fixture-one@example.invalid', '{}'::jsonb, '{}'::jsonb, false, now(), now()),
 ('aaf0848c-1000-4000-8000-000000000002', 'authenticated', 'authenticated', 'integrity-fixture-two@example.invalid', '{}'::jsonb, '{}'::jsonb, false, now(), now());
insert into auth.sessions (id, user_id, created_at, updated_at)
values
 ('aaf0848c-2000-4000-8000-000000000001', 'aaf0848c-1000-4000-8000-000000000001', now(), now()),
 ('aaf0848c-2000-4000-8000-000000000002', 'aaf0848c-1000-4000-8000-000000000002', now(), now()),
 ('aaf0848c-2000-4000-8000-000000000003', 'aaf0848c-1000-4000-8000-000000000001', now(), now());

do $checks$
declare
  v_first jsonb;
  v_next jsonb;
  v_recorded boolean;
  v_challenge uuid;
  v_uid uuid := 'aaf0848c-1000-4000-8000-000000000001';
  v_session uuid := 'aaf0848c-2000-4000-8000-000000000001';
  v_summary jsonb := '{"outcome":"observed","app_recognition":"PLAY_RECOGNIZED","certificate_match":true,"version_match":true,"app_version_code":44,"licensing":"LICENSED","device_recognition":["MEETS_DEVICE_INTEGRITY"]}'::jsonb;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', v_uid, 'session_id', v_session, 'is_anonymous', false)::text, true);
  execute 'set local role authenticated';
  v_first := public.begin_play_integrity_observation_v1(44);
  execute 'reset role';
  perform pg_temp.assert_integrity(v_first->>'status' = 'ready', 'real user and owned session can issue');
  v_challenge := (v_first->>'challenge_id')::uuid;
  perform pg_temp.assert_integrity((v_first->>'expires_at_ms')::bigint - (v_first->>'issued_at_ms')::bigint = 300000, 'challenge TTL is 300 seconds');
  perform pg_temp.assert_integrity((public.begin_play_integrity_observation_v1(44))->>'status' = 'rate_limited', 'second immediate issue is limited');
  perform pg_temp.assert_integrity((select count(*) = 1 from play_integrity_private.monitor_state where user_id = v_uid), 'one row per user');

  perform set_config('request.jwt.claims', '{"role":"authenticated","sub":"aaf0848c-1000-4000-8000-000000000002","session_id":"aaf0848c-2000-4000-8000-000000000002"}', true);
  perform pg_temp.assert_integrity(public.consume_play_integrity_observation_v1(v_challenge)->>'status' = 'invalid_challenge', 'another user cannot consume');
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', v_uid, 'session_id', 'aaf0848c-2000-4000-8000-000000000003')::text, true);
  perform pg_temp.assert_integrity(public.consume_play_integrity_observation_v1(v_challenge)->>'status' = 'invalid_challenge', 'another session of same user cannot consume');
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', v_uid, 'session_id', v_session)::text, true);
  execute 'set local role authenticated';
  v_next := public.consume_play_integrity_observation_v1(v_challenge);
  execute 'reset role';
  perform pg_temp.assert_integrity(v_next->>'status' = 'ready', 'owned challenge consumed as authenticated role');
  perform pg_temp.assert_integrity(public.consume_play_integrity_observation_v1(v_challenge)->>'status' = 'invalid_challenge', 'same challenge consumed only once');
  execute 'set local role service_role';
  v_recorded := public.record_play_integrity_observation_v1(v_uid, v_session, v_challenge, v_summary);
  execute 'reset role';
  perform pg_temp.assert_integrity(v_recorded, 'sanitized result recorded as service_role');
  perform pg_temp.assert_integrity(not public.record_play_integrity_observation_v1(v_uid, v_session, v_challenge, v_summary), 'duplicate result not counted');
  perform pg_temp.assert_integrity((select observed_count = 1 from play_integrity_private.monitor_state where user_id = v_uid), 'count incremented once');

  perform pg_temp.assert_integrity(not play_integrity_private.valid_summary_v1(v_summary || '{"email":"private@example.invalid"}'::jsonb), 'unknown fields rejected');
  perform pg_temp.assert_integrity(not play_integrity_private.valid_summary_v1(v_summary || '{"app_recognition":null}'::jsonb), 'null recognition rejected');
  perform pg_temp.assert_integrity(not play_integrity_private.valid_summary_v1(v_summary || '{"licensing":null}'::jsonb), 'null licensing rejected');
  perform pg_temp.assert_integrity(not play_integrity_private.valid_summary_v1(v_summary || '{"device_recognition":[null]}'::jsonb), 'null device label rejected');
  perform pg_temp.assert_integrity(not play_integrity_private.valid_summary_v1(v_summary || '{"app_version_code":9999999999}'::jsonb), 'version overflow rejected');
  perform pg_temp.assert_integrity(play_integrity_private.valid_summary_v1('{"outcome":"google_unavailable"}'), 'bounded Google error category allowed');
  perform pg_temp.assert_integrity(not play_integrity_private.valid_summary_v1('{"outcome":"google_unavailable","integrity_token":"sensitive"}'), 'raw token rejected');

  -- A newer challenge supersedes any delayed completion of the previous one.
  update play_integrity_private.monitor_state set issued_at = now() - interval '11 minutes', expires_at = now() - interval '6 minutes' where user_id = v_uid;
  v_next := public.begin_play_integrity_observation_v1(44);
  perform pg_temp.assert_integrity(v_next->>'status' = 'ready', 'sample can issue after cooldown');
  perform pg_temp.assert_integrity(not public.record_play_integrity_observation_v1(v_uid, v_session, v_challenge, v_summary), 'old completion cannot overwrite new challenge');
  v_challenge := (v_next->>'challenge_id')::uuid;
  update play_integrity_private.monitor_state set issued_at = now() - interval '6 minutes', expires_at = now() - interval '1 minute' where user_id = v_uid;
  perform pg_temp.assert_integrity(public.consume_play_integrity_observation_v1(v_challenge)->>'status' = 'invalid_challenge', 'expired challenge rejected');

  update play_integrity_private.monitor_state set issued_at = now() - interval '11 minutes', expires_at = now() - interval '6 minutes', issued_count = 12 where user_id = v_uid;
  perform pg_temp.assert_integrity(public.begin_play_integrity_observation_v1(44)->>'status' = 'rate_limited', 'per-user daily cap enforced');
  update play_integrity_private.monitor_state set counter_day = (now() at time zone 'UTC')::date - 1 where user_id = v_uid;
  update play_integrity_private.daily_budget set counter_day = (now() at time zone 'UTC')::date - 1, issued_count = 8000 where singleton;
  perform pg_temp.assert_integrity(public.begin_play_integrity_observation_v1(44)->>'status' = 'ready', 'UTC daily windows reset');
  perform pg_temp.assert_integrity((select issued_count = 1 and observed_count = 0 from play_integrity_private.monitor_state where user_id = v_uid), 'new day counters bounded');
  update play_integrity_private.daily_budget set issued_count = 8000 where singleton;
  perform pg_temp.assert_integrity(public.begin_play_integrity_observation_v1(44)->>'status' = 'rate_limited', 'global daily cap enforced');

  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', v_uid, 'session_id', v_session, 'is_anonymous', true)::text, true);
  begin
    perform public.begin_play_integrity_observation_v1(44);
    raise exception 'Anonymous identity accepted';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', v_uid, 'session_id', v_session)::text, true);
  update auth.sessions set not_after = now() - interval '1 minute' where id = v_session;
  begin
    perform public.begin_play_integrity_observation_v1(44);
    raise exception 'Expired session accepted';
  exception when insufficient_privilege then null; end;
  delete from auth.sessions where id = v_session;
  begin
    perform public.begin_play_integrity_observation_v1(44);
    raise exception 'Logged-out session accepted';
  exception when insufficient_privilege then null; end;

  update play_integrity_private.monitor_state set last_sample_at = now() - interval '31 days', last_activity_at = now(), last_summary = v_summary where user_id = v_uid;
  perform play_integrity_private.expire_observations_v1();
  perform pg_temp.assert_integrity((select last_summary is null and last_sample_at is null from play_integrity_private.monitor_state where user_id = v_uid), 'active account old observation expires');
  update play_integrity_private.monitor_state set last_activity_at = now() - interval '31 days' where user_id = v_uid;
  perform play_integrity_private.expire_observations_v1();
  perform pg_temp.assert_integrity(not exists (select 1 from play_integrity_private.monitor_state where user_id = v_uid), 'inactive state removed within retention');
  insert into play_integrity_private.monitor_state (user_id, counter_day) values (v_uid, (now() at time zone 'UTC')::date);
  delete from auth.users where id = v_uid;
  perform pg_temp.assert_integrity(not exists (select 1 from play_integrity_private.monitor_state where user_id = v_uid), 'account deletion cascades');
end;
$checks$;

select 'Play Integrity database checks passed; synthetic fixture changes will roll back.' as result;
rollback;
