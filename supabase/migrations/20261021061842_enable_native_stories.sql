-- App Stories: private assets/quotas and caller-bound RPCs. No direct client table access.
begin;

create schema if not exists private;
create table private.story_worker_credentials (
  key_name text primary key check (key_name = 'stories-worker-v1'),
  key_sha256 text not null check (key_sha256 ~ '^[a-f0-9]{64}$'),
  enabled boolean not null default true
);
create table private.stories (
  id uuid primary key default gen_random_uuid(),
  -- Preserve the cleanup pointer if Auth/profile deletion happens before cron.
  owner_id uuid not null,
  client_key uuid not null,
  media_kind text not null check (media_kind in ('image','video')),
  content_type text not null,
  size_bytes bigint not null,
  object_key text not null unique,
  status text not null default 'pending' check (status in ('pending','published','deleted')),
  caption text not null default '' check (char_length(caption) <= 500),
  width integer check (width between 1 and 8192),
  height integer check (height between 1 and 8192),
  duration_ms bigint,
  stream_uid text,
  created_at timestamptz not null default now(),
  upload_expires_at timestamptz not null default (now() + interval '1 hour'),
  published_at timestamptz,
  expires_at timestamptz,
  deleted_at timestamptz,
  cleaned_at timestamptz,
  unique(owner_id,client_key),
  check ((media_kind='image' and content_type in ('image/jpeg','image/png','image/webp') and size_bytes between 1 and 8388608)
    or (media_kind='video' and content_type='video/mp4' and size_bytes between 1 and 100000000)),
  check (duration_ms is null or (media_kind='video' and duration_ms between 1 and 30000)),
  check (stream_uid is null or (media_kind='video' and stream_uid ~ '^[a-f0-9]{32}$')),
  check (object_key = 'stories/' || owner_id::text || '/' || id::text || '.' ||
    case content_type when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' when 'video/mp4' then 'mp4' end),
  check ((published_at is null and expires_at is null) or expires_at = published_at + interval '24 hours')
);
create table private.story_views (
  story_id uuid not null references private.stories(id) on delete cascade,
  viewer_id uuid not null references public.social_profiles(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key(story_id,viewer_id)
);
create table private.story_reactions (
  story_id uuid not null references private.stories(id) on delete cascade,
  actor_id uuid not null references public.social_profiles(id) on delete cascade,
  reaction text not null check (reaction in ('love','dislike')),
  created_at timestamptz not null default now(),
  primary key(story_id,actor_id)
);
create table private.story_notification_receipts (
  story_id uuid not null references private.stories(id) on delete cascade,
  actor_id uuid not null references public.social_profiles(id) on delete cascade,
  notification_id bigint,
  primary key(story_id,actor_id)
);
create index stories_owner_quota on private.stories(owner_id,media_kind,created_at desc);
create index stories_owner_published_quota on private.stories(owner_id,media_kind,published_at desc) where published_at is not null;
create index stories_owner_pending_quota on private.stories(owner_id,media_kind,upload_expires_at) where published_at is null and status='pending';
create index stories_live on private.stories(expires_at,published_at) where status='published';
create index stories_cleanup on private.stories(cleaned_at,expires_at,upload_expires_at);
create index story_views_page on private.story_views(story_id,viewed_at desc,viewer_id);

alter table private.story_worker_credentials enable row level security;
alter table private.stories enable row level security;
alter table private.story_views enable row level security;
alter table private.story_reactions enable row level security;
alter table private.story_notification_receipts enable row level security;
alter table private.story_worker_credentials force row level security;
alter table private.stories force row level security;
alter table private.story_views force row level security;
alter table private.story_reactions force row level security;
alter table private.story_notification_receipts force row level security;
revoke all on private.story_worker_credentials,private.stories,private.story_views,private.story_reactions,private.story_notification_receipts from public,anon,authenticated;

alter table public.social_notifications add column story_id uuid references private.stories(id) on delete cascade;
alter table public.social_notifications drop constraint social_notifications_type_allowed;
alter table public.social_notifications add constraint social_notifications_type_allowed check (
  notification_type in ('follow','reply','mention','like','reshare','circle','message','safety','verification','story_like','story_dislike')
);
create unique index social_notifications_story_actor_unique on public.social_notifications(story_id,actor_id) where story_id is not null;
create index social_notifications_story on public.social_notifications(story_id) where story_id is not null;

create function private.story_assert_worker(p_worker_key text) returns void language plpgsql security definer set search_path='' as $$
begin
  if p_worker_key is null or char_length(p_worker_key) not between 32 and 512 or not exists (
    select 1 from private.story_worker_credentials c where c.key_name='stories-worker-v1' and c.enabled
      and c.key_sha256=encode(sha256(convert_to(p_worker_key,'UTF8')),'hex')
  ) then raise exception 'STORIES_WORKER_REQUIRED' using errcode='42501'; end if;
end;
$$;

create function private.story_account_available(p_user uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.social_profiles p join auth.users u on u.id=p.id
    where p.id=p_user and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now()))
    and not exists(select 1 from public.social_account_deletion_requests d where d.user_id=p_user and d.status in ('pending','completed'));
$$;
create function private.story_current_user() returns uuid language plpgsql stable security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_session text:=auth.jwt()->>'session_id';
begin
  if v_user is null or v_session is null or v_session !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
    or not private.story_account_available(v_user) then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  if not exists(select 1 from auth.sessions s where s.id=v_session::uuid and s.user_id=v_user and (s.not_after is null or s.not_after>now())) then
    raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  return v_user;
end;
$$;
create function private.story_can_view(p_owner uuid,p_viewer uuid) returns boolean language sql stable security definer set search_path='' as $$
  select private.story_account_available(p_owner)
    and (p_owner=p_viewer or exists(select 1 from public.social_profiles p where p.id=p_owner and p.is_discoverable))
    and not exists(select 1 from public.social_blocks b where (b.blocker_id=p_owner and b.blocked_id=p_viewer) or (b.blocker_id=p_viewer and b.blocked_id=p_owner));
$$;
create function private.story_profile(p_user uuid) returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',p.id,'username',p.username,'display_name',p.display_name,
    'is_verified',p.is_verified,'verification_badge_type',p.verification_badge_type,'has_avatar',p.avatar_key is not null)
  from public.social_profiles p where p.id=p_user;
$$;
create function private.story_project(p_story uuid,p_viewer uuid) returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',s.id,'owner_id',s.owner_id,'media_kind',s.media_kind,'caption',s.caption,
    'width',s.width,'height',s.height,'duration_ms',s.duration_ms,'published_at',s.published_at,'expires_at',s.expires_at,
    'view_count',case when s.owner_id=p_viewer then (select count(*) from private.story_views v where v.story_id=s.id) else null end,
    'reaction',(select r.reaction from private.story_reactions r where r.story_id=s.id and r.actor_id=p_viewer),
    'viewed',exists(select 1 from private.story_views v where v.story_id=s.id and v.viewer_id=p_viewer),
    'author',private.story_profile(s.owner_id))
  from private.stories s where s.id=p_story;
$$;

create function private.stories_reserve_v1(p_media_kind text,p_content_type text,p_size_bytes bigint,p_client_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_user uuid:=private.story_current_user(); v_row private.stories%rowtype; v_id uuid:=gen_random_uuid(); v_count integer;
begin
  if p_client_key is null or p_media_kind not in ('image','video') or p_media_kind is null
    or p_size_bytes is null or p_size_bytes<1 or p_size_bytes>100000000 or p_content_type is null
    or not ((p_media_kind='image' and p_content_type in ('image/jpeg','image/png','image/webp') and p_size_bytes<=8388608)
      or (p_media_kind='video' and p_content_type='video/mp4')) then raise exception 'INVALID_STORY_MEDIA' using errcode='22023'; end if;
  -- Serialize reservations for this account, including its first reservation.
  perform 1 from public.social_profiles where id=v_user for update;
  if not found then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  select * into v_row from private.stories where owner_id=v_user and client_key=p_client_key;
  if found then
    if v_row.media_kind<>p_media_kind or v_row.content_type<>p_content_type or v_row.size_bytes<>p_size_bytes then
      raise exception 'STORY_REQUEST_CONFLICT' using errcode='22023'; end if;
    if v_row.status<>'pending' or v_row.upload_expires_at<=now() then raise exception 'STORY_UPLOAD_UNAVAILABLE' using errcode='22023'; end if;
    return to_jsonb(v_row);
  end if;
  select count(*) into v_count from private.stories where owner_id=v_user and media_kind=p_media_kind and
    (published_at>now()-interval '24 hours' or (published_at is null and status='pending' and upload_expires_at>now()));
  if v_count>=(case when p_media_kind='video' then 2 else 4 end) then raise exception 'STORY_DAILY_LIMIT' using errcode='22023'; end if;
  insert into private.stories(id,owner_id,client_key,media_kind,content_type,size_bytes,object_key)
  values(v_id,v_user,p_client_key,p_media_kind,p_content_type,p_size_bytes,'stories/'||v_user::text||'/'||v_id::text||'.'||
    case p_content_type when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' else 'mp4' end)
  returning * into v_row;
  return to_jsonb(v_row);
end;
$$;
create function private.stories_quota_v1() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_user uuid:=private.story_current_user(); v_result jsonb;
begin
  select jsonb_build_object('images_used',count(*) filter(where media_kind='image'),'videos_used',count(*) filter(where media_kind='video'),
    'resets_at',min(case when published_at is not null then published_at+interval '24 hours' else upload_expires_at end)) into v_result from private.stories where owner_id=v_user and
      (published_at>now()-interval '24 hours' or (published_at is null and status='pending' and upload_expires_at>now()));
  return v_result;
end;
$$;
create function private.stories_upload_v1(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_user uuid:=private.story_current_user(); v_result jsonb;
begin
  select to_jsonb(s) into v_result from private.stories s where id=p_id and owner_id=v_user and deleted_at is null and
    ((status='pending' and upload_expires_at>now()) or (status='published' and expires_at>now()));
  if v_result is null then raise exception 'STORY_UPLOAD_UNAVAILABLE' using errcode='42501'; end if;
  return v_result;
end;
$$;
create function private.stories_publish_v1(p_id uuid,p_worker_key text,p_width integer,p_height integer,p_duration_ms bigint,p_stream_uid text,p_caption text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_user uuid:=private.story_current_user(); v_story private.stories%rowtype;
begin
  perform private.story_assert_worker(p_worker_key);
  select * into v_story from private.stories where id=p_id and owner_id=v_user for update;
  if not found then raise exception 'STORY_UNAVAILABLE' using errcode='42501'; end if;
  if v_story.status='published' and v_story.expires_at>now() then return private.story_project(p_id,v_user); end if;
  if v_story.status<>'pending' or v_story.upload_expires_at<=now() then raise exception 'STORY_UPLOAD_UNAVAILABLE' using errcode='22023'; end if;
  if p_width is null or p_height is null or p_width not between 1 and 8192 or p_height not between 1 and 8192
    or p_caption is null or char_length(p_caption)>500
    or (v_story.media_kind='video' and (p_duration_ms is null or p_duration_ms not between 1 and 30000 or p_stream_uid is null or p_stream_uid !~ '^[a-f0-9]{32}$'))
    or (v_story.media_kind='image' and (p_duration_ms is not null or p_stream_uid is not null)) then raise exception 'INVALID_STORY_PUBLICATION' using errcode='22023'; end if;
  update private.stories set status='published',width=p_width,height=p_height,duration_ms=p_duration_ms,stream_uid=p_stream_uid,
    caption=p_caption,published_at=now(),expires_at=now()+interval '24 hours' where id=p_id;
  return private.story_project(p_id,v_user);
end;
$$;
create function private.stories_feed_v1(p_username text default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_user uuid:=private.story_current_user(); v_result jsonb;
begin
  select coalesce(jsonb_agg(item.payload order by item.own desc,item.published_at desc,item.id),'[]'::jsonb) into v_result from (
    select s.id,s.owner_id=v_user as own,s.published_at,private.story_project(s.id,v_user) as payload from private.stories s
    join public.social_profiles p on p.id=s.owner_id
    where s.status='published' and s.deleted_at is null and s.expires_at>now() and private.story_can_view(s.owner_id,v_user)
      and not exists(select 1 from public.social_mutes m where m.muter_id=v_user and m.muted_id=s.owner_id)
      and ((p_username is not null and p.username=lower(btrim(p_username))) or (p_username is null and
        (s.owner_id=v_user or (p.is_verified and p.verification_badge_type='team') or exists(select 1 from public.social_follows f where f.follower_id=v_user and f.followed_id=s.owner_id))))
    order by (s.owner_id=v_user) desc,s.published_at desc,s.id limit 600
  ) item;
  return v_result;
end;
$$;
create function private.stories_get_v1(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_user uuid:=private.story_current_user();
begin
  if not exists(select 1 from private.stories s where s.id=p_id and s.status='published' and s.deleted_at is null and s.expires_at>now() and private.story_can_view(s.owner_id,v_user)) then
    raise exception 'STORY_UNAVAILABLE' using errcode='42501'; end if;
  return private.story_project(p_id,v_user);
end;
$$;
create function private.stories_asset_v1(p_id uuid,p_worker_key text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_user uuid:=private.story_current_user(); v_result jsonb;
begin
  perform private.story_assert_worker(p_worker_key);
  perform private.stories_get_v1(p_id);
  select to_jsonb(s) into v_result from private.stories s where id=p_id;
  return v_result;
end;
$$;
create function private.stories_edit_v1(p_id uuid,p_caption text) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=private.story_current_user();
begin
  if p_caption is null or char_length(p_caption)>500 then raise exception 'INVALID_STORY_CAPTION' using errcode='22023'; end if;
  update private.stories set caption=p_caption where id=p_id and owner_id=v_user and status='published' and deleted_at is null and expires_at>now();
  if not found then raise exception 'STORY_UNAVAILABLE' using errcode='42501'; end if;
  return private.story_project(p_id,v_user);
end;
$$;
create function private.stories_delete_v1(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=private.story_current_user();
begin
  update private.stories set status='deleted',deleted_at=coalesce(deleted_at,now()) where id=p_id and owner_id=v_user;
  if not found then raise exception 'STORY_UNAVAILABLE' using errcode='42501'; end if;
  delete from public.social_notifications where story_id=p_id;
  return jsonb_build_object('deleted',true);
end;
$$;
create function private.stories_view_v1(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=private.story_current_user(); v_owner uuid;
begin
  perform private.stories_get_v1(p_id);
  select owner_id into v_owner from private.stories where id=p_id and status='published' and deleted_at is null and expires_at>now()
    and private.story_can_view(owner_id,v_user) for update;
  if not found then raise exception 'STORY_UNAVAILABLE' using errcode='42501'; end if;
  if v_owner<>v_user then insert into private.story_views(story_id,viewer_id) values(p_id,v_user) on conflict do nothing; end if;
  return jsonb_build_object('recorded',true,'view_count',case when v_owner=v_user then (select count(*) from private.story_views where story_id=p_id) else null end);
end;
$$;
create function private.stories_viewers_v1(p_id uuid,p_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_user uuid:=private.story_current_user(); v_rows jsonb; v_total bigint;
begin
  perform private.stories_get_v1(p_id);
  if not exists(select 1 from private.stories where id=p_id and owner_id=v_user) then raise exception 'STORY_OWNER_REQUIRED' using errcode='42501'; end if;
  if p_offset is null or p_offset<0 or p_offset>100000 then raise exception 'INVALID_STORY_OFFSET' using errcode='22023'; end if;
  select count(*) into v_total from private.story_views v where v.story_id=p_id and private.story_can_view(v.viewer_id,v_user);
  select coalesce(jsonb_agg(x.payload order by x.viewed_at desc,x.viewer_id),'[]'::jsonb) into v_rows from (
    select v.viewer_id,v.viewed_at,private.story_profile(v.viewer_id)||jsonb_build_object('viewed_at',v.viewed_at) as payload
    from private.story_views v where v.story_id=p_id and private.story_can_view(v.viewer_id,v_user)
    order by v.viewed_at desc,v.viewer_id limit 50 offset p_offset
  ) x;
  return jsonb_build_object('viewers',v_rows,'has_more',v_total>p_offset+50,'total',v_total);
end;
$$;
create function private.stories_react_v1(p_id uuid,p_reaction text) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=private.story_current_user(); v_owner uuid; v_notice bigint; v_first boolean:=false; v_kind text;
begin
  perform private.stories_get_v1(p_id);
  select owner_id into v_owner from private.stories where id=p_id and status='published' and deleted_at is null and expires_at>now()
    and private.story_can_view(owner_id,v_user) for update;
  if not found then raise exception 'STORY_UNAVAILABLE' using errcode='42501'; end if;
  if v_owner=v_user then raise exception 'STORY_SELF_REACTION' using errcode='22023'; end if;
  if p_reaction is not null and p_reaction not in ('love','dislike') then raise exception 'INVALID_STORY_REACTION' using errcode='22023'; end if;
  if p_reaction is null then
    delete from private.story_reactions where story_id=p_id and actor_id=v_user;
    delete from public.social_notifications where story_id=p_id and actor_id=v_user;
  else
    insert into private.story_reactions(story_id,actor_id,reaction) values(p_id,v_user,p_reaction)
      on conflict(story_id,actor_id) do update set reaction=excluded.reaction;
    v_kind:=case when p_reaction='love' then 'story_like' else 'story_dislike' end;
    if private.story_can_view(v_user,v_owner) and coalesce((select p.notify_post_activity from public.social_member_preferences p where p.user_id=v_owner),true)
      and not exists(select 1 from public.social_mutes m where m.muter_id=v_owner and m.muted_id=v_user) then
      insert into private.story_notification_receipts(story_id,actor_id) values(p_id,v_user) on conflict do nothing returning true into v_first;
      if v_first then
        insert into public.social_notifications(recipient_id,actor_id,notification_type,story_id) values(v_owner,v_user,v_kind,p_id) returning id into v_notice;
        update private.story_notification_receipts set notification_id=v_notice where story_id=p_id and actor_id=v_user;
      else
        insert into public.social_notifications(recipient_id,actor_id,notification_type,story_id) values(v_owner,v_user,v_kind,p_id)
          on conflict(story_id,actor_id) where story_id is not null do update set notification_type=excluded.notification_type;
      end if;
    end if;
  end if;
  return jsonb_build_object('reaction',p_reaction);
end;
$$;

create function private.stories_cleanup_v1(p_worker_key text,p_limit integer default 100) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
  perform private.story_assert_worker(p_worker_key);
  if p_limit is null or p_limit not between 1 and 200 then raise exception 'INVALID_STORY_CLEANUP_LIMIT' using errcode='22023'; end if;
  delete from private.stories where cleaned_at<now()-interval '24 hours' and created_at<now()-interval '48 hours';
  with targets as (select id from private.stories where cleaned_at is null and
    (status='deleted' or not private.story_account_available(owner_id) or (status='published' and expires_at<=now()) or (status='pending' and upload_expires_at<=now()))
    order by coalesce(expires_at,upload_expires_at),id limit p_limit for update skip locked),
  changed as (update private.stories s set status='deleted',deleted_at=coalesce(s.deleted_at,now()) from targets t where s.id=t.id returning s.*)
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'owner_id',owner_id,'object_key',object_key,'stream_uid',stream_uid,'media_kind',media_kind,'content_type',content_type)),'[]'::jsonb) into v_result from changed;
  delete from public.social_notifications n where exists(select 1 from private.stories s where s.id=n.story_id and s.status='deleted');
  return v_result;
end;
$$;
create function private.stories_cleanup_ack_v1(p_id uuid,p_worker_key text) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform private.story_assert_worker(p_worker_key);
  update private.stories set cleaned_at=coalesce(cleaned_at,now()),stream_uid=null,caption='',width=null,height=null,duration_ms=null where id=p_id and status='deleted';
  if not found then raise exception 'STORY_CLEANUP_UNAVAILABLE' using errcode='22023'; end if;
  delete from private.story_views where story_id=p_id;
  delete from private.story_reactions where story_id=p_id;
  delete from private.story_notification_receipts where story_id=p_id;
  delete from public.social_notifications where story_id=p_id;
  return jsonb_build_object('cleaned',true);
end;
$$;

create function private.stories_video_backfill_v1(p_worker_key text,p_after uuid default null,p_limit integer default 25) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb;
begin
  perform private.story_assert_worker(p_worker_key);
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'INVALID_MEDIA_SCAN_LIMIT' using errcode='22023'; end if;
  select coalesce(jsonb_agg(x.payload order by x.id),'[]'::jsonb) into v_result from (
    select m.id,jsonb_build_object('id',m.id,'owner_id',m.owner_id,'post_id',m.post_id,'object_key',m.object_key,
      'duration_ms',m.duration_ms,'media_kind',m.media_kind,'upload_status',m.upload_status,'size_bytes',m.size_bytes,'width',m.width,'height',m.height) as payload
    from public.social_post_media m join public.social_posts p on p.id=m.post_id
    where m.media_kind='video' and m.upload_status='attached' and p.post_status='published' and p.deleted_at is null and p.moderation_state='visible'
      and m.owner_id=p.author_id and m.object_key='sauti/'||m.owner_id::text||'/'||m.id::text||'.mp4'
      and exists(select 1 from public.social_profiles owner_profile where owner_profile.id=m.owner_id and owner_profile.is_discoverable)
      and private.story_account_available(m.owner_id) and (p_after is null or m.id>p_after)
    order by m.id limit p_limit
  ) x;
  return v_result;
end;
$$;
create function private.stories_asset_state_v1(p_worker_key text,p_kind text,p_id uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
begin
  perform private.story_assert_worker(p_worker_key);
  if p_kind='story' then return exists(select 1 from private.stories s where s.id=p_id and s.cleaned_at is null and s.deleted_at is null
    and ((s.status='pending' and s.upload_expires_at>now()) or (s.status='published' and s.expires_at>now())) and private.story_account_available(s.owner_id));
  elsif p_kind='post' then return exists(select 1 from public.social_post_media m join public.social_posts p on p.id=m.post_id
    where m.id=p_id and m.media_kind='video' and m.upload_status='attached' and p.post_status='published' and p.deleted_at is null
      and p.moderation_state='visible' and m.owner_id=p.author_id and m.object_key='sauti/'||m.owner_id::text||'/'||m.id::text||'.mp4'
      and exists(select 1 from public.social_profiles owner_profile where owner_profile.id=m.owner_id and owner_profile.is_discoverable)
      and private.story_account_available(m.owner_id));
  else raise exception 'INVALID_MEDIA_KIND' using errcode='22023'; end if;
end;
$$;

-- Add only Story push delivery; existing post/DM triggers keep their behavior.
create function private.enqueue_story_push_v1() returns trigger language plpgsql security definer set search_path='' as $$
declare v_queue uuid; v_dispatch uuid;
begin
  if new.notification_type not in ('story_like','story_dislike') or new.story_id is null then return new; end if;
  if exists(select 1 from private.story_notification_receipts r where r.story_id=new.story_id and r.actor_id=new.actor_id and r.notification_id is not null) then return new; end if;
  insert into public.push_delivery_queue(recipient_id,source_type,source_id) values(new.recipient_id,'social_notification',new.id::text)
    on conflict(source_type,source_id,recipient_id) do nothing returning id,dispatch_key into v_queue,v_dispatch;
  if v_queue is not null then perform private.dispatch_push_delivery_v1(v_queue,v_dispatch); end if;
  return new;
end;
$$;
create trigger enqueue_story_push after insert on public.social_notifications for each row execute function private.enqueue_story_push_v1();

create function private.story_notification_visible_v1(p_story uuid,p_actor uuid,p_recipient uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
declare v_user uuid:=private.story_current_user();
begin
  return p_recipient=v_user and private.story_can_view(p_actor,v_user)
    and coalesce((select pref.notify_post_activity from public.social_member_preferences pref where pref.user_id=v_user),true)
    and not exists(select 1 from public.social_mutes m where m.muter_id=v_user and m.muted_id=p_actor)
    and exists(select 1 from private.stories s where s.id=p_story and s.owner_id=v_user and s.status='published' and s.deleted_at is null and s.expires_at>now());
end;
$$;
create policy social_notifications_story_lifecycle on public.social_notifications as restrictive for select to authenticated
  using (story_id is null or private.story_notification_visible_v1(story_id,actor_id,recipient_id));

-- Push dispatch has a service-role connection, not the recipient's session. Its
-- narrow read rechecks expiry/privacy/preferences immediately before delivery.
create function private.stories_push_authorize_v1(p_story uuid,p_actor uuid,p_recipient uuid,p_notification_id bigint) returns boolean
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.jwt()->>'role' is distinct from 'service_role' then raise exception 'STORIES_PUSH_WORKER_REQUIRED' using errcode='42501'; end if;
  return private.story_account_available(p_recipient) and private.story_can_view(p_actor,p_recipient)
    and coalesce((select p.notify_post_activity from public.social_member_preferences p where p.user_id=p_recipient),true)
    and not exists(select 1 from public.social_mutes m where m.muter_id=p_recipient and m.muted_id=p_actor)
    and exists(select 1 from private.stories s where s.id=p_story and s.owner_id=p_recipient and s.status='published' and s.deleted_at is null and s.expires_at>now())
    and exists(select 1 from public.social_notifications n where n.id=p_notification_id and n.story_id=p_story and n.actor_id=p_actor and n.recipient_id=p_recipient
      and n.notification_type in ('story_like','story_dislike'));
end;
$$;
create function public.stories_push_authorize(p_story uuid,p_actor uuid,p_recipient uuid,p_notification_id bigint) returns boolean
language sql stable security invoker set search_path='' as $$ select private.stories_push_authorize_v1(p_story,p_actor,p_recipient,p_notification_id); $$;
revoke all on function public.stories_push_authorize(uuid,uuid,uuid,bigint),private.stories_push_authorize_v1(uuid,uuid,uuid,bigint) from public,anon,authenticated;
grant usage on schema private to service_role;
grant execute on function public.stories_push_authorize(uuid,uuid,uuid,bigint),private.stories_push_authorize_v1(uuid,uuid,uuid,bigint) to service_role;

-- All Data API functions are invokers; privileged implementations stay outside
-- exposed schemas and perform their own caller/session/worker authorization.

create function public.stories_reserve(p_media_kind text,p_content_type text,p_size_bytes bigint,p_client_key uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.stories_reserve_v1(p_media_kind,p_content_type,p_size_bytes,p_client_key); $$;
revoke all on function public.stories_reserve(text,text,bigint,uuid),private.stories_reserve_v1(text,text,bigint,uuid) from public,anon,authenticated;
grant execute on function public.stories_reserve(text,text,bigint,uuid),private.stories_reserve_v1(text,text,bigint,uuid) to authenticated;
create function public.stories_quota() returns jsonb language sql security invoker set search_path='' as $$ select private.stories_quota_v1(); $$;
revoke all on function public.stories_quota(),private.stories_quota_v1() from public,anon,authenticated;
grant execute on function public.stories_quota(),private.stories_quota_v1() to authenticated;
create function public.stories_upload(p_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.stories_upload_v1(p_id); $$;
revoke all on function public.stories_upload(uuid),private.stories_upload_v1(uuid) from public,anon,authenticated;
grant execute on function public.stories_upload(uuid),private.stories_upload_v1(uuid) to authenticated;
create function public.stories_publish(p_id uuid,p_worker_key text,p_width integer,p_height integer,p_duration_ms bigint,p_stream_uid text,p_caption text) returns jsonb language sql security invoker set search_path='' as $$ select private.stories_publish_v1(p_id,p_worker_key,p_width,p_height,p_duration_ms,p_stream_uid,p_caption); $$;
revoke all on function public.stories_publish(uuid,text,integer,integer,bigint,text,text),private.stories_publish_v1(uuid,text,integer,integer,bigint,text,text) from public,anon,authenticated;
grant execute on function public.stories_publish(uuid,text,integer,integer,bigint,text,text),private.stories_publish_v1(uuid,text,integer,integer,bigint,text,text) to authenticated;
create function public.stories_feed(p_username text default null) returns jsonb language sql security invoker set search_path='' as $$ select private.stories_feed_v1(p_username); $$;
revoke all on function public.stories_feed(text),private.stories_feed_v1(text) from public,anon,authenticated;
grant execute on function public.stories_feed(text),private.stories_feed_v1(text) to authenticated;
create function public.stories_get(p_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.stories_get_v1(p_id); $$;
revoke all on function public.stories_get(uuid),private.stories_get_v1(uuid) from public,anon,authenticated;
grant execute on function public.stories_get(uuid),private.stories_get_v1(uuid) to authenticated;
create function public.stories_asset(p_id uuid,p_worker_key text) returns jsonb language sql security invoker set search_path='' as $$ select private.stories_asset_v1(p_id,p_worker_key); $$;
revoke all on function public.stories_asset(uuid,text),private.stories_asset_v1(uuid,text) from public,anon,authenticated;
grant execute on function public.stories_asset(uuid,text),private.stories_asset_v1(uuid,text) to authenticated;
create function public.stories_edit(p_id uuid,p_caption text) returns jsonb language sql security invoker set search_path='' as $$ select private.stories_edit_v1(p_id,p_caption); $$;
revoke all on function public.stories_edit(uuid,text),private.stories_edit_v1(uuid,text) from public,anon,authenticated;
grant execute on function public.stories_edit(uuid,text),private.stories_edit_v1(uuid,text) to authenticated;
create function public.stories_delete(p_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.stories_delete_v1(p_id); $$;
revoke all on function public.stories_delete(uuid),private.stories_delete_v1(uuid) from public,anon,authenticated;
grant execute on function public.stories_delete(uuid),private.stories_delete_v1(uuid) to authenticated;
create function public.stories_view(p_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.stories_view_v1(p_id); $$;
revoke all on function public.stories_view(uuid),private.stories_view_v1(uuid) from public,anon,authenticated;
grant execute on function public.stories_view(uuid),private.stories_view_v1(uuid) to authenticated;
create function public.stories_viewers(p_id uuid,p_offset integer default 0) returns jsonb language sql security invoker set search_path='' as $$ select private.stories_viewers_v1(p_id,p_offset); $$;
revoke all on function public.stories_viewers(uuid,integer),private.stories_viewers_v1(uuid,integer) from public,anon,authenticated;
grant execute on function public.stories_viewers(uuid,integer),private.stories_viewers_v1(uuid,integer) to authenticated;
create function public.stories_react(p_id uuid,p_reaction text) returns jsonb language sql security invoker set search_path='' as $$ select private.stories_react_v1(p_id,p_reaction); $$;
revoke all on function public.stories_react(uuid,text),private.stories_react_v1(uuid,text) from public,anon,authenticated;
grant execute on function public.stories_react(uuid,text),private.stories_react_v1(uuid,text) to authenticated;
create function public.stories_cleanup(p_worker_key text,p_limit integer default 100) returns jsonb language sql security invoker set search_path='' as $$ select private.stories_cleanup_v1(p_worker_key,p_limit); $$;
revoke all on function public.stories_cleanup(text,integer),private.stories_cleanup_v1(text,integer) from public,anon,authenticated;
grant execute on function public.stories_cleanup(text,integer),private.stories_cleanup_v1(text,integer) to anon,authenticated;
create function public.stories_cleanup_ack(p_id uuid,p_worker_key text) returns jsonb language sql security invoker set search_path='' as $$ select private.stories_cleanup_ack_v1(p_id,p_worker_key); $$;
revoke all on function public.stories_cleanup_ack(uuid,text),private.stories_cleanup_ack_v1(uuid,text) from public,anon,authenticated;
grant execute on function public.stories_cleanup_ack(uuid,text),private.stories_cleanup_ack_v1(uuid,text) to anon,authenticated;
create function public.stories_video_backfill(p_worker_key text,p_after uuid default null,p_limit integer default 25) returns jsonb language sql security invoker set search_path='' as $$ select private.stories_video_backfill_v1(p_worker_key,p_after,p_limit); $$;
revoke all on function public.stories_video_backfill(text,uuid,integer),private.stories_video_backfill_v1(text,uuid,integer) from public,anon,authenticated;
grant execute on function public.stories_video_backfill(text,uuid,integer),private.stories_video_backfill_v1(text,uuid,integer) to anon,authenticated;
create function public.stories_asset_state(p_worker_key text,p_kind text,p_id uuid) returns boolean language sql security invoker set search_path='' as $$ select private.stories_asset_state_v1(p_worker_key,p_kind,p_id); $$;
revoke all on function public.stories_asset_state(text,text,uuid),private.stories_asset_state_v1(text,text,uuid) from public,anon,authenticated;
grant execute on function public.stories_asset_state(text,text,uuid),private.stories_asset_state_v1(text,text,uuid) to anon,authenticated;
grant usage on schema private to anon,authenticated;
revoke all on function private.story_assert_worker(text) from public,anon,authenticated;
revoke all on function private.story_account_available(uuid) from public,anon,authenticated;
revoke all on function private.story_current_user() from public,anon,authenticated;
revoke all on function private.story_can_view(uuid,uuid) from public,anon,authenticated;
revoke all on function private.story_profile(uuid) from public,anon,authenticated;
revoke all on function private.story_project(uuid,uuid) from public,anon,authenticated;
revoke all on function private.enqueue_story_push_v1() from public,anon,authenticated;
revoke all on function private.story_notification_visible_v1(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function private.story_notification_visible_v1(uuid,uuid,uuid) to authenticated;
commit;

