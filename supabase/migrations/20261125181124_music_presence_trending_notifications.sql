-- Keep profile RPC privacy/security unchanged while carrying the approved audio selection.
CREATE OR REPLACE FUNCTION public.profile_activity_feed_phase33(p_username text, p_tab text, p_limit integer DEFAULT 40, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_viewer uuid := auth.uid();
  v_target_id uuid;
  v_tab text := lower(trim(p_tab));
  v_limit integer := greatest(1, least(coalesce(p_limit, 40), 50));
  v_offset integer := greatest(0, least(coalesce(p_offset, 0), 500));
  v_allowed boolean := true;
  v_items jsonb := '[]'::jsonb;
begin
  if v_viewer is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if v_tab not in ('posts', 'replies', 'likes', 'saves', 'pins') then
    raise exception 'PROFILE_ACTIVITY_TAB_INVALID';
  end if;

  select p.id into v_target_id
  from public.social_profiles p
  where p.username = lower(trim(p_username))
  limit 1;

  if v_target_id is null then
    return jsonb_build_object('available', false, 'allowed', false, 'items', '[]'::jsonb);
  end if;

  if v_tab in ('likes', 'saves') then
    v_allowed := private.profile_activity_allowed_phase33(v_target_id, v_tab);
  end if;

  if not v_allowed then
    return jsonb_build_object('available', true, 'allowed', false, 'items', '[]'::jsonb);
  end if;

  with candidates as (
    select p.id as post_id, p.created_at as activity_at, null::smallint as pin_position
    from public.social_posts p
    where v_tab = 'posts'
      and p.author_id = v_target_id
      and p.circle_id is null
      and p.reply_to_post_id is null

    union all

    select p.id as post_id, p.created_at as activity_at, null::smallint as pin_position
    from public.social_posts p
    where v_tab = 'replies'
      and p.author_id = v_target_id
      and p.circle_id is null
      and p.reply_to_post_id is not null

    union all

    select c.post_id, c.activity_at, c.pin_position
    from private.profile_activity_candidate_ids_phase33(v_target_id, v_tab) c
    where v_tab in ('likes', 'saves', 'pins')
  ),
  rows_for_page as (
    select
      p.*,
      c.activity_at,
      c.pin_position,
      a.username as author_username,
      a.display_name as author_display_name,
      a.avatar_key as author_avatar_key,
      a.updated_at as author_updated_at,
      a.is_verified as author_is_verified,
      a.verification_badge_type as author_verification_badge_type
    from candidates c
    join public.social_posts p on p.id = c.post_id
    join public.social_profiles a on a.id = p.author_id
    where p.circle_id is null
    order by
      case when v_tab = 'pins' then c.pin_position end asc nulls last,
      c.activity_at desc,
      p.created_at desc
    limit v_limit offset v_offset
  ),
  payload as (
    select
      jsonb_build_object(
        'id', row.id,
        'author_id', row.author_id,
        'body', row.body,
        'audio_selection', row.audio_selection,
        'visibility', row.visibility,
        'created_at', row.created_at,
        'activity_at', row.activity_at,
        'like_count', row.like_count,
        'comment_count', row.comment_count,
        'repost_count', row.repost_count,
        'reply_to_post_id', row.reply_to_post_id,
        'parent_post_id', row.parent_post_id,
        'root_post_id', row.root_post_id,
        'thread_depth', row.thread_depth,
        'quote_post_id', row.quote_post_id,
        'media_count', row.media_count,
        'pin_position', row.pin_position,
        'is_pinned', exists (
          select 1 from private.profile_activity_candidate_ids_phase33(v_target_id, 'pins') pin
          where pin.post_id = row.id
        ),
        'viewer_liked', exists (
          select 1 from public.social_post_reactions reaction
          where reaction.post_id = row.id
            and reaction.user_id = v_viewer
            and reaction.reaction_type = 'like'
        ),
        'viewer_reposted', exists (
          select 1 from public.social_reposts repost
          where repost.post_id = row.id and repost.user_id = v_viewer
        ),
        'viewer_saved', exists (
          select 1 from public.social_saved_posts saved
          where saved.post_id = row.id and saved.user_id = v_viewer
        ),
        'author', jsonb_build_object(
          'username', row.author_username,
          'display_name', row.author_display_name,
          'avatar_key', row.author_avatar_key,
          'updated_at', row.author_updated_at,
          'is_verified', row.author_is_verified,
          'verification_badge_type', row.author_verification_badge_type
        ),
        'replying_to', case when row.parent_post_id is null then null else (
          select jsonb_build_object(
            'post_id', parent.id,
            'username', parent_author.username,
            'display_name', parent_author.display_name
          )
          from public.social_posts parent
          join public.social_profiles parent_author on parent_author.id = parent.author_id
          where parent.id = row.parent_post_id
          limit 1
        ) end,
        'media', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', media.id,
            'kind', media.media_kind,
            'content_type', media.content_type,
            'width', media.width,
            'height', media.height,
            'duration_ms', media.duration_ms,
            'alt_text', media.alt_text,
            'position', media.position
          ) order by media.position)
          from public.social_post_media media
          where media.post_id = row.id
            and media.upload_status = 'attached'
        ), '[]'::jsonb)
      ) as item,
      row.pin_position as sort_pin,
      row.activity_at as sort_time
    from rows_for_page row
  )
  select coalesce(
    jsonb_agg(payload.item order by payload.sort_pin asc nulls last, payload.sort_time desc),
    '[]'::jsonb
  )
  into v_items
  from payload;

  return jsonb_build_object(
    'available', true,
    'allowed', true,
    'items', coalesce(v_items, '[]'::jsonb),
    'limit', v_limit,
    'offset', v_offset
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.profile_reposts_feed_phase35(p_username text, p_limit integer DEFAULT 40, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_viewer uuid := auth.uid();
  v_target_id uuid;
  v_limit integer := greatest(1, least(coalesce(p_limit, 40), 50));
  v_offset integer := greatest(0, least(coalesce(p_offset, 0), 500));
  v_items jsonb := '[]'::jsonb;
begin
  if v_viewer is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select p.id into v_target_id
  from public.social_profiles p
  where p.username = lower(trim(p_username))
  limit 1;

  if v_target_id is null then
    return jsonb_build_object('available', false, 'allowed', false, 'items', '[]'::jsonb);
  end if;

  with rows_for_page as (
    select
      p.*,
      repost.created_at as activity_at,
      a.username as author_username,
      a.display_name as author_display_name,
      a.avatar_key as author_avatar_key,
      a.updated_at as author_updated_at,
      a.is_verified as author_is_verified,
      a.verification_badge_type as author_verification_badge_type
    from public.social_reposts repost
    join public.social_posts p on p.id = repost.post_id
    join public.social_profiles a on a.id = p.author_id
    where repost.user_id = v_target_id
      and p.circle_id is null
    order by repost.created_at desc, p.created_at desc
    limit v_limit offset v_offset
  ),
  payload as (
    select
      jsonb_build_object(
        'id', row.id,
        'author_id', row.author_id,
        'body', row.body,
        'audio_selection', row.audio_selection,
        'visibility', row.visibility,
        'created_at', row.created_at,
        'activity_at', row.activity_at,
        'like_count', row.like_count,
        'comment_count', row.comment_count,
        'repost_count', row.repost_count,
        'reply_to_post_id', row.reply_to_post_id,
        'parent_post_id', row.parent_post_id,
        'root_post_id', row.root_post_id,
        'thread_depth', row.thread_depth,
        'quote_post_id', row.quote_post_id,
        'media_count', row.media_count,
        'pin_position', null,
        'is_pinned', false,
        'viewer_liked', exists (
          select 1 from public.social_post_reactions reaction
          where reaction.post_id = row.id
            and reaction.user_id = v_viewer
            and reaction.reaction_type = 'like'
        ),
        'viewer_reposted', exists (
          select 1 from public.social_reposts viewer_repost
          where viewer_repost.post_id = row.id
            and viewer_repost.user_id = v_viewer
        ),
        'viewer_saved', exists (
          select 1 from public.social_saved_posts saved
          where saved.post_id = row.id
            and saved.user_id = v_viewer
        ),
        'author', jsonb_build_object(
          'username', row.author_username,
          'display_name', row.author_display_name,
          'avatar_key', row.author_avatar_key,
          'updated_at', row.author_updated_at,
          'is_verified', row.author_is_verified,
          'verification_badge_type', row.author_verification_badge_type
        ),
        'replying_to', case when row.parent_post_id is null then null else (
          select jsonb_build_object(
            'post_id', parent.id,
            'username', parent_author.username,
            'display_name', parent_author.display_name
          )
          from public.social_posts parent
          join public.social_profiles parent_author on parent_author.id = parent.author_id
          where parent.id = row.parent_post_id
          limit 1
        ) end,
        'media', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', media.id,
            'kind', media.media_kind,
            'content_type', media.content_type,
            'width', media.width,
            'height', media.height,
            'duration_ms', media.duration_ms,
            'alt_text', media.alt_text,
            'position', media.position
          ) order by media.position)
          from public.social_post_media media
          where media.post_id = row.id
            and media.upload_status = 'attached'
        ), '[]'::jsonb)
      ) as item,
      row.activity_at as sort_time
    from rows_for_page row
  )
  select coalesce(
    jsonb_agg(payload.item order by payload.sort_time desc),
    '[]'::jsonb
  )
  into v_items
  from payload;

  return jsonb_build_object(
    'available', true,
    'allowed', true,
    'items', coalesce(v_items, '[]'::jsonb),
    'limit', v_limit,
    'offset', v_offset
  );
end;
$function$
;

-- Precise activity is returned only after the existing reciprocal privacy and conversation gate.
create or replace function public.dm_peer_activity_native_v2(p_peer_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_bucket text; v_last timestamptz;
begin
  v_bucket := public.dm_peer_activity_bucket_native_phase38(p_peer_id);
  if v_bucket = 'hidden' then return jsonb_build_object('visibility','hidden'); end if;
  select last_active_at into v_last from private.member_activity_phase37 where user_id=p_peer_id;
  return jsonb_build_object('visibility','visible','last_seen_at',v_last);
end; $$;
revoke all on function public.dm_peer_activity_native_v2(uuid) from public, anon;
grant execute on function public.dm_peer_activity_native_v2(uuid) to authenticated;

alter table public.social_notifications add column if not exists event_data jsonb;
grant select(event_data) on public.social_notifications to authenticated;
create policy social_notifications_trending_preference on public.social_notifications as restrictive
for select to authenticated using (notification_type <> 'trending' or coalesce((select pref.notify_post_activity
 from public.social_member_preferences pref where pref.user_id=(select auth.uid())),true));
alter table public.social_posts add constraint social_posts_audio_mix_levels check (audio_selection is null or (
 (not (audio_selection ? 'musicVolume') or case when jsonb_typeof(audio_selection->'musicVolume')='number'
   then (audio_selection->>'musicVolume')::numeric between 0 and 1 else false end) and
 (not (audio_selection ? 'originalVolume') or case when jsonb_typeof(audio_selection->'originalVolume')='number'
   then (audio_selection->>'originalVolume')::numeric between 0 and 1 else false end)));
alter table public.social_notifications drop constraint social_notifications_type_allowed;
alter table public.social_notifications add constraint social_notifications_type_allowed check (
 notification_type in ('follow','reply','mention','like','reshare','circle','message','safety','verification','story_like','story_dislike','trending'));
alter table public.social_notifications add constraint social_notifications_event_data_object check (
 event_data is null or (jsonb_typeof(event_data)='object' and pg_column_size(event_data)<=8192));

-- Server-owned ledger: one achievement per post, even when it leaves and re-enters the chart.
create table private.trending_post_achievements (
 post_id uuid primary key references public.social_posts(id) on delete cascade,
 author_id uuid not null references public.social_profiles(id) on delete cascade,
 chart_rank integer not null check(chart_rank between 1 and 20),
 achieved_at timestamptz not null default now()
);
alter table private.trending_post_achievements enable row level security;
revoke all on private.trending_post_achievements from public,anon,authenticated;

create or replace function private.notify_trending_achievements_v1()
returns integer language plpgsql security definer set search_path='' as $$
declare v_count integer;
begin
 -- Serialize retries/concurrent cron workers before taking the chart snapshot.
 if not pg_try_advisory_xact_lock(20261125,5401) then return 0; end if;
 with chart as materialized (
  select p.id,p.author_id,row_number() over (
    order by greatest(p.like_count,0)::bigint + 2::bigint*greatest(p.comment_count,0) + greatest(p.repost_count,0) desc,
    p.created_at desc,p.id desc)::integer as rank
  from public.social_posts p join public.social_profiles a on a.id=p.author_id
  where p.visibility='public' and p.circle_id is null and p.reply_to_post_id is null
    and p.parent_post_id is null and p.post_status='published' and p.deleted_at is null
    and p.moderation_state='visible' and a.is_discoverable=true
    and p.created_at>=now()-interval '7 days'
 ), fresh as (
  insert into private.trending_post_achievements(post_id,author_id,chart_rank)
  select id,author_id,rank from chart where rank<=20
  on conflict(post_id) do nothing returning *
 ), grouped as (
  select author_id,count(*)::integer as post_count,min(chart_rank) as best_rank,
    jsonb_agg(post_id order by chart_rank) as post_ids,
    (array_agg(post_id order by chart_rank))[1] as lead_post
  from fresh group by author_id
 ), notices as (
  insert into public.social_notifications(recipient_id,actor_id,post_id,notification_type,notification_event,event_data)
  select g.author_id,null,g.lead_post,'trending','trending_chart_entry',
    jsonb_build_object('post_count',g.post_count,'best_rank',g.best_rank,'post_ids',g.post_ids,'chart','Trending')
  from grouped g
  where coalesce((select pref.notify_post_activity from public.social_member_preferences pref where pref.user_id=g.author_id),true)
  returning id
 ) select count(*) into v_count from notices;
 return v_count;
end; $$;
revoke all on function private.notify_trending_achievements_v1() from public,anon,authenticated;
CREATE OR REPLACE FUNCTION private.enqueue_push_delivery_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  target_recipient uuid;
  target_source_type text;
  target_source_id text;
  queued_id uuid;
  queued_dispatch_key uuid;
begin
  if tg_table_name = 'social_notifications' then
    if new.notification_type not in ('follow', 'like', 'reply', 'mention', 'reshare', 'safety', 'verification', 'trending') then
      return new;
    end if;

    target_recipient := new.recipient_id;
    target_source_type := 'social_notification';
    target_source_id := new.id::text;
  elsif tg_table_name = 'dm_messages' then
    select case
      when conversation.member_one_id = new.sender_id then conversation.member_two_id
      else conversation.member_one_id
    end
      into target_recipient
    from public.dm_conversations conversation
    where conversation.id = new.conversation_id
      and new.sender_id in (conversation.member_one_id, conversation.member_two_id);

    if target_recipient is null or target_recipient = new.sender_id then
      return new;
    end if;

    target_source_type := 'dm_message';
    target_source_id := new.id::text;
  else
    return new;
  end if;

  if target_recipient is null then
    return new;
  end if;

  insert into public.push_delivery_queue (
    recipient_id,
    source_type,
    source_id,
    status,
    attempt_count,
    next_attempt_at
  ) values (
    target_recipient,
    target_source_type,
    target_source_id,
    'pending',
    0,
    now()
  )
  on conflict (source_type, source_id, recipient_id) do nothing
  returning id, dispatch_key into queued_id, queued_dispatch_key;

  if queued_id is not null then
    perform private.dispatch_push_delivery_v1(queued_id, queued_dispatch_key);
  end if;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.suppress_phase30_disabled_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  prefs public.social_member_preferences%rowtype;
begin
  select *
    into prefs
  from public.social_member_preferences preference
  where preference.user_id = new.recipient_id;

  if not found then
    return new;
  end if;

  if new.notification_type = 'follow' and not prefs.notify_followers then
    return null;
  end if;

  if new.notification_type in ('reply', 'like', 'reshare', 'trending') and not prefs.notify_post_activity then
    return null;
  end if;

  if new.notification_type = 'circle' and not prefs.notify_sautify then
    return null;
  end if;

  return new;
end;
$function$
;

notify pgrst,'reload schema';
