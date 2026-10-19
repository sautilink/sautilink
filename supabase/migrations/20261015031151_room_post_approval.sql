-- REVIEW ONLY: owner approval required before backend deployment. Default OFF.
begin;

-- Existing Rooms and existing posts retain their behavior.
alter table public.social_circles
  add column post_approval_required boolean not null default false;
grant update (post_approval_required) on public.social_circles to authenticated;
-- Existing social_circles_update_rooms still restricts settings to owner/admin.

create table private.room_post_submissions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.social_circles(id) on delete cascade,
  author_id uuid not null references public.social_profiles(id) on delete cascade,
  client_request_id uuid not null,
  body text not null,
  reply_access text not null default 'everyone'
    check (reply_access in ('everyone', 'following', 'mentioned')),
  -- Snapshot target ID; validate the existing public-quote contract at submission
  -- and again before publishing. A removed target must not silently change content.
  quote_post_id uuid,
  media_count smallint not null default 0 check (media_count between 0 and 5),
  media_snapshot jsonb not null default '[]'::jsonb check(jsonb_typeof(media_snapshot)='array'),
  state text not null default 'pending'
    check (state in ('pending', 'approved', 'rejected', 'withdrawn')),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.social_profiles(id) on delete set null,
  decision_request_id uuid,
  decision_reason text check (decision_reason is null or char_length(decision_reason) <= 500),
  published_post_id uuid unique references public.social_posts(id)
    on delete set null deferrable initially deferred,
  unique (author_id, client_request_id),
  check(jsonb_array_length(media_snapshot)=media_count),
  check (char_length(btrim(body)) <= 2000 and
    (char_length(btrim(body)) > 0 or media_count > 0 or quote_post_id is not null)),
  check ((state = 'pending' and decided_at is null and decided_by is null and
          decision_request_id is null and published_post_id is null) or
         (state <> 'pending' and decided_at is not null and decision_request_id is not null)),
  check (state = 'approved' or published_post_id is null),
  check (state <> 'rejected' or nullif(btrim(decision_reason), '') is not null)
);

create index room_post_submissions_queue_idx
  on private.room_post_submissions (room_id, state, created_at, id);
create index room_post_submissions_author_idx
  on private.room_post_submissions (author_id, created_at desc, id desc);

-- Pending uploads remain ready/unattached in the existing media table. Holding a
-- media ID does not make it visible through existing social_posts/media RLS.
create table private.room_post_submission_media (
  submission_id uuid not null references private.room_post_submissions(id) on delete cascade,
  media_id uuid not null unique references public.social_post_media(id) on delete restrict,
  position smallint not null check (position between 0 and 4),
  alt_text text not null default '' check (char_length(alt_text) <= 1000),
  primary key (submission_id, media_id),
  unique (submission_id, position)
);

create table private.room_post_decision_audit (
  id bigint generated always as identity primary key,
  room_id uuid references public.social_circles(id) on delete set null,
  submission_id uuid references private.room_post_submissions(id) on delete set null,
  actor_id uuid references public.social_profiles(id) on delete set null,
  actor_role text,
  action text not null check (action in
    ('submitted', 'approved', 'rejected', 'withdrawn', 'approval_setting_changed')),
  old_state text,
  new_state text,
  request_id uuid not null,
  reason text check (reason is null or char_length(reason) <= 500),
  created_at timestamptz not null default now()
  -- No post body, email, phone, token, media key or binary content is copied here.
);

alter table private.room_post_submissions enable row level security;
alter table private.room_post_submissions force row level security;
alter table private.room_post_submission_media enable row level security;
alter table private.room_post_submission_media force row level security;
alter table private.room_post_decision_audit enable row level security;
alter table private.room_post_decision_audit force row level security;
revoke all on private.room_post_submissions, private.room_post_submission_media,
  private.room_post_decision_audit from public, anon, authenticated;

-- Companion requirement: only explicitly authorized RPCs can read/write the
-- private queue. They must not grant table access or private-schema USAGE.

-- A normal member cannot bypass approval through an old /api/sauti client or a
-- direct PostgREST INSERT. Staff-authored posts retain existing immediate posting.
create function private.guard_room_approval_publication()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  needs_approval boolean;
  author_role text;
begin
  if new.circle_id is null or new.visibility <> 'circle' or new.parent_post_id is not null then
    return new;
  end if;
  select room.post_approval_required into needs_approval
    from public.social_circles room where room.id = new.circle_id;
  if needs_approval is distinct from true then return new; end if;
  author_role := policy_private.room_member_role(new.circle_id, new.author_id);
  if author_role is null then
    raise exception using errcode = '42501', message = 'ROOM_MEMBERSHIP_REQUIRED';
  end if;
  if author_role in ('owner', 'admin', 'moderator') then return new; end if;
  if not exists (
    select 1 from private.room_post_submissions submission
     where submission.room_id = new.circle_id and submission.author_id = new.author_id
       and submission.state = 'approved' and submission.published_post_id = new.id
       and submission.decided_by = auth.uid()
       and submission.body = new.body and submission.reply_access = new.reply_access
       and submission.quote_post_id is not distinct from new.quote_post_id
       and submission.media_count = new.media_count
       and policy_private.is_room_staff(submission.room_id, auth.uid())
  ) then
    raise exception using errcode = '42501', message = 'ROOM_POST_APPROVAL_REQUIRED';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_room_approval_publication() from public, anon, authenticated;
create trigger guard_room_approval_publication
before insert on public.social_posts
for each row execute function private.guard_room_approval_publication();

-- A held upload is immutable until the atomic approval transaction attaches it
-- to the exact published post. Prevent owner/direct-REST reuse or byte overwrite.
create function private.guard_room_submission_media_hold()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  held private.room_post_submissions%rowtype;
begin
  select submission.* into held
    from private.room_post_submission_media link
    join private.room_post_submissions submission on submission.id = link.submission_id
   where link.media_id = old.id;
  if not found then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if held.state = 'approved' and held.decided_by = auth.uid() and
        new.post_id = held.published_post_id and new.owner_id = held.author_id and
        new.upload_status = 'attached' and new.attached_at is not null and
        policy_private.is_room_staff(held.room_id, auth.uid()) and
        exists (select 1 from private.room_post_submission_media link
                 where link.submission_id = held.id and link.media_id = old.id
                   and link.position = new.position and link.alt_text = new.alt_text) and
        -- Only attachment fields may change while consuming a hold. The RPC
        -- supplies position/alt_text from the locked submission-media snapshot.
        (to_jsonb(new) - array['post_id', 'position', 'alt_text', 'upload_status', 'attached_at', 'expires_at']) =
        (to_jsonb(old) - array['post_id', 'position', 'alt_text', 'upload_status', 'attached_at', 'expires_at']) then
      return new;
    end if;
  end if;
  raise exception using errcode = '42501', message = 'MEDIA_HELD_FOR_ROOM_REVIEW';
end;
$$;
revoke all on function private.guard_room_submission_media_hold() from public, anon, authenticated;
create trigger guard_room_submission_media_hold
before update or delete on public.social_post_media
for each row execute function private.guard_room_submission_media_hold();

-- Preserve the existing account/profile deletion cascade. PostgreSQL need not
-- cascade the queue before its author's media, so explicitly release owned holds
-- first. Metadata-only audit survives with its existing nullable references.
create function private.release_room_submissions_before_profile_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from private.room_post_submissions where author_id = old.id;
  return old;
end;
$$;
revoke all on function private.release_room_submissions_before_profile_delete()
  from public, anon, authenticated;
create trigger release_room_submissions_before_profile_delete
before delete on public.social_profiles
for each row execute function private.release_room_submissions_before_profile_delete();

-- Notification companion draft. Existing recipient RLS still controls reads.
alter table public.social_notifications
  add column room_submission_id uuid references private.room_post_submissions(id) on delete set null;
alter table public.social_notifications drop constraint social_notifications_circle_event_allowed;
alter table public.social_notifications add constraint social_notifications_circle_event_allowed check (
  circle_event is null or circle_event in
    ('join_request', 'request_approved', 'request_declined', 'member_removed',
     'post_approval_requested', 'post_approved', 'post_rejected')
);

create unique index social_notifications_room_submission_event_uidx
  on public.social_notifications(recipient_id, room_submission_id, circle_event)
  where room_submission_id is not null;
create index social_notifications_room_submission_idx on public.social_notifications(room_submission_id)
  where room_submission_id is not null;
create index room_post_audit_room_id_idx on private.room_post_decision_audit(room_id,id desc);
create index room_post_audit_submission_idx on private.room_post_decision_audit(submission_id) where submission_id is not null;
create index room_post_audit_actor_idx on private.room_post_decision_audit(actor_id) where actor_id is not null;
create index room_post_submissions_decider_idx on private.room_post_submissions(decided_by) where decided_by is not null;

create function private.room_submission_json(p_row private.room_post_submissions)
returns jsonb language sql immutable set search_path = '' as $$
  select to_jsonb(p_row) - array['client_request_id','decision_request_id','media_snapshot'];
$$;
revoke all on function private.room_submission_json(private.room_post_submissions) from public,anon,authenticated;

-- These routines deliberately publish on the original author's behalf. They are
-- auth.uid-bound, use current membership (never user_metadata), and expose no
-- private table/schema grants. Public wrappers below are the only client API.
create function private.room_approval_room(p_room_id uuid)
returns public.social_circles language plpgsql security definer set search_path = '' as $$
declare r public.social_circles%rowtype;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  -- Keep Room deletion/key changes serialized without blocking the existing
  -- AFTER-membership member-count UPDATE while waiting for membership locks.
  select * into r from public.social_circles where id=p_room_id for key share;
  if not found then raise exception 'ROOM_UNAVAILABLE' using errcode='P0002'; end if;
  return r;
end;
$$;
revoke all on function private.room_approval_room(uuid) from public,anon,authenticated;

-- Approval runs as the definer, so ordinary post RLS does not filter quoted
-- targets inside its insert trigger. Preserve the existing phase29 public-post
-- SELECT predicates for the ORIGINAL author, including own-post/staff exceptions.
-- This helper adds no client privilege and does not change existing RLS policies.
create function private.room_quote_visible_to(p_post_id uuid,p_author_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare target public.social_posts%rowtype; viewer_staff boolean; reported boolean;
begin
  if p_post_id is null or p_author_id is null then return false; end if;
  select * into target from public.social_posts where id=p_post_id;
  if not found or target.visibility<>'public' or target.circle_id is not null or
      target.post_status<>'published' or target.deleted_at is not null then return false; end if;
  select exists(select from private.moderation_staff staff where staff.user_id=p_author_id and staff.active=true and
    staff.staff_role in('reviewer','senior_reviewer','auditor')) into viewer_staff;
  select exists(select from public.social_reports report where report.target_type='post' and
    report.target_id=target.id::text) into reported;
  return
    (target.moderation_state='visible' or target.author_id=p_author_id or (viewer_staff and reported)) and
    (target.audience_owner_id=p_author_id or exists(select from public.social_profiles profile where
      profile.id=target.audience_owner_id and profile.is_discoverable=true)) and
    (target.author_id=p_author_id or viewer_staff or exists(select from public.social_profiles profile where
      profile.id=target.author_id and profile.is_discoverable=true)) and
    ((viewer_staff and reported) or not exists(select from public.social_blocks block where
      (block.blocker_id=p_author_id and block.blocked_id=any(array[target.author_id,target.audience_owner_id])) or
      (block.blocked_id=p_author_id and block.blocker_id=any(array[target.author_id,target.audience_owner_id])))) and
    ((viewer_staff and reported) or not exists(select from public.social_mutes mute where
      mute.muter_id=p_author_id and mute.muted_id=any(array[target.author_id,target.audience_owner_id])));
end;
$$;
revoke all on function private.room_quote_visible_to(uuid,uuid) from public,anon,authenticated;

create function private.room_approval_notice(p_submission private.room_post_submissions, p_event text, p_recipient uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if p_recipient is null or p_recipient=auth.uid() then return; end if;
  insert into public.social_notifications(recipient_id,actor_id,circle_id,circle_event,notification_type,room_submission_id)
  values(p_recipient,auth.uid(),p_submission.room_id,p_event,'circle',p_submission.id)
  on conflict (recipient_id,room_submission_id,circle_event) where room_submission_id is not null do nothing;
end;
$$;
revoke all on function private.room_approval_notice(private.room_post_submissions,text,uuid) from public,anon,authenticated;

create function public.room_post_approval_capabilities()
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  return jsonb_build_object('post_approval',true,'version',1);
end;
$$;

create function public.room_submit_post_for_review(p_room_id uuid,p_client_request_id uuid,p_body text,
  p_reply_access text default 'everyone',p_quote_post_id uuid default null,p_media jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  r public.social_circles%rowtype;
  s private.room_post_submissions%rowtype;
  role_name text;
  item jsonb;
  media_row public.social_post_media%rowtype;
  media_id uuid;
  n integer;
  normalized_media jsonb;
  staff uuid;
begin
  r:=private.room_approval_room(p_room_id);
  perform 1 from public.social_circle_members where circle_id=p_room_id and member_id=auth.uid() for share;
  role_name:=policy_private.room_member_role(p_room_id,auth.uid());
  if role_name is null then raise exception 'ROOM_MEMBERSHIP_REQUIRED' using errcode='42501'; end if;
  if exists(select from public.social_blocks where (blocker_id=r.owner_id and blocked_id=auth.uid()) or
      (blocked_id=r.owner_id and blocker_id=auth.uid())) then
    raise exception 'ROOM_UNAVAILABLE' using errcode='42501';
  end if;
  if p_client_request_id is null then raise exception 'REQUEST_ID_REQUIRED'; end if;
  if jsonb_typeof(p_media) is distinct from 'array' or jsonb_array_length(p_media)>5 then raise exception 'INVALID_MEDIA'; end if;
  n:=jsonb_array_length(p_media);
  p_body:=btrim(coalesce(p_body,''));
  if char_length(p_body)>2000 or (p_body='' and n=0 and p_quote_post_id is null) then raise exception 'INVALID_BODY'; end if;
  if p_reply_access is null or p_reply_access not in('everyone','following','mentioned') then raise exception 'INVALID_REPLY_ACCESS'; end if;
  if p_reply_access='mentioned' and p_body !~* '(^|[^a-z0-9._])@[a-z0-9][a-z0-9._]{2,29}($|[^a-z0-9._])' then raise exception 'MENTION_REQUIRED'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',(value->>'id')::uuid,'alt_text',btrim(coalesce(value->>'alt_text',''))) order by ordinal),'[]'::jsonb)
    into normalized_media from jsonb_array_elements(p_media) with ordinality x(value,ordinal);
  -- Serialize a particular actor/request ID before lookup, including retries
  -- arriving before the first submission commits. No key may change its payload.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':'||p_client_request_id::text,0));
  select * into s from private.room_post_submissions where author_id=auth.uid() and client_request_id=p_client_request_id;
  if found then
    -- The immutable snapshot survives release of media holds after a decision.
    if s.room_id<>p_room_id or s.body<>p_body or s.reply_access<>p_reply_access or
      s.quote_post_id is distinct from p_quote_post_id or s.media_snapshot<>normalized_media then
      raise exception 'REQUEST_PAYLOAD_CONFLICT' using errcode='23505';
    end if;
    return jsonb_build_object('submission',private.room_submission_json(s),'published',false);
  end if;
  if not r.post_approval_required or role_name in('owner','admin','moderator') then raise exception 'ROOM_APPROVAL_NOT_REQUIRED'; end if;
  if r.post_permission='staff_only' then raise exception 'ROOM_POST_STAFF_ONLY' using errcode='42501'; end if;
  if p_quote_post_id is not null and not private.room_quote_visible_to(p_quote_post_id,auth.uid()) then
    raise exception 'QUOTE_UNAVAILABLE';
  end if;
  if (select count(distinct value->>'id') from jsonb_array_elements(normalized_media))<>n then raise exception 'INVALID_MEDIA'; end if;
  for media_id in select (value->>'id')::uuid from jsonb_array_elements(normalized_media) order by 1 loop
    select * into media_row from public.social_post_media where id=media_id for update;
    if not found or media_row.owner_id<>auth.uid() or media_row.post_id is not null or media_row.upload_status<>'ready' or
        media_row.finalized_at is null or media_row.expires_at<=now() or
        exists(select from private.room_post_submission_media where room_post_submission_media.media_id=media_row.id) then
      raise exception 'MEDIA_NOT_READY';
    end if;
  end loop;
  if n>4 and exists(select from public.social_post_media where id in
      (select (value->>'id')::uuid from jsonb_array_elements(normalized_media)) and media_kind<>'image') then
    raise exception 'MEDIA_LIMIT';
  end if;
  insert into private.room_post_submissions(room_id,author_id,client_request_id,body,reply_access,quote_post_id,media_count,media_snapshot)
    values(p_room_id,auth.uid(),p_client_request_id,p_body,p_reply_access,p_quote_post_id,n,normalized_media) returning * into s;
  insert into private.room_post_submission_media(submission_id,media_id,position,alt_text)
    select s.id,(value->>'id')::uuid,(ordinal-1)::smallint,value->>'alt_text'
    from jsonb_array_elements(normalized_media) with ordinality x(value,ordinal);
  insert into private.room_post_decision_audit(room_id,submission_id,actor_id,actor_role,action,new_state,request_id)
    values(p_room_id,s.id,auth.uid(),role_name,'submitted','pending',p_client_request_id);
  for staff in select member_id from public.social_circle_members where circle_id=p_room_id and member_role in('owner','admin','moderator') loop
    perform private.room_approval_notice(s,'post_approval_requested',staff);
  end loop;
  return jsonb_build_object('submission',private.room_submission_json(s),'published',false);
end;
$$;

create function public.room_list_post_submissions(p_room_id uuid,p_scope text default 'mine',p_state text default 'pending',
  p_before_id uuid default null,p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cursor_row private.room_post_submissions%rowtype; result jsonb; next_id uuid; n integer;
begin
  perform private.room_approval_room(p_room_id);
  if p_scope is null or p_scope not in('mine','staff') or p_state is null or p_state not in('all','pending','approved','rejected','withdrawn') then raise exception 'INVALID_FILTER'; end if;
  if p_scope='staff' and not policy_private.is_room_staff(p_room_id,auth.uid()) then raise exception 'ROOM_STAFF_REQUIRED' using errcode='42501'; end if;
  n:=greatest(1,least(coalesce(p_limit,50),50));
  if p_before_id is not null then
    select * into cursor_row from private.room_post_submissions where id=p_before_id and room_id=p_room_id and
      (p_scope='staff' or author_id=auth.uid());
    if not found then raise exception 'INVALID_CURSOR'; end if;
  end if;
  with candidates as (
    select s.*,row_number() over(order by s.created_at desc,s.id desc) as rn
      from private.room_post_submissions s where s.room_id=p_room_id and (p_scope='staff' or s.author_id=auth.uid()) and
      (p_state='all' or s.state=p_state) and (p_before_id is null or (s.created_at,s.id)<(cursor_row.created_at,cursor_row.id))
    order by s.created_at desc,s.id desc limit n+1
  ) select coalesce(jsonb_agg((to_jsonb(c)-array['client_request_id','decision_request_id','media_snapshot','rn']) order by created_at desc,id desc) filter(where rn<=n),'[]'::jsonb),
    case when count(*)>n then (array_agg(id order by created_at desc,id desc))[n] else null end
    into result,next_id from candidates c;
  return jsonb_build_object('submissions',result,'next_cursor',next_id);
end;
$$;

create function public.room_get_post_submission(p_room_id uuid,p_submission_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.room_post_submissions%rowtype; media jsonb;
begin
  perform private.room_approval_room(p_room_id);
  select * into s from private.room_post_submissions where id=p_submission_id and room_id=p_room_id;
  if not found or (s.author_id<>auth.uid() and not policy_private.is_room_staff(p_room_id,auth.uid())) then
    raise exception 'SUBMISSION_UNAVAILABLE' using errcode='P0002';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'position',l.position,'alt_text',l.alt_text,
      'media_kind',m.media_kind,'content_type',m.content_type,'width',m.width,'height',m.height,'duration_ms',m.duration_ms) order by l.position),'[]'::jsonb)
    into media from private.room_post_submission_media l join public.social_post_media m on m.id=l.media_id where l.submission_id=s.id;
  return jsonb_build_object('submission',private.room_submission_json(s)||jsonb_build_object('media',media));
end;
$$;

create function public.room_submission_media_for_review(p_room_id uuid,p_submission_id uuid,p_media_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.room_post_submissions%rowtype; media jsonb;
begin
  perform private.room_approval_room(p_room_id);
  select * into s from private.room_post_submissions where id=p_submission_id and room_id=p_room_id and state='pending';
  if not found or (s.author_id<>auth.uid() and not policy_private.is_room_staff(p_room_id,auth.uid())) then raise exception 'SUBMISSION_UNAVAILABLE' using errcode='P0002'; end if;
  select to_jsonb(m) into media from private.room_post_submission_media l join public.social_post_media m on m.id=l.media_id
    where l.submission_id=s.id and m.id=p_media_id and m.owner_id=s.author_id and m.post_id is null and m.upload_status='ready';
  if media is null then raise exception 'SUBMISSION_UNAVAILABLE' using errcode='P0002'; end if;
  return media;
end;
$$;

create function public.room_decide_post_submission(p_room_id uuid,p_submission_id uuid,p_request_id uuid,
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
    raise exception 'ALREADY_DECIDED' using errcode='40001';
  end if;
  if p_expected_version is distinct from s.version then raise exception 'VERSION_CONFLICT' using errcode='40001'; end if;
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

create function public.room_withdraw_post_submission(p_room_id uuid,p_submission_id uuid,p_request_id uuid,p_expected_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.room_post_submissions%rowtype; released_ids uuid[];
begin
  perform private.room_approval_room(p_room_id);
  select * into s from private.room_post_submissions where id=p_submission_id and room_id=p_room_id and author_id=auth.uid() for update;
  if not found then raise exception 'SUBMISSION_UNAVAILABLE' using errcode='P0002'; end if;
  if p_request_id is null then raise exception 'REQUEST_ID_REQUIRED'; end if;
  if s.state='withdrawn' and s.decision_request_id=p_request_id then return jsonb_build_object('submission',private.room_submission_json(s)); end if;
  if s.state<>'pending' then raise exception 'ALREADY_DECIDED' using errcode='40001'; end if;
  if p_expected_version is distinct from s.version then raise exception 'VERSION_CONFLICT' using errcode='40001'; end if;
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

create function public.room_post_approval_audit(p_room_id uuid,p_before_id bigint default null,p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  perform private.room_approval_room(p_room_id);
  if coalesce(policy_private.room_member_role(p_room_id,auth.uid()),'') not in('owner','admin') then raise exception 'ROOM_ADMIN_REQUIRED' using errcode='42501'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.id desc),'[]'::jsonb) into result from (
    select * from private.room_post_decision_audit where room_id=p_room_id and (p_before_id is null or id<p_before_id)
    order by id desc limit greatest(1,least(coalesce(p_limit,50),50))) x;
  return jsonb_build_object('audit',result);
end;
$$;

create function private.audit_room_post_approval_setting()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.post_approval_required is distinct from old.post_approval_required then
    insert into private.room_post_decision_audit(room_id,actor_id,actor_role,action,old_state,new_state,request_id)
      values(new.id,auth.uid(),policy_private.room_member_role(new.id,auth.uid()),'approval_setting_changed',
        old.post_approval_required::text,new.post_approval_required::text,gen_random_uuid());
  end if;
  return new;
end;
$$;
revoke all on function private.audit_room_post_approval_setting() from public,anon,authenticated;
create trigger audit_room_post_approval_setting after update of post_approval_required on public.social_circles
for each row execute function private.audit_room_post_approval_setting();

-- Route old/new API calls safely; existing request IDs continue returning their
-- submission after a setting/role change, rather than accidentally publishing a
-- duplicate after a lost202. No content or other user's idempotency data leaks.
create function public.room_post_submission_route(p_room_id uuid,p_client_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.social_circles%rowtype; role_name text;
begin
  r:=private.room_approval_room(p_room_id);
  role_name:=policy_private.room_member_role(p_room_id,auth.uid());
  if role_name is null then raise exception 'ROOM_MEMBERSHIP_REQUIRED' using errcode='42501'; end if;
  return jsonb_build_object('requires_review',
    exists(select from private.room_post_submissions where author_id=auth.uid() and client_request_id=p_client_request_id) or
    (r.post_approval_required and role_name not in('owner','admin','moderator')),
    'existing_submission',exists(select from private.room_post_submissions where author_id=auth.uid() and client_request_id=p_client_request_id));
end;
$$;

create function public.room_held_media_uploads(p_media_ids uuid[])
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  if coalesce(array_length(p_media_ids,1),0)>5 then raise exception 'INVALID_MEDIA'; end if;
  return (select coalesce(jsonb_agg(l.media_id),'[]'::jsonb) from private.room_post_submission_media l
    join public.social_post_media m on m.id=l.media_id where m.owner_id=auth.uid() and m.id=any(p_media_ids));
end;
$$;

revoke all on function public.room_post_approval_capabilities(),public.room_submit_post_for_review(uuid,uuid,text,text,uuid,jsonb),
  public.room_list_post_submissions(uuid,text,text,uuid,integer),public.room_get_post_submission(uuid,uuid),
  public.room_submission_media_for_review(uuid,uuid,uuid),public.room_decide_post_submission(uuid,uuid,uuid,integer,text,text),
  public.room_withdraw_post_submission(uuid,uuid,uuid,integer),public.room_post_approval_audit(uuid,bigint,integer),
  public.room_post_submission_route(uuid,uuid),public.room_held_media_uploads(uuid[])
  from public,anon,authenticated;
grant execute on function public.room_post_approval_capabilities(),public.room_submit_post_for_review(uuid,uuid,text,text,uuid,jsonb),
  public.room_list_post_submissions(uuid,text,text,uuid,integer),public.room_get_post_submission(uuid,uuid),
  public.room_submission_media_for_review(uuid,uuid,uuid),public.room_decide_post_submission(uuid,uuid,uuid,integer,text,text),
  public.room_withdraw_post_submission(uuid,uuid,uuid,integer),public.room_post_approval_audit(uuid,bigint,integer),
  public.room_post_submission_route(uuid,uuid),public.room_held_media_uploads(uuid[]) to authenticated;

commit;
