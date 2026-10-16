-- REVIEW ONLY. Do not execute without the owner's explicit approval for this
-- separate five-process recovery contingency.
--
-- Preconditions for the operator:
-- 1. Apply and read back the approved PT409 migration first.
-- 2. Allow a bounded drain interval; do nothing if the failed loops stop.
-- 3. Read-only evidence must show these known processes are still retrying the
--    same business conflict AFTER that apply. An idle connection is not a loop.
-- 4. Preserve the before/after result. Do not add new PIDs or restart PostgREST.
--
-- The actor/Room parameters are hidden in prepared SQL. These five PIDs are
-- identified failed function processes, NOT proven per-actor QA sessions.
-- Termination can interrupt the matching in-flight request and is not undone
-- by a SQL transaction rollback. The guards below are additional protection;
-- they do not replace owner approval or the post-apply continued-loop evidence.

with
expected_functions(signature,body_md5,acl_md5) as (values
 ('private.enforce_room_membership_questions()','c8e2e9ac01ece6f55fe841fc80631c9c','dfda960bf9e0be03ea7516906ee58e3b'),
 ('public.room_decide_post_submission(uuid,uuid,uuid,integer,text,text)','27bf4cbfb763250f4e3ef6fb17ac16f1','06c8bd810f2d9a52a993cd903c13793a'),
 ('public.room_set_post_pin(uuid,uuid,boolean,uuid)','9679603bd4d693f2f703b0273599c992','06c8bd810f2d9a52a993cd903c13793a'),
 ('public.room_submit_membership_request(uuid,integer,uuid,jsonb,text)','96a723f2532f26516b7dbc486dad6de2','06c8bd810f2d9a52a993cd903c13793a'),
 ('public.room_update_management(uuid,integer,uuid,jsonb,jsonb)','e13ade02ab16969eec0385e5a5dc5b3e','06c8bd810f2d9a52a993cd903c13793a'),
 ('public.room_withdraw_post_submission(uuid,uuid,uuid,integer)','86be787b391e6382760dd965ace7a7d2','06c8bd810f2d9a52a993cd903c13793a')
),
patch_gate as materialized (
 select count(p.oid)=6 and bool_and(
   md5(replace(p.prosrc,E'\r\n',E'\n'))=e.body_md5
   and pg_get_userbyid(p.proowner)='postgres'
   and p.prosecdef
   and md5(coalesce(p.proconfig::text,''))='af3be9c3d4c2d891da1a7618c49685d3'
   and md5(coalesce(p.proacl::text,''))=e.acl_md5
 ) as exact_patch_and_authority_match
 from expected_functions e left join pg_proc p on p.oid=to_regprocedure(e.signature)
),
known(pid,backend_start) as (values
 (2253463,'2026-10-16T01:22:15.909804+00:00'::timestamptz),
 (2254139,'2026-10-16T01:24:35.147505+00:00'::timestamptz),
 (2257925,'2026-10-16T02:10:52.707537+00:00'::timestamptz),
 (2257959,'2026-10-16T02:12:19.574702+00:00'::timestamptz),
 (2258796,'2026-10-16T02:20:51.633092+00:00'::timestamptz)
),
checked as materialized (
 select k.pid,
   coalesce(g.exact_patch_and_authority_match,false) as patch_matches,
   a.pid is not null as backend_exists,
   coalesce(a.backend_start=k.backend_start,false) as backend_start_matches,
   coalesce(a.datname=current_database(),false) as current_database_matches,
   coalesce(a.usename='authenticator',false) as authenticator_role_matches,
   coalesce(a.application_name='PostgREST 14.5',false) as postgrest_application_matches,
   coalesce(a.state='active' and a.xact_start is not null,false) as active_transaction,
   coalesce(md5(a.query)='306e0b4616df42b4272df4d6dced889c',false) as exact_statement_hash_matches,
   coalesce(a.query ~ '(^|[^[:alnum:]_])"?room_update_management"?[[:space:]]*[(]',false) as exact_function_invocation,
   a.wait_event_type,a.wait_event
 from known k cross join patch_gate g left join pg_stat_activity a on a.pid=k.pid
),
eligible as materialized (
 select *,patch_matches and backend_exists and backend_start_matches
   and current_database_matches and authenticator_role_matches
   and postgrest_application_matches and active_transaction
   and exact_statement_hash_matches and exact_function_invocation
   and pid<>pg_backend_pid() as may_stop_known_loop
 from checked
)
select clock_timestamp() as observed_at,pid,patch_matches,backend_exists,
 backend_start_matches,current_database_matches,authenticator_role_matches,
 postgrest_application_matches,active_transaction,exact_statement_hash_matches,
 exact_function_invocation,wait_event_type,wait_event,may_stop_known_loop,
 case when may_stop_known_loop then pg_terminate_backend(pid,5000)
      else false end as termination_confirmed
from eligible order by pid;
