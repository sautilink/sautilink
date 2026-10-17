-- Return business conflicts directly to PostgREST; custom serialization_failure
-- (40001) is retried by PostgREST14. PT409 preserves the existing HTTP409 contract.
-- Six existing function definitions; ONLY eleven explicit business errcode literals change.
-- Owners, ACLs, signatures, security/search_path, tables, RLS and messages are unchanged.
-- Source: https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b
-- A reviewed owner-approved production apply is required. Existing in-flight retries
-- are outside this migration: it never terminates sessions or changes timeouts.

begin;

do $room_conflict_baseline$
declare target record; actual text;
begin
 for target in select * from (values
  ('public.room_decide_post_submission(uuid,uuid,uuid,integer,text,text)','cb062f59e0c38e7e7546e243a3ce7df4'),
  ('public.room_withdraw_post_submission(uuid,uuid,uuid,integer)','3e01aaa804ebc98b0abfa69eea5e7ff9'),
  ('public.room_update_management(uuid,integer,uuid,jsonb,jsonb)','229a17004743b7738a82a8810a692ab6'),
  ('private.enforce_room_membership_questions()','9baae7b75b2f25dd5545b6d167828ce5'),
  ('public.room_submit_membership_request(uuid,integer,uuid,jsonb,text)','9479aecd78ba36deb4396493009495e6'),
  ('public.room_set_post_pin(uuid,uuid,boolean,uuid)','2e5b12b355fd10ed8f8ceb7a24322304')
 ) expected(signature,body_md5) loop
  select replace(prosrc,E'\r\n',E'\n') into actual from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure(target.signature);
  if actual is null or md5(actual)<>target.body_md5 then
   raise exception 'ROOM_CONFLICT_PATCH_BASELINE_MISMATCH: %',target.signature;
  end if;
 end loop;
end;
$room_conflict_baseline$;

create or replace function public.room_decide_post_submission(p_room_id uuid,p_submission_id uuid,p_request_id uuid,
  p_expected_version integer,p_decision text,p_reason text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.social_circles%rowtype; s private.room_post_submissions%rowtype; actor_role text; author_role text;
  new_post_id uuid; m public.social_post_media%rowtype; held_count integer; released_ids uuid[];
begin
  r:=private.room_approval_room(p_room_id);
  select * into s from private.room_post_submissions where id=p_submission_id and room_id=p_room_id for update;
  if not found then raise exception 'SUBMISSION_UNAVAILABLE' using errcode='P0002'; end if;
  perform 1 from public.social_circle_members where circle_id=p_room_id and member_id in(auth.uid(),s.author_id) order by member_id for share;
  actor_role:=policy_private.room_member_role(p_room_id,auth.uid());
  if actor_role is null or actor_role not in('owner','admin','moderator') or s.author_id=auth.uid() then raise exception 'ROOM_STAFF_REQUIRED' using errcode='42501'; end if;
  if p_request_id is null or p_decision is null or p_decision not in('approve','reject') then raise exception 'INVALID_DECISION'; end if;
  p_reason:=nullif(btrim(coalesce(p_reason,'')),'');
  if char_length(coalesce(p_reason,''))>500 or (p_decision='reject' and p_reason is null) then raise exception 'REJECTION_REASON_REQUIRED'; end if;
  if s.state<>'pending' then
    if s.decision_request_id=p_request_id and s.decided_by=auth.uid() and
        s.state=(case when p_decision='approve' then 'approved' else 'rejected' end) and s.decision_reason is not distinct from p_reason then
      return jsonb_build_object('submission',private.room_submission_json(s),'post_id',s.published_post_id);
    end if;
    raise exception 'ALREADY_DECIDED' using errcode='PT409';
  end if;
  if p_expected_version is distinct from s.version then raise exception 'VERSION_CONFLICT' using errcode='PT409'; end if;
  if p_decision='approve' then
    author_role:=policy_private.room_member_role(p_room_id,s.author_id);
    if author_role is null or (r.post_permission='staff_only' and author_role not in('owner','admin','moderator')) or
      exists(select from public.social_blocks where (blocker_id=r.owner_id and blocked_id=s.author_id) or (blocked_id=r.owner_id and blocker_id=s.author_id)) then
      raise exception 'AUTHOR_NO_LONGER_ALLOWED' using errcode='42501';
    end if;
    if s.quote_post_id is not null and not private.room_quote_visible_to(s.quote_post_id,s.author_id) then raise exception 'QUOTE_UNAVAILABLE'; end if;
    held_count:=0;
    for m in select media.* from private.room_post_submission_media l join public.social_post_media media on media.id=l.media_id
      where l.submission_id=s.id order by media.id for update of media loop
      if m.owner_id<>s.author_id or m.post_id is not null or m.upload_status<>'ready' or m.finalized_at is null then raise exception 'MEDIA_NOT_READY'; end if;
      held_count:=held_count+1;
    end loop;
    if held_count<>s.media_count then raise exception 'MEDIA_NOT_READY'; end if;
    new_post_id:=gen_random_uuid();
    update private.room_post_submissions set state='approved',version=version+1,decided_at=now(),decided_by=auth.uid(),
      decision_request_id=p_request_id,decision_reason=p_reason,published_post_id=new_post_id where id=s.id returning * into s;
    insert into public.social_posts(id,author_id,circle_id,visibility,post_status,body,reply_access,quote_post_id,media_count,client_request_id,created_at)
      values(new_post_id,s.author_id,s.room_id,'circle','published',s.body,s.reply_access,s.quote_post_id,s.media_count,s.client_request_id,now());
    update public.social_post_media media set post_id=s.published_post_id,position=l.position,alt_text=l.alt_text,
      upload_status='attached',attached_at=now()
      from private.room_post_submission_media l where l.submission_id=s.id and l.media_id=media.id;
  else
    update private.room_post_submissions set state='rejected',version=version+1,decided_at=now(),decided_by=auth.uid(),
      decision_request_id=p_request_id,decision_reason=p_reason where id=s.id returning * into s;
  end if;
  -- Separate commands make hold deletion visible to the media guard before
  -- restoring rejected ready uploads. All commands remain in this transaction.
  select array_agg(media_id) into released_ids from private.room_post_submission_media where submission_id=s.id;
  delete from private.room_post_submission_media where submission_id=s.id;
  update public.social_post_media set expires_at=now()+interval '1 hour' where id=any(released_ids) and post_id is null;
  insert into private.room_post_decision_audit(room_id,submission_id,actor_id,actor_role,action,old_state,new_state,request_id,reason)
    values(p_room_id,s.id,auth.uid(),actor_role,s.state,'pending',s.state,p_request_id,p_reason);
  delete from public.social_notifications where room_submission_id=s.id and circle_event='post_approval_requested';
  perform private.room_approval_notice(s,case when s.state='approved' then 'post_approved' else 'post_rejected' end,s.author_id);
  return jsonb_build_object('submission',private.room_submission_json(s),'post_id',s.published_post_id);
end;
$$;

create or replace function public.room_withdraw_post_submission(p_room_id uuid,p_submission_id uuid,p_request_id uuid,p_expected_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.room_post_submissions%rowtype; released_ids uuid[];
begin
  perform private.room_approval_room(p_room_id);
  select * into s from private.room_post_submissions where id=p_submission_id and room_id=p_room_id and author_id=auth.uid() for update;
  if not found then raise exception 'SUBMISSION_UNAVAILABLE' using errcode='P0002'; end if;
  if p_request_id is null then raise exception 'REQUEST_ID_REQUIRED'; end if;
  if s.state='withdrawn' and s.decision_request_id=p_request_id then return jsonb_build_object('submission',private.room_submission_json(s)); end if;
  if s.state<>'pending' then raise exception 'ALREADY_DECIDED' using errcode='PT409'; end if;
  if p_expected_version is distinct from s.version then raise exception 'VERSION_CONFLICT' using errcode='PT409'; end if;
  update private.room_post_submissions set state='withdrawn',version=version+1,decided_at=now(),decided_by=auth.uid(),decision_request_id=p_request_id
    where id=s.id returning * into s;
  select array_agg(media_id) into released_ids from private.room_post_submission_media where submission_id=s.id;
  delete from private.room_post_submission_media where submission_id=s.id;
  update public.social_post_media set expires_at=now()+interval '1 hour' where id=any(released_ids) and post_id is null;
  insert into private.room_post_decision_audit(room_id,submission_id,actor_id,actor_role,action,old_state,new_state,request_id)
    values(p_room_id,s.id,auth.uid(),'author','withdrawn','pending','withdrawn',p_request_id);
  delete from public.social_notifications where room_submission_id=s.id and circle_event='post_approval_requested';
  return jsonb_build_object('submission',private.room_submission_json(s));
end;
$$;

create or replace function public.room_update_management(p_room_id uuid,p_expected_version integer,p_request_id uuid,p_rules jsonb,p_questions jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg private.room_management_config%rowtype; item jsonb; result jsonb; payload jsonb;
  rules_value jsonb:='[]'; questions_value jsonb:='[]'; identity_id uuid;
begin
 perform private.room_management_room(p_room_id);
 perform pg_advisory_xact_lock(hashtextextended('room-management:'||p_room_id::text,0));
 perform private.room_management_role(p_room_id,true);
 if p_expected_version is null or p_expected_version<1 or jsonb_typeof(p_rules) is distinct from 'array' or
   jsonb_typeof(p_questions) is distinct from 'array' or jsonb_array_length(p_rules)>10 or jsonb_array_length(p_questions)>3 then
   raise exception 'INVALID_ROOM_MANAGEMENT';
 end if;
 for item in select value from jsonb_array_elements(p_rules) loop
   if jsonb_typeof(item)<>'object' or jsonb_typeof(item->'id') is distinct from 'string' or
     jsonb_typeof(item->'title') is distinct from 'string' or jsonb_typeof(item->'body') is distinct from 'string' or
     char_length(btrim(item->>'title')) not between 1 and 120 or char_length(btrim(item->>'body'))>1000 then
     raise exception 'INVALID_ROOM_MANAGEMENT';
   end if;
   begin identity_id:=(item->>'id')::uuid; exception when invalid_text_representation then raise exception 'INVALID_ROOM_MANAGEMENT'; end;
   if identity_id is null or identity_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' or
     exists(select from jsonb_array_elements(rules_value) x where x->>'id'=identity_id::text) then raise exception 'INVALID_ROOM_MANAGEMENT'; end if;
   rules_value:=rules_value||jsonb_build_array(jsonb_build_object('id',identity_id,'title',btrim(item->>'title'),'body',btrim(item->>'body')));
 end loop;
 for item in select value from jsonb_array_elements(p_questions) loop
   if jsonb_typeof(item)<>'object' or jsonb_typeof(item->'id') is distinct from 'string' or
     jsonb_typeof(item->'prompt') is distinct from 'string' or jsonb_typeof(item->'required') is distinct from 'boolean' or
     char_length(btrim(item->>'prompt')) not between 1 and 300 then raise exception 'INVALID_ROOM_MANAGEMENT'; end if;
   begin identity_id:=(item->>'id')::uuid; exception when invalid_text_representation then raise exception 'INVALID_ROOM_MANAGEMENT'; end;
   if identity_id is null or identity_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' or
     exists(select from jsonb_array_elements(questions_value) x where x->>'id'=identity_id::text) then raise exception 'INVALID_ROOM_MANAGEMENT'; end if;
   questions_value:=questions_value||jsonb_build_array(jsonb_build_object('id',identity_id,'prompt',btrim(item->>'prompt'),'required',(item->>'required')::boolean));
 end loop;
 payload:=jsonb_build_object('expected_version',p_expected_version,'rules',rules_value,'questions',questions_value);
 result:=private.room_management_receipt(p_room_id,p_request_id,'config',payload);
 if result is not null then return result; end if;
 select * into cfg from private.room_management_config where room_id=p_room_id for update;
 if not found then raise exception 'ROOM_UNAVAILABLE' using errcode='P0002'; end if;
 if cfg.version<>p_expected_version then raise exception 'ROOM_MANAGEMENT_VERSION_CONFLICT' using errcode='PT409'; end if;
 if jsonb_array_length(cfg.questions)=0 and jsonb_array_length(questions_value)>0 then
   -- Snapshot pending requests that predate enablement using server-observed
   -- rows, never caller-supplied created_at. Existing approvals remain valid.
   insert into private.room_membership_answers(room_id,requester_id,config_version,questions,answers,source)
     select p_room_id,requester_id,cfg.version,'[]','[]','legacy' from public.social_circle_join_requests
       where circle_id=p_room_id and status='pending' on conflict do nothing;
 end if;
 update private.room_management_config set version=version+1,rules=rules_value,questions=questions_value,
   updated_at=clock_timestamp(),updated_by=auth.uid() where room_id=p_room_id returning * into cfg;
 result:=private.room_management_json(cfg);
 insert into private.room_management_receipts values(auth.uid(),p_request_id,p_room_id,'config',payload,result,now());
 insert into private.room_management_audit(room_id,actor_id,action,request_id) values(p_room_id,auth.uid(),'config',p_request_id);
 return result;
end;
$$;

create or replace function private.enforce_room_membership_questions()
returns trigger language plpgsql security definer set search_path='' as $$
declare cfg private.room_management_config%rowtype; applicant uuid; proof private.room_membership_answers%rowtype; owner_id uuid;
  current_room public.social_circles%rowtype; has_proof boolean;
begin
 if tg_table_name='social_circle_members' then
   select room.owner_id into owner_id from public.social_circles room where room.id=new.circle_id;
   if new.member_role='owner' and new.member_id=owner_id then return new; end if;
   applicant:=new.member_id;
 else applicant:=new.requester_id; end if;
 -- Existing database maintenance/bootstrap can have no JWT. Ordinary caller
 -- inserts still need the unchanged authenticated RLS policies.
 if auth.uid() is null then return new; end if;
 select * into cfg from private.room_management_config where room_id=new.circle_id for share;
 if not found then raise exception 'ROOM_UNAVAILABLE' using errcode='P0002'; end if;
 select * into proof from private.room_membership_answers where room_id=new.circle_id and requester_id=applicant;
 has_proof:=found;
 -- Recheck privileged self-admission at the actual INSERT, after every wait.
 -- Existing empty-question direct callers retain their unchanged RLS path.
 if has_proof and applicant=auth.uid() and proof.admission_transaction=txid_current() then
   current_room:=private.room_management_room(new.circle_id);
   if (proof.source='open' and current_room.join_policy<>'open') or
      (proof.source='request' and current_room.join_policy<>'approval') then
     raise exception 'MEMBERSHIP_STATE_CHANGED' using errcode='PT409';
   end if;
 end if;
 if jsonb_array_length(cfg.questions)=0 then return new; end if;
 if tg_table_name='social_circle_join_requests' then
   if has_proof and applicant=auth.uid() and proof.admission_transaction=txid_current() and
     proof.config_version=cfg.version and proof.source='request' then return new; end if;
 elsif applicant=auth.uid() then
   if has_proof and proof.admission_transaction=txid_current() and proof.config_version=cfg.version and
     proof.source in('open','invitation') then return new; end if;
 elsif has_proof and proof.source in('request','legacy') and policy_private.is_room_staff(new.circle_id,auth.uid()) and exists(
   select from public.social_circle_join_requests where circle_id=new.circle_id and requester_id=applicant and status='approved') then
   return new;
 end if;
 raise exception 'ROOM_QUESTIONS_REQUIRED' using errcode='42501';
end;
$$;

create or replace function public.room_submit_membership_request(p_room_id uuid,p_expected_version integer,p_request_id uuid,p_answers jsonb,p_action_kind text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.social_circles%rowtype; cfg private.room_management_config%rowtype; item jsonb; question jsonb;
  answer_values jsonb:='[]'; identity_id uuid; payload jsonb; result jsonb; destination text; invitation_status text; request_status text;
begin
 r:=private.room_management_room(p_room_id);
 perform pg_advisory_xact_lock(hashtextextended('room-management:'||p_room_id::text,0));
 -- Owner settings and blocks can change while the advisory lock is awaited.
 r:=private.room_management_room(p_room_id);
 if p_expected_version is null or p_expected_version<1 or p_action_kind is null or p_action_kind not in('join','request','accept_invitation') or
   jsonb_typeof(p_answers) is distinct from 'array' or jsonb_array_length(p_answers)>3 then raise exception 'INVALID_ROOM_ANSWERS'; end if;
 for item in select value from jsonb_array_elements(p_answers) loop
   if jsonb_typeof(item)<>'object' or jsonb_typeof(item->'question_id') is distinct from 'string' or
     jsonb_typeof(item->'answer') is distinct from 'string' or char_length(btrim(item->>'answer'))>1000 then raise exception 'INVALID_ROOM_ANSWERS'; end if;
   begin identity_id:=(item->>'question_id')::uuid; exception when invalid_text_representation then raise exception 'INVALID_ROOM_ANSWERS'; end;
   if identity_id is null or identity_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' or
     exists(select from jsonb_array_elements(answer_values) x where x->>'question_id'=identity_id::text) then raise exception 'INVALID_ROOM_ANSWERS'; end if;
   answer_values:=answer_values||jsonb_build_array(jsonb_build_object('question_id',identity_id,'answer',btrim(item->>'answer')));
 end loop;
 select coalesce(jsonb_agg(value order by value->>'question_id'),'[]') into answer_values from jsonb_array_elements(answer_values);
 payload:=jsonb_build_object('expected_version',p_expected_version,'answers',answer_values,'action_kind',p_action_kind);
 result:=private.room_management_receipt(p_room_id,p_request_id,'membership',payload);
 if result is not null then
   if policy_private.is_room_member(p_room_id,auth.uid()) then return result||jsonb_build_object('status','member'); end if;
   if result->>'status'='pending' and exists(select from public.social_circle_join_requests where circle_id=p_room_id and requester_id=auth.uid() and status='pending') then return result; end if;
   raise exception 'MEMBERSHIP_STATE_CHANGED' using errcode='PT409';
 end if;
 select * into cfg from private.room_management_config where room_id=p_room_id for share;
 if not found then raise exception 'ROOM_UNAVAILABLE' using errcode='P0002'; end if;
 if cfg.version<>p_expected_version then raise exception 'ROOM_MANAGEMENT_VERSION_CONFLICT' using errcode='PT409'; end if;
 for item in select value from jsonb_array_elements(answer_values) loop
   if not exists(select from jsonb_array_elements(cfg.questions) q where q->>'id'=item->>'question_id') then raise exception 'INVALID_ROOM_ANSWERS'; end if;
 end loop;
 for question in select value from jsonb_array_elements(cfg.questions) loop
   if (question->>'required')::boolean and not exists(select from jsonb_array_elements(answer_values) a where
      a->>'question_id'=question->>'id' and btrim(a->>'answer')<>'') then raise exception 'INVALID_ROOM_ANSWERS'; end if;
 end loop;
 if policy_private.is_room_member(p_room_id,auth.uid()) then destination:='member';
 else
   if p_action_kind='accept_invitation' then
     select status into invitation_status from public.social_room_invitations where room_id=p_room_id and invited_user_id=auth.uid() for update;
   end if;
   select status into request_status from public.social_circle_join_requests where circle_id=p_room_id and requester_id=auth.uid();
   if p_action_kind='accept_invitation' then
     if invitation_status is null or invitation_status not in('pending','accepted') then raise exception 'ROOM_JOIN_INVITATION_REQUIRED' using errcode='42501'; end if;
     destination:='invitation';
   elsif p_action_kind='join' and r.join_policy='open' then destination:='open';
   elsif p_action_kind='request' and r.join_policy='approval' then destination:='request';
   else raise exception 'MEMBERSHIP_STATE_CHANGED' using errcode='PT409'; end if;
   if destination='request' and request_status='pending' then raise exception 'MEMBERSHIP_STATE_CHANGED' using errcode='PT409'; end if;
   insert into private.room_membership_answers(room_id,requester_id,config_version,questions,answers,source,admission_transaction,submitted_at)
     values(p_room_id,auth.uid(),cfg.version,cfg.questions,answer_values,destination,txid_current(),clock_timestamp())
     on conflict(room_id,requester_id) do update set config_version=excluded.config_version,questions=excluded.questions,
       answers=excluded.answers,source=excluded.source,admission_transaction=excluded.admission_transaction,submitted_at=excluded.submitted_at;
   if destination='invitation' then
     if invitation_status='pending' then
       update public.social_room_invitations set status='accepted' where room_id=p_room_id and invited_user_id=auth.uid() and status='pending';
     end if;
     insert into public.social_circle_members(circle_id,member_id,member_role) values(p_room_id,auth.uid(),'member') on conflict do nothing;
     destination:='member';
   elsif destination='open' then
     insert into public.social_circle_members(circle_id,member_id,member_role) values(p_room_id,auth.uid(),'member');
     destination:='member';
   else
     delete from public.social_circle_join_requests where circle_id=p_room_id and requester_id=auth.uid() and status<>'pending';
     insert into public.social_circle_join_requests(circle_id,requester_id,status) values(p_room_id,auth.uid(),'pending');
     destination:='pending';
   end if;
 end if;
 result:=jsonb_build_object('room_id',p_room_id,'requester_id',auth.uid(),'status',destination,'config_version',cfg.version,'request_id',p_request_id);
 insert into private.room_management_receipts values(auth.uid(),p_request_id,p_room_id,'membership',payload,result,now());
 return result;
end;
$$;

create or replace function public.room_set_post_pin(p_room_id uuid,p_post_id uuid,p_pinned boolean,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target public.social_posts%rowtype; payload jsonb; result jsonb; pinned_time timestamptz; is_pinned boolean;
begin
 perform private.room_management_room(p_room_id);
 perform pg_advisory_xact_lock(hashtextextended('room-management:'||p_room_id::text,0));
 perform private.room_management_role(p_room_id);
 if p_post_id is null or p_pinned is null then raise exception 'INVALID_ROOM_PIN'; end if;
 payload:=jsonb_build_object('post_id',p_post_id,'pinned',p_pinned);
 result:=private.room_management_receipt(p_room_id,p_request_id,'pin',payload);
 if result is not null then
   is_pinned:=exists(select from public.social_room_pinned_posts where room_id=p_room_id and post_id=p_post_id);
   if is_pinned is distinct from p_pinned then raise exception 'ROOM_PIN_CHANGED' using errcode='PT409'; end if;
   return result;
 end if;
 if p_pinned then
   select * into target from public.social_posts where id=p_post_id and circle_id=p_room_id for share;
   if not found or target.visibility<>'circle' or target.parent_post_id is not null or
     target.post_status<>'published' or target.deleted_at is not null or target.moderation_state<>'visible' then
     raise exception 'ROOM_POST_UNAVAILABLE' using errcode='P0002';
   end if;
   select pinned_at into pinned_time from public.social_room_pinned_posts where room_id=p_room_id and post_id=p_post_id;
   if not found then
     if (select count(*) from public.social_room_pinned_posts where room_id=p_room_id)>=3 then raise exception 'ROOM_PIN_LIMIT' using errcode='23514'; end if;
     insert into public.social_room_pinned_posts(room_id,post_id,pinned_by) values(p_room_id,p_post_id,auth.uid()) returning pinned_at into pinned_time;
   end if;
 else
   delete from public.social_room_pinned_posts where room_id=p_room_id and post_id=p_post_id;
   pinned_time:=null;
 end if;
 result:=jsonb_build_object('room_id',p_room_id,'post_id',p_post_id,'pinned',p_pinned,'pinned_at',pinned_time);
 insert into private.room_management_receipts values(auth.uid(),p_request_id,p_room_id,'pin',payload,result,now());
 insert into private.room_management_audit(room_id,actor_id,post_id,action,request_id)
   values(p_room_id,auth.uid(),p_post_id,case when p_pinned then 'pin' else 'unpin' end,p_request_id);
 return result;
end;
$$;

commit;
