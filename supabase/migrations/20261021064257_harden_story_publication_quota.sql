-- Reserve and publish share an account-first lock order. Transaction-start now()
-- must not resurrect a reservation that expired while waiting for either lock.
begin;

create or replace function private.stories_reserve_v1(p_media_kind text,p_content_type text,p_size_bytes bigint,p_client_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_user uuid:=private.story_current_user();
  v_row private.stories%rowtype;
  v_id uuid:=gen_random_uuid();
  v_count integer;
  v_existing boolean;
  v_now timestamptz;
begin
  if p_client_key is null or p_media_kind not in ('image','video') or p_media_kind is null
    or p_size_bytes is null or p_size_bytes<1 or p_size_bytes>100000000 or p_content_type is null
    or not ((p_media_kind='image' and p_content_type in ('image/jpeg','image/png','image/webp') and p_size_bytes<=8388608)
      or (p_media_kind='video' and p_content_type='video/mp4')) then raise exception 'INVALID_STORY_MEDIA' using errcode='22023'; end if;

  perform 1 from public.social_profiles where id=v_user for update;
  if not found then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  select * into v_row from private.stories where owner_id=v_user and client_key=p_client_key for update;
  v_existing:=found;
  v_now:=clock_timestamp();
  if v_existing then
    if v_row.media_kind<>p_media_kind or v_row.content_type<>p_content_type or v_row.size_bytes<>p_size_bytes then
      raise exception 'STORY_REQUEST_CONFLICT' using errcode='22023'; end if;
    if v_row.status<>'pending' or v_row.upload_expires_at<=v_now then raise exception 'STORY_UPLOAD_UNAVAILABLE' using errcode='22023'; end if;
    return to_jsonb(v_row);
  end if;

  select count(*) into v_count from private.stories where owner_id=v_user and media_kind=p_media_kind and
    (published_at>v_now-interval '24 hours' or (published_at is null and status='pending' and upload_expires_at>v_now));
  if v_count>=(case when p_media_kind='video' then 2 else 4 end) then raise exception 'STORY_DAILY_LIMIT' using errcode='22023'; end if;
  insert into private.stories(id,owner_id,client_key,media_kind,content_type,size_bytes,object_key,created_at,upload_expires_at)
  values(v_id,v_user,p_client_key,p_media_kind,p_content_type,p_size_bytes,'stories/'||v_user::text||'/'||v_id::text||'.'||
    case p_content_type when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' else 'mp4' end,
    v_now,v_now+interval '1 hour') returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

create or replace function private.stories_publish_v1(p_id uuid,p_worker_key text,p_width integer,p_height integer,p_duration_ms bigint,p_stream_uid text,p_caption text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_user uuid:=private.story_current_user();
  v_story private.stories%rowtype;
  v_now timestamptz;
  v_count integer;
begin
  perform private.story_assert_worker(p_worker_key);
  -- Same account -> Story order as reserve, never Story -> account.
  perform 1 from public.social_profiles where id=v_user for update;
  if not found then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  select * into v_story from private.stories where id=p_id and owner_id=v_user for update;
  if not found then raise exception 'STORY_UNAVAILABLE' using errcode='42501'; end if;
  v_now:=clock_timestamp();
  if v_story.status='published' and v_story.expires_at>v_now then return private.story_project(p_id,v_user); end if;
  if v_story.status<>'pending' or v_story.upload_expires_at<=v_now then raise exception 'STORY_UPLOAD_UNAVAILABLE' using errcode='22023'; end if;
  if p_width is null or p_height is null or p_width not between 1 and 8192 or p_height not between 1 and 8192
    or p_caption is null or char_length(p_caption)>500
    or (v_story.media_kind='video' and (p_duration_ms is null or p_duration_ms not between 1 and 30000 or p_stream_uid is null or p_stream_uid !~ '^[a-f0-9]{32}$'))
    or (v_story.media_kind='image' and (p_duration_ms is not null or p_stream_uid is not null)) then raise exception 'INVALID_STORY_PUBLICATION' using errcode='22023'; end if;

  -- The current pending row already holds a slot. Recheck all OTHER effective
  -- reservations/publications after the locks, including deleted publications.
  select count(*) into v_count from private.stories where owner_id=v_user and media_kind=v_story.media_kind and id<>p_id and
    (published_at>v_now-interval '24 hours' or (published_at is null and status='pending' and upload_expires_at>v_now));
  if v_count>=(case when v_story.media_kind='video' then 2 else 4 end) then raise exception 'STORY_DAILY_LIMIT' using errcode='22023'; end if;
  update private.stories set status='published',width=p_width,height=p_height,duration_ms=p_duration_ms,stream_uid=p_stream_uid,
    caption=p_caption,published_at=v_now,expires_at=v_now+interval '24 hours' where id=p_id;
  return private.story_project(p_id,v_user);
end;
$$;

-- CREATE OR REPLACE preserves the original narrowly scoped execution ACLs.
commit;
