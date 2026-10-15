-- REVIEW ONLY: additive Rooms management. Hosted apply/deploy needs owner approval.
-- The previously reviewed post-approval migration and existing RLS are unchanged.
begin;

create table private.room_management_config (
  room_id uuid primary key references public.social_circles(id) on delete cascade,
  version integer not null default 1 check(version>0),
  rules jsonb not null default '[]'::jsonb check(jsonb_typeof(rules)='array' and jsonb_array_length(rules)<=10),
  questions jsonb not null default '[]'::jsonb check(jsonb_typeof(questions)='array' and jsonb_array_length(questions)<=3),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.social_profiles(id) on delete set null
);
create table private.room_membership_answers (
  room_id uuid not null references public.social_circles(id) on delete cascade,
  requester_id uuid not null references public.social_profiles(id) on delete cascade,
  config_version integer not null check(config_version>0),
  questions jsonb not null check(jsonb_typeof(questions)='array' and jsonb_array_length(questions)<=3),
  answers jsonb not null check(jsonb_typeof(answers)='array' and jsonb_array_length(answers)<=3),
  source text not null check(source in('open','invitation','request','legacy')),
  -- Server-only proof for the admission in THIS transaction. A caller-set GUC
  -- cannot forge this private row; it is never returned by a public RPC.
  admission_transaction bigint,
  submitted_at timestamptz not null default now(),
  primary key(room_id,requester_id)
);
create table private.room_management_receipts (
  actor_id uuid not null references public.social_profiles(id) on delete cascade,
  request_id uuid not null,
  room_id uuid not null references public.social_circles(id) on delete cascade,
  operation text not null check(operation in('config','membership','pin','remove')),
  payload jsonb not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key(actor_id,request_id)
);
create table private.room_management_post_removals (
  post_id uuid primary key references public.social_posts(id) on delete cascade,
  room_id uuid not null references public.social_circles(id) on delete cascade,
  removed_at timestamptz not null default now()
);
create table private.room_management_audit (
  id bigint generated always as identity primary key,
  room_id uuid references public.social_circles(id) on delete set null,
  actor_id uuid references public.social_profiles(id) on delete set null,
  post_id uuid,
  action text not null check(action in('config','pin','unpin','remove')),
  reason text check(reason is null or char_length(reason)<=500),
  request_id uuid not null,
  created_at timestamptz not null default now()
);
create index room_management_answers_requester_idx on private.room_membership_answers(requester_id);
create index room_management_receipts_room_idx on private.room_management_receipts(room_id);
create index room_management_removals_room_idx on private.room_management_post_removals(room_id);
create index room_management_audit_room_idx on private.room_management_audit(room_id,id desc);
create index room_management_audit_actor_idx on private.room_management_audit(actor_id) where actor_id is not null;
create index room_management_config_actor_idx on private.room_management_config(updated_by) where updated_by is not null;
alter table private.room_management_config enable row level security;
alter table private.room_management_config force row level security;
alter table private.room_membership_answers enable row level security;
alter table private.room_membership_answers force row level security;
alter table private.room_management_receipts enable row level security;
alter table private.room_management_receipts force row level security;
alter table private.room_management_post_removals enable row level security;
alter table private.room_management_post_removals force row level security;
alter table private.room_management_audit enable row level security;
alter table private.room_management_audit force row level security;
revoke all on private.room_management_config,private.room_membership_answers,
  private.room_management_receipts,private.room_management_post_removals,private.room_management_audit
  from public,anon,authenticated;
revoke all on sequence private.room_management_audit_id_seq from public,anon,authenticated;

-- Read this table with the caller's existing post RLS, including blocks/mutes and
-- moderation. Public Room metadata never makes a Room discussion publicly readable.
create table public.social_room_pinned_posts (
  room_id uuid not null references public.social_circles(id) on delete cascade,
  post_id uuid primary key references public.social_posts(id) on delete cascade,
  pinned_at timestamptz not null default now(),
  pinned_by uuid references public.social_profiles(id) on delete set null
);
create index social_room_pinned_posts_room_idx on public.social_room_pinned_posts(room_id,pinned_at desc,post_id);
create index social_room_pinned_posts_actor_idx on public.social_room_pinned_posts(pinned_by) where pinned_by is not null;
alter table public.social_room_pinned_posts enable row level security;
alter table public.social_room_pinned_posts force row level security;
revoke all on public.social_room_pinned_posts from public,anon,authenticated;
grant select on public.social_room_pinned_posts to authenticated;
create policy social_room_pinned_posts_select on public.social_room_pinned_posts for select to authenticated using (
  policy_private.is_room_member(room_id,auth.uid()) and
  exists(select from public.social_circles room where room.id=room_id) and
  exists(select from public.social_posts post where post.id=post_id and post.circle_id=room_id and
    post.visibility='circle' and post.parent_post_id is null and post.post_status='published' and post.deleted_at is null)
);

create function private.initialize_room_management_config()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into private.room_management_config(room_id) values(new.id) on conflict do nothing;
  return new;
end;
$$;
revoke all on function private.initialize_room_management_config() from public,anon,authenticated;
create trigger initialize_room_management_config after insert on public.social_circles
for each row execute function private.initialize_room_management_config();
insert into private.room_management_config(room_id) select id from public.social_circles;

create function private.room_management_room(p_room_id uuid)
returns public.social_circles language plpgsql security definer set search_path='' as $$
declare r public.social_circles%rowtype;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  select * into r from public.social_circles where id=p_room_id for key share;
  if not found or not exists(select from public.social_profiles where id=auth.uid()) or exists(
    select from public.social_blocks where (blocker_id=r.owner_id and blocked_id=auth.uid()) or
      (blocked_id=r.owner_id and blocker_id=auth.uid())) then
    raise exception 'ROOM_UNAVAILABLE' using errcode='P0002';
  end if;
  return r;
end;
$$;
revoke all on function private.room_management_room(uuid) from public,anon,authenticated;

create function private.room_management_role(p_room_id uuid,p_admin boolean default false)
returns text language plpgsql security definer set search_path='' as $$
declare role_name text;
begin
  perform 1 from public.social_circle_members where circle_id=p_room_id and member_id=auth.uid() for share;
  role_name:=policy_private.room_member_role(p_room_id,auth.uid());
  if role_name is null or role_name not in('owner','admin','moderator') or (p_admin and role_name='moderator') then
    if p_admin then raise exception 'ROOM_ADMIN_REQUIRED' using errcode='42501'; end if;
    raise exception 'ROOM_STAFF_REQUIRED' using errcode='42501';
  end if;
  return role_name;
end;
$$;
revoke all on function private.room_management_role(uuid,boolean) from public,anon,authenticated;

create function private.room_management_receipt(p_room_id uuid,p_request_id uuid,p_operation text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare receipt private.room_management_receipts%rowtype;
begin
  if p_request_id is null then raise exception 'INVALID_ROOM_MANAGEMENT'; end if;
  -- Serialize a caller's request even if another Room/function uses the same ID.
  perform pg_advisory_xact_lock(hashtextextended('room-management-request:'||auth.uid()::text||':'||p_request_id::text,0));
  select * into receipt from private.room_management_receipts where actor_id=auth.uid() and request_id=p_request_id;
  if not found then return null; end if;
  if receipt.room_id<>p_room_id or receipt.operation<>p_operation or receipt.payload<>p_payload then
    raise exception 'REQUEST_PAYLOAD_CONFLICT' using errcode='23505';
  end if;
  return receipt.response;
end;
$$;
revoke all on function private.room_management_receipt(uuid,uuid,text,jsonb) from public,anon,authenticated;

create function private.room_management_json(p_config private.room_management_config)
returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('room_id',p_config.room_id,'version',p_config.version,
   'rules',p_config.rules,'questions',p_config.questions,'pin_limit',3);
$$;
revoke all on function private.room_management_json(private.room_management_config) from public,anon,authenticated;

create function public.room_management_capabilities()
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 return jsonb_build_object('room_management',true,'management_version',1);
end;
$$;
create function public.room_management_state(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg private.room_management_config%rowtype;
begin
 perform private.room_management_room(p_room_id);
 select * into cfg from private.room_management_config where room_id=p_room_id;
 if not found then raise exception 'ROOM_UNAVAILABLE' using errcode='P0002'; end if;
 return private.room_management_json(cfg);
end;
$$;
create function public.room_update_management(p_room_id uuid,p_expected_version integer,p_request_id uuid,p_rules jsonb,p_questions jsonb)
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
 if cfg.version<>p_expected_version then raise exception 'ROOM_MANAGEMENT_VERSION_CONFLICT' using errcode='40001'; end if;
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

-- Config rows exist for every Room. SHARE orders enabling/changing questions
-- against legacy admissions without taking the member-count Room UPDATE lock.
create function private.enforce_room_membership_questions()
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
     raise exception 'MEMBERSHIP_STATE_CHANGED' using errcode='40001';
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
revoke all on function private.enforce_room_membership_questions() from public,anon,authenticated;
create trigger enforce_room_membership_questions before insert on public.social_circle_members
for each row execute function private.enforce_room_membership_questions();
create trigger enforce_room_request_questions before insert on public.social_circle_join_requests
for each row execute function private.enforce_room_membership_questions();

create function public.room_submit_membership_request(p_room_id uuid,p_expected_version integer,p_request_id uuid,p_answers jsonb,p_action_kind text)
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
   raise exception 'MEMBERSHIP_STATE_CHANGED' using errcode='40001';
 end if;
 select * into cfg from private.room_management_config where room_id=p_room_id for share;
 if not found then raise exception 'ROOM_UNAVAILABLE' using errcode='P0002'; end if;
 if cfg.version<>p_expected_version then raise exception 'ROOM_MANAGEMENT_VERSION_CONFLICT' using errcode='40001'; end if;
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
   else raise exception 'MEMBERSHIP_STATE_CHANGED' using errcode='40001'; end if;
   if destination='request' and request_status='pending' then raise exception 'MEMBERSHIP_STATE_CHANGED' using errcode='40001'; end if;
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

create function public.room_membership_request_answers(p_room_id uuid,p_requester_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare answer_row private.room_membership_answers%rowtype;
begin
 perform private.room_management_room(p_room_id);
 if p_requester_id is null or (p_requester_id<>auth.uid() and not policy_private.is_room_staff(p_room_id,auth.uid())) then
   raise exception 'MEMBERSHIP_ANSWERS_UNAVAILABLE' using errcode='P0002';
 end if;
 select * into answer_row from private.room_membership_answers where room_id=p_room_id and requester_id=p_requester_id;
 if not found then raise exception 'MEMBERSHIP_ANSWERS_UNAVAILABLE' using errcode='P0002'; end if;
 return jsonb_build_object('room_id',p_room_id,'requester_id',p_requester_id,'config_version',answer_row.config_version,
   'questions',answer_row.questions,'answers',answer_row.answers,'submitted_at',answer_row.submitted_at);
end;
$$;

create function public.room_pinned_posts(p_room_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 if not policy_private.is_room_member(p_room_id,auth.uid()) or not exists(select from public.social_circles where id=p_room_id) then
   raise exception 'ROOM_UNAVAILABLE' using errcode='P0002';
 end if;
 return jsonb_build_object('posts',(select coalesce(jsonb_agg(jsonb_build_object(
   'post_id',post_id,'pinned_at',pinned_at,'pinned_by',pinned_by) order by pinned_at desc,post_id),'[]')
   from public.social_room_pinned_posts where room_id=p_room_id),'pin_limit',3);
end;
$$;

create function public.room_set_post_pin(p_room_id uuid,p_post_id uuid,p_pinned boolean,p_request_id uuid)
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
   if is_pinned is distinct from p_pinned then raise exception 'ROOM_PIN_CHANGED' using errcode='40001'; end if;
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

create function private.enforce_room_removed_post()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select from private.room_management_post_removals where post_id=old.id) and
   (new.deleted_at is null or new.id<>old.id or new.author_id<>old.author_id or
    new.circle_id is distinct from old.circle_id or new.visibility<>old.visibility) then
   raise exception 'ROOM_POST_REMOVED' using errcode='42501';
 end if;
 return new;
end;
$$;
revoke all on function private.enforce_room_removed_post() from public,anon,authenticated;
create trigger enforce_room_removed_post before update on public.social_posts
for each row execute function private.enforce_room_removed_post();

create function private.cleanup_unavailable_room_pin()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.deleted_at is not null or new.post_status<>'published' or new.moderation_state<>'visible' or
   new.circle_id is distinct from old.circle_id or new.visibility<>'circle' or new.parent_post_id is not null then
   delete from public.social_room_pinned_posts where post_id=new.id;
 end if;
 return new;
end;
$$;
revoke all on function private.cleanup_unavailable_room_pin() from public,anon,authenticated;
create trigger cleanup_unavailable_room_pin after update of deleted_at,post_status,moderation_state,circle_id,visibility,parent_post_id on public.social_posts
for each row execute function private.cleanup_unavailable_room_pin();

create function public.room_moderate_published_post(p_room_id uuid,p_post_id uuid,p_request_id uuid,p_action text,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.social_circles%rowtype; target public.social_posts%rowtype; actor_role text; target_role text;
  payload jsonb; result jsonb; removed_time timestamptz;
begin
 r:=private.room_management_room(p_room_id);
 perform pg_advisory_xact_lock(hashtextextended('room-management:'||p_room_id::text,0));
 actor_role:=private.room_management_role(p_room_id);
 p_reason:=btrim(coalesce(p_reason,''));
 if p_post_id is null or p_action is distinct from 'remove' or char_length(p_reason) not between 1 and 500 then raise exception 'INVALID_ROOM_MODERATION'; end if;
 payload:=jsonb_build_object('post_id',p_post_id,'action',p_action,'reason',p_reason);
 result:=private.room_management_receipt(p_room_id,p_request_id,'remove',payload);
 if result is not null then return result; end if;
 select * into target from public.social_posts where id=p_post_id and circle_id=p_room_id for update;
 if not found or target.visibility<>'circle' or target.parent_post_id is not null or
   target.post_status<>'published' or target.deleted_at is not null then raise exception 'ROOM_POST_UNAVAILABLE' using errcode='P0002'; end if;
 perform 1 from public.social_circle_members where circle_id=p_room_id and member_id=target.author_id for share;
 target_role:=policy_private.room_member_role(p_room_id,target.author_id);
 -- Match the existing removal hierarchy, including former members. A missing
 -- membership never lets another staff member remove the immutable owner's post.
 if target_role is not null and target_role not in('owner','admin','moderator','member') then raise exception 'ROOM_MODERATION_FORBIDDEN' using errcode='42501'; end if;
 if target.author_id<>auth.uid() and not (
   actor_role='owner' or
   (target.author_id<>r.owner_id and actor_role='admin' and coalesce(target_role,'member') in('member','moderator')) or
   (target.author_id<>r.owner_id and actor_role='moderator' and coalesce(target_role,'member')='member')
 ) then raise exception 'ROOM_MODERATION_FORBIDDEN' using errcode='42501'; end if;
 removed_time:=clock_timestamp();
 insert into private.room_management_post_removals(post_id,room_id,removed_at) values(p_post_id,p_room_id,removed_time);
 update public.social_posts set deleted_at=removed_time where id=p_post_id;
 delete from public.social_room_pinned_posts where post_id=p_post_id;
 insert into private.room_management_audit(room_id,actor_id,post_id,action,reason,request_id)
   values(p_room_id,auth.uid(),p_post_id,'remove',p_reason,p_request_id);
 result:=jsonb_build_object('room_id',p_room_id,'post_id',p_post_id,'action','remove','removed',true,'removed_at',removed_time);
 insert into private.room_management_receipts values(auth.uid(),p_request_id,p_room_id,'remove',payload,result,now());
 return result;
end;
$$;

-- Concrete compatibility correction: the old phase20 owner-only implementation
-- contradicted the later Rooms owner/admin/moderator request RLS. Keep the exact
-- atomic membership effect while checking CURRENT staff and owner blocks.
create or replace function private.apply_phase20_circle_join_approval()
returns trigger language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); room_owner uuid; actor_role text;
begin
 if old.status='pending' and new.status='approved' then
   if actor is null then raise exception 'ROOM_STAFF_REQUIRED' using errcode='42501'; end if;
   select owner_id into room_owner from public.social_circles where id=new.circle_id for key share;
   if not found then raise exception 'ROOM_UNAVAILABLE' using errcode='P0002'; end if;
   perform 1 from public.social_circle_members where circle_id=new.circle_id and member_id in(actor,new.requester_id)
     order by member_id for share;
   actor_role:=policy_private.room_member_role(new.circle_id,actor);
   if actor_role is null or actor_role not in('owner','admin','moderator') then raise exception 'ROOM_STAFF_REQUIRED' using errcode='42501'; end if;
   if exists(select from public.social_blocks where
       (blocker_id=room_owner and blocked_id in(actor,new.requester_id)) or
       (blocked_id=room_owner and blocker_id in(actor,new.requester_id))) then raise exception 'ROOM_UNAVAILABLE' using errcode='42501'; end if;
   insert into public.social_circle_members(circle_id,member_id,member_role)
     values(new.circle_id,new.requester_id,'member') on conflict(circle_id,member_id) do nothing;
 end if;
 return new;
end;
$$;
revoke all on function private.apply_phase20_circle_join_approval() from public,anon,authenticated;

-- The old invoker AFTER UPDATE trigger's nested membership INSERT fails its
-- canonical RLS acceptance check. The outer UPDATE remains recipient-controlled;
-- this trigger-only function repeats identity/auth checks before that one effect.
create or replace function private.apply_room_invitation_acceptance()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.status='pending' and new.status='accepted' then
   if auth.uid() is null or auth.uid()<>new.invited_user_id or new.room_id<>old.room_id or
     new.invited_user_id<>old.invited_user_id or new.invited_by<>old.invited_by then
     raise exception 'ROOM_INVITATION_IDENTITY_IMMUTABLE' using errcode='42501';
   end if;
   perform private.room_management_room(new.room_id);
   insert into public.social_circle_members(circle_id,member_id,member_role)
     values(new.room_id,new.invited_user_id,'member') on conflict(circle_id,member_id) do nothing;
 end if;
 return new;
end;
$$;
revoke all on function private.apply_room_invitation_acceptance() from public,anon,authenticated;

revoke all on function public.room_management_capabilities(),public.room_management_state(uuid),
 public.room_update_management(uuid,integer,uuid,jsonb,jsonb),public.room_submit_membership_request(uuid,integer,uuid,jsonb,text),
 public.room_membership_request_answers(uuid,uuid),public.room_pinned_posts(uuid),public.room_set_post_pin(uuid,uuid,boolean,uuid),
 public.room_moderate_published_post(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.room_management_capabilities(),public.room_management_state(uuid),
 public.room_update_management(uuid,integer,uuid,jsonb,jsonb),public.room_submit_membership_request(uuid,integer,uuid,jsonb,text),
 public.room_membership_request_answers(uuid,uuid),public.room_pinned_posts(uuid),public.room_set_post_pin(uuid,uuid,boolean,uuid),
 public.room_moderate_published_post(uuid,uuid,uuid,text,text) to authenticated;

commit;
