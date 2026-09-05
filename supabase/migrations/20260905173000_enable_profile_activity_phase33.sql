create table if not exists public.social_profile_activity_preferences (
  user_id uuid primary key references public.social_profiles(id) on delete cascade,
  likes_visibility text not null default 'private' check (likes_visibility in ('public', 'followers', 'private')),
  saves_visibility text not null default 'private' check (saves_visibility in ('public', 'followers', 'private')),
  hashtags_visibility text not null default 'private' check (hashtags_visibility in ('public', 'followers', 'private')),
  updated_at timestamptz not null default now()
);

alter table public.social_profile_activity_preferences enable row level security;
revoke all on public.social_profile_activity_preferences from anon;
grant select, insert, update on public.social_profile_activity_preferences to authenticated;

drop policy if exists social_profile_activity_preferences_select_own on public.social_profile_activity_preferences;
create policy social_profile_activity_preferences_select_own
on public.social_profile_activity_preferences
for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists social_profile_activity_preferences_insert_own on public.social_profile_activity_preferences;
create policy social_profile_activity_preferences_insert_own
on public.social_profile_activity_preferences
for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists social_profile_activity_preferences_update_own on public.social_profile_activity_preferences;
create policy social_profile_activity_preferences_update_own
on public.social_profile_activity_preferences
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create table if not exists public.social_profile_pins (
  user_id uuid not null references public.social_profiles(id) on delete cascade,
  post_id uuid not null references public.social_posts(id) on delete cascade,
  position smallint not null check (position between 1 and 3),
  created_at timestamptz not null default now(),
  primary key (user_id, post_id),
  unique (user_id, position)
);

alter table public.social_profile_pins enable row level security;
revoke all on public.social_profile_pins from anon;
grant select, insert, delete on public.social_profile_pins to authenticated;

drop policy if exists social_profile_pins_select_own on public.social_profile_pins;
create policy social_profile_pins_select_own
on public.social_profile_pins
for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists social_profile_pins_insert_own on public.social_profile_pins;
create policy social_profile_pins_insert_own
on public.social_profile_pins
for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists social_profile_pins_delete_own on public.social_profile_pins;
create policy social_profile_pins_delete_own
on public.social_profile_pins
for delete to authenticated
using ((select auth.uid()) = user_id);

create or replace function private.enforce_profile_pin_phase33()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_author uuid;
  v_circle uuid;
  v_status text;
  v_deleted timestamptz;
  v_count integer;
begin
  if auth.uid() is null or new.user_id <> auth.uid() then
    raise exception 'PROFILE_PIN_NOT_OWNER';
  end if;

  select p.author_id, p.circle_id, p.post_status, p.deleted_at
  into v_author, v_circle, v_status, v_deleted
  from public.social_posts p
  where p.id = new.post_id;

  if not found or v_author <> new.user_id or v_circle is not null or v_status <> 'published' or v_deleted is not null then
    raise exception 'PROFILE_PIN_INVALID';
  end if;

  select count(*) into v_count
  from public.social_profile_pins pin
  where pin.user_id = new.user_id
    and pin.post_id <> new.post_id;

  if v_count >= 3 then
    raise exception 'PROFILE_PIN_LIMIT';
  end if;

  return new;
end;
$$;

drop trigger if exists social_profile_pins_guard_phase33 on public.social_profile_pins;
create trigger social_profile_pins_guard_phase33
before insert or update on public.social_profile_pins
for each row execute function private.enforce_profile_pin_phase33();

create or replace function private.profile_activity_allowed_phase33(p_target uuid, p_kind text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_viewer uuid := auth.uid();
  v_visibility text;
begin
  if v_viewer is null or p_target is null then
    return false;
  end if;

  if v_viewer = p_target then
    return true;
  end if;

  if not exists (
    select 1 from public.social_profiles target
    where target.id = p_target and target.is_discoverable = true
  ) then
    return false;
  end if;

  if exists (
    select 1 from public.social_blocks block
    where (block.blocker_id = v_viewer and block.blocked_id = p_target)
       or (block.blocker_id = p_target and block.blocked_id = v_viewer)
  ) then
    return false;
  end if;

  select case
    when p_kind = 'likes' then pref.likes_visibility
    when p_kind = 'saves' then pref.saves_visibility
    when p_kind = 'hashtags' then pref.hashtags_visibility
    else 'private'
  end
  into v_visibility
  from public.social_profile_activity_preferences pref
  where pref.user_id = p_target;

  v_visibility := coalesce(v_visibility, 'private');

  if v_visibility = 'public' then
    return true;
  end if;

  if v_visibility = 'followers' then
    return exists (
      select 1 from public.social_follows follow
      where follow.follower_id = v_viewer
        and follow.followed_id = p_target
    );
  end if;

  return false;
end;
$$;

create or replace function private.profile_activity_candidate_ids_phase33(p_target uuid, p_kind text)
returns table(post_id uuid, activity_at timestamptz, pin_position smallint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_kind = 'likes' then
    if not private.profile_activity_allowed_phase33(p_target, 'likes') then return; end if;
    return query
      select reaction.post_id, reaction.created_at, null::smallint
      from public.social_post_reactions reaction
      where reaction.user_id = p_target
        and reaction.reaction_type = 'like';
  elsif p_kind = 'saves' then
    if not private.profile_activity_allowed_phase33(p_target, 'saves') then return; end if;
    return query
      select saved.post_id, saved.saved_at, null::smallint
      from public.social_saved_posts saved
      where saved.user_id = p_target;
  elsif p_kind = 'pins' then
    return query
      select pin.post_id, pin.created_at, pin.position
      from public.social_profile_pins pin
      where pin.user_id = p_target;
  end if;
end;
$$;

create or replace function public.profile_activity_state_phase33(p_username text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_viewer uuid := auth.uid();
  v_target record;
  v_owner boolean;
  v_likes text := 'private';
  v_saves text := 'private';
  v_hashtags text := 'private';
begin
  if v_viewer is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select p.id, p.username, p.display_name, p.is_verified, p.verification_badge_type
  into v_target
  from public.social_profiles p
  where p.username = lower(trim(p_username))
  limit 1;

  if not found then
    return jsonb_build_object('available', false);
  end if;

  v_owner := v_target.id = v_viewer;

  if v_owner then
    select pref.likes_visibility, pref.saves_visibility, pref.hashtags_visibility
    into v_likes, v_saves, v_hashtags
    from public.social_profile_activity_preferences pref
    where pref.user_id = v_target.id;

    v_likes := coalesce(v_likes, 'private');
    v_saves := coalesce(v_saves, 'private');
    v_hashtags := coalesce(v_hashtags, 'private');
  end if;

  return jsonb_build_object(
    'available', true,
    'profile', jsonb_build_object(
      'id', v_target.id,
      'username', v_target.username,
      'display_name', v_target.display_name,
      'is_verified', v_target.is_verified,
      'verification_badge_type', v_target.verification_badge_type
    ),
    'owner', v_owner,
    'viewer_follows', case when v_owner then false else exists (
      select 1 from public.social_follows f
      where f.follower_id = v_viewer and f.followed_id = v_target.id
    ) end,
    'tabs', jsonb_build_object(
      'posts', true,
      'replies', true,
      'likes', private.profile_activity_allowed_phase33(v_target.id, 'likes'),
      'saves', private.profile_activity_allowed_phase33(v_target.id, 'saves'),
      'hashtags', private.profile_activity_allowed_phase33(v_target.id, 'hashtags')
    ),
    'preferences', case when v_owner then jsonb_build_object(
      'likes', v_likes,
      'saves', v_saves,
      'hashtags', v_hashtags
    ) else null end,
    'pin_limit', 3
  );
end;
$$;

create or replace function public.profile_activity_feed_phase33(
  p_username text,
  p_tab text,
  p_limit integer default 40,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
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
$$;

create or replace function public.profile_hashtags_phase33(p_username text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_viewer uuid := auth.uid();
  v_target_id uuid;
  v_allowed boolean;
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

  v_allowed := private.profile_activity_allowed_phase33(v_target_id, 'hashtags');
  if not v_allowed then
    return jsonb_build_object('available', true, 'allowed', false, 'items', '[]'::jsonb);
  end if;

  with tag_rows as (
    select lower(m.tag_match[1]) as tag, p.created_at
    from public.social_posts p
    cross join lateral regexp_matches(p.body, '#([[:alnum:]_]{1,64})', 'g') as m(tag_match)
    where p.author_id = v_target_id
      and p.circle_id is null
      and p.reply_to_post_id is null
  ), aggregated as (
    select tag, count(*)::integer as usage_count, max(created_at) as last_used_at
    from tag_rows
    where tag is not null and tag <> ''
    group by tag
    order by usage_count desc, last_used_at desc, tag asc
    limit 50
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'tag', tag,
    'count', usage_count,
    'last_used_at', last_used_at
  ) order by usage_count desc, last_used_at desc, tag asc), '[]'::jsonb)
  into v_items
  from aggregated;

  return jsonb_build_object('available', true, 'allowed', true, 'items', coalesce(v_items, '[]'::jsonb));
end;
$$;

create or replace function public.update_profile_activity_preferences_phase33(
  p_likes_visibility text,
  p_saves_visibility text,
  p_hashtags_visibility text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_likes text := lower(trim(p_likes_visibility));
  v_saves text := lower(trim(p_saves_visibility));
  v_hashtags text := lower(trim(p_hashtags_visibility));
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if v_likes not in ('public', 'followers', 'private')
     or v_saves not in ('public', 'followers', 'private')
     or v_hashtags not in ('public', 'followers', 'private') then
    raise exception 'PROFILE_ACTIVITY_VISIBILITY_INVALID';
  end if;

  insert into public.social_profile_activity_preferences (
    user_id, likes_visibility, saves_visibility, hashtags_visibility, updated_at
  ) values (
    v_user, v_likes, v_saves, v_hashtags, now()
  )
  on conflict (user_id) do update set
    likes_visibility = excluded.likes_visibility,
    saves_visibility = excluded.saves_visibility,
    hashtags_visibility = excluded.hashtags_visibility,
    updated_at = now();

  return jsonb_build_object(
    'likes', v_likes,
    'saves', v_saves,
    'hashtags', v_hashtags
  );
end;
$$;

create or replace function public.set_profile_pin_phase33(p_post_id uuid, p_pinned boolean)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_position smallint;
  v_pins jsonb;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_post_id is null then
    raise exception 'PROFILE_PIN_INVALID';
  end if;

  if coalesce(p_pinned, false) then
    if not exists (
      select 1 from public.social_posts p
      where p.id = p_post_id
        and p.author_id = v_user
        and p.circle_id is null
        and p.post_status = 'published'
        and p.deleted_at is null
    ) then
      raise exception 'PROFILE_PIN_INVALID';
    end if;

    if not exists (
      select 1 from public.social_profile_pins pin
      where pin.user_id = v_user and pin.post_id = p_post_id
    ) then
      select slot::smallint into v_position
      from generate_series(1, 3) slot
      where not exists (
        select 1 from public.social_profile_pins existing
        where existing.user_id = v_user and existing.position = slot
      )
      order by slot
      limit 1;

      if v_position is null then
        raise exception 'PROFILE_PIN_LIMIT';
      end if;

      insert into public.social_profile_pins (user_id, post_id, position)
      values (v_user, p_post_id, v_position);
    end if;
  else
    delete from public.social_profile_pins pin
    where pin.user_id = v_user and pin.post_id = p_post_id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'post_id', pin.post_id,
    'position', pin.position,
    'created_at', pin.created_at
  ) order by pin.position), '[]'::jsonb)
  into v_pins
  from public.social_profile_pins pin
  where pin.user_id = v_user;

  return jsonb_build_object(
    'post_id', p_post_id,
    'pinned', exists (
      select 1 from public.social_profile_pins pin
      where pin.user_id = v_user and pin.post_id = p_post_id
    ),
    'pins', coalesce(v_pins, '[]'::jsonb)
  );
end;
$$;

revoke all on function private.profile_activity_allowed_phase33(uuid, text) from public, anon;
revoke all on function private.profile_activity_candidate_ids_phase33(uuid, text) from public, anon;
grant execute on function private.profile_activity_allowed_phase33(uuid, text) to authenticated;
grant execute on function private.profile_activity_candidate_ids_phase33(uuid, text) to authenticated;

revoke all on function public.profile_activity_state_phase33(text) from public, anon;
revoke all on function public.profile_activity_feed_phase33(text, text, integer, integer) from public, anon;
revoke all on function public.profile_hashtags_phase33(text) from public, anon;
revoke all on function public.update_profile_activity_preferences_phase33(text, text, text) from public, anon;
revoke all on function public.set_profile_pin_phase33(uuid, boolean) from public, anon;

grant execute on function public.profile_activity_state_phase33(text) to authenticated;
grant execute on function public.profile_activity_feed_phase33(text, text, integer, integer) to authenticated;
grant execute on function public.profile_hashtags_phase33(text) to authenticated;
grant execute on function public.update_profile_activity_preferences_phase33(text, text, text) to authenticated;
grant execute on function public.set_profile_pin_phase33(uuid, boolean) to authenticated;
