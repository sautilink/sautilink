-- Disposable local database only. Applies the new migration after capturing catalogs.
do $$ begin if current_database() not like 'sautilink_rooms_test_conflicts_%' then raise exception 'LOCAL_TEST_DATABASE_REQUIRED'; end if; end $$;
create temp table conflict_before as select p.oid function_oid,p.prosrc,to_jsonb(p)-'prosrc' metadata
from pg_proc p where p.oid in (
 'public.room_decide_post_submission(uuid,uuid,uuid,integer,text,text)'::regprocedure,
 'public.room_withdraw_post_submission(uuid,uuid,uuid,integer)'::regprocedure,
 'public.room_update_management(uuid,integer,uuid,jsonb,jsonb)'::regprocedure,
 'private.enforce_room_membership_questions()'::regprocedure,
 'public.room_submit_membership_request(uuid,integer,uuid,jsonb,text)'::regprocedure,
 'public.room_set_post_pin(uuid,uuid,boolean,uuid)'::regprocedure);
create temp table conflict_untouched_functions as select p.oid,to_jsonb(p) metadata from pg_proc p
join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private','policy_private','auth')
and p.oid not in(select function_oid from conflict_before);
create temp table conflict_security_before as
select 'relation' kind,c.oid,to_jsonb(c) metadata from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname in('public','private','policy_private','auth')
union all select 'policy',p.oid,to_jsonb(p) from pg_policy p
union all select 'trigger',t.oid,to_jsonb(t) from pg_trigger t where not t.tgisinternal;
\ir ../migrations/20261016022505_rooms_business_conflicts_http409.sql
do $$ declare item record; changed integer:=0; current_meta jsonb; current_src text; begin
 if (select count(*) from conflict_before)<>6 then raise exception 'EXPECTED_SIX_EXISTING_FUNCTIONS'; end if;
 for item in select * from conflict_before loop
  select prosrc,to_jsonb(p)-'prosrc' into current_src,current_meta from pg_proc p where oid=item.function_oid;
  if current_meta is distinct from item.metadata then raise exception 'FUNCTION_METADATA_CHANGED: %',item.function_oid::regprocedure; end if;
  if replace(replace(current_src,E'\r\n',E'\n'),'errcode=''PT409''','errcode=''40001''')<>replace(item.prosrc,E'\r\n',E'\n') then raise exception 'UNEXPECTED_BODY_CHANGE'; end if;
  if position('errcode=''40001''' in current_src)>0 then raise exception 'BUSINESS_SERIALIZATION_FAILURE_REMAINS'; end if;
  changed:=changed+(length(current_src)-length(replace(current_src,'errcode=''PT409''','')))/length('errcode=''PT409''');
 end loop;
 if changed<>11 then raise exception 'EXPECTED_ELEVEN_BUSINESS_CONFLICT_RAISES'; end if;
 if exists(select from conflict_untouched_functions b full join
  (select p.oid,to_jsonb(p) metadata from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname in('public','private','policy_private','auth') and p.oid not in(select function_oid from conflict_before)) a using(oid)
  where b.metadata is distinct from a.metadata) then raise exception 'UNRELATED_FUNCTION_CHANGED'; end if;
 if exists(select from conflict_security_before b full join
  (select 'relation' kind,c.oid,to_jsonb(c) metadata from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in('public','private','policy_private','auth')
   union all select 'policy',p.oid,to_jsonb(p) from pg_policy p
   union all select 'trigger',t.oid,to_jsonb(t) from pg_trigger t where not t.tgisinternal) a using(kind,oid)
  where b.metadata is distinct from a.metadata) then raise exception 'RLS_ACL_RELATION_OR_TRIGGER_CHANGED'; end if;
 raise notice 'PASS: 6 exact function-body/identity/owner/ACL/security contracts, 11 business SQLSTATE changes, unrelated functions and all relation/policy/trigger catalogs preserved.';
end $$;
