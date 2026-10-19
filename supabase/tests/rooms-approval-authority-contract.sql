-- Existing production private-schema USAGE must not expose the new queue.
begin;
do $$
declare p record; t text; private_count integer:=0; public_count integer:=0;
begin
  if current_database() not like 'sautilink_rooms_test%' then raise exception 'LOCAL_TEST_DATABASE_REQUIRED'; end if;
  if not has_schema_privilege('authenticated','private','usage') then raise exception 'PRODUCTION_SCHEMA_USAGE_MISSING'; end if;
  foreach t in array array['room_post_submissions','room_post_submission_media','room_post_decision_audit'] loop
    if has_table_privilege('authenticated','private.'||t,'select,insert,update,delete') or
       has_table_privilege('anon','private.'||t,'select,insert,update,delete') then
      raise exception 'QUEUE_TABLE_PRIVILEGE: %',t;
    end if;
    if not exists(select from pg_class where oid=('private.'||t)::regclass and relrowsecurity and relforcerowsecurity) then
      raise exception 'QUEUE_RLS_NOT_FORCED: %',t;
    end if;
  end loop;
  for p in select oid,proname,prosecdef,proconfig,proacl,proowner,pronamespace from pg_proc where
    (pronamespace='private'::regnamespace and proname=any(array[
      'guard_room_approval_publication','guard_room_submission_media_hold',
      'release_room_submissions_before_profile_delete','room_submission_json',
      'room_approval_room','room_quote_visible_to','room_approval_notice','audit_room_post_approval_setting'])) or
    (pronamespace='public'::regnamespace and proname=any(array[
      'room_post_approval_capabilities','room_submit_post_for_review','room_list_post_submissions',
      'room_get_post_submission','room_submission_media_for_review','room_decide_post_submission',
      'room_withdraw_post_submission','room_post_approval_audit','room_post_submission_route','room_held_media_uploads'])) loop
    if p.proconfig is null or not p.proconfig @> array['search_path=""'] then raise exception 'UNSAFE_SEARCH_PATH: %',p.proname; end if;
    if exists(select from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) where grantee=0 and privilege_type='EXECUTE') or
       has_function_privilege('anon',p.oid,'execute') then raise exception 'PUBLIC_EXECUTE: %',p.proname; end if;
    if p.pronamespace='private'::regnamespace then
      private_count:=private_count+1;
      if has_function_privilege('authenticated',p.oid,'execute') then raise exception 'PRIVATE_EXECUTE: %',p.proname; end if;
    else
      public_count:=public_count+1;
      if not p.prosecdef or not has_function_privilege('authenticated',p.oid,'execute') then raise exception 'PUBLIC_RPC_CONTRACT: %',p.proname; end if;
    end if;
  end loop;
  if private_count<>8 or public_count<>10 then raise exception 'FUNCTION_COVERAGE: private %, public %',private_count,public_count; end if;
  raise notice 'PASS: 3 private queue tables FORCE RLS; 8 internal helpers and 10 public RPCs retain explicit authority with existing private-schema USAGE.';
end;
$$;
set local role authenticated;
do $$ begin
  begin perform 1 from private.room_post_submissions; raise exception 'UNEXPECTED_TABLE_READ';
    exception when insufficient_privilege then null; end;
  begin perform private.room_quote_visible_to(gen_random_uuid(),gen_random_uuid()); raise exception 'UNEXPECTED_HELPER_EXECUTE';
    exception when insufficient_privilege then null; end;
end $$;
rollback;
