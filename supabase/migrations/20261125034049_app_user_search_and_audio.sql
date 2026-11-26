-- Additive app integration. Existing post and profile policies still apply.
create extension if not exists pg_trgm with schema extensions;

create index if not exists social_profiles_username_compact_trgm
on public.social_profiles using gin
  (regexp_replace(lower(username), '[^[:alnum:]]', '', 'g') extensions.gin_trgm_ops);
create index if not exists social_profiles_name_compact_trgm
on public.social_profiles using gin
  (regexp_replace(lower(display_name), '[^[:alnum:]]', '', 'g') extensions.gin_trgm_ops);

create or replace function public.social_user_suggestions(query_text text, max_results integer default 20)
returns table(id uuid, username text, display_name text, bio text, followers_count integer,
  is_verified boolean, verification_badge_type text, avatar_key text, match_score real)
language sql stable security invoker
set search_path = public, extensions, pg_temp
as $$
  with input as (
    select regexp_replace(lower(left(trim(query_text), 80)), '[^[:alnum:]]', '', 'g') as q
  ), candidates as (
    select p.*, regexp_replace(lower(p.username), '[^[:alnum:]]', '', 'g') as handle,
      regexp_replace(lower(p.display_name), '[^[:alnum:]]', '', 'g') as name
    from public.social_profiles p
    where (select auth.uid()) is not null and p.is_discoverable and p.id <> (select auth.uid())
      and not exists (select 1 from public.social_blocks b
        where (b.blocker_id = (select auth.uid()) and b.blocked_id = p.id)
           or (b.blocked_id = (select auth.uid()) and b.blocker_id = p.id))
  ), ranked as (
    select p.*, greatest(
      case when p.handle = i.q then 5.0 when p.handle like i.q || '%' then 4.0
        when position(i.q in p.handle) > 0 then 3.0 else 0.0 end,
      case when p.name = i.q then 4.5 when p.name like i.q || '%' then 3.5
        when position(i.q in p.name) > 0 then 2.5 else 0.0 end,
      extensions.similarity(p.handle, i.q), extensions.similarity(p.name, i.q))::real as score
    from candidates p cross join input i
    where char_length(i.q) >= 2 and
      (p.handle like '%' || i.q || '%' or p.name like '%' || i.q || '%'
       or (char_length(i.q) >= 3 and
         (p.handle operator(extensions.%) i.q or p.name operator(extensions.%) i.q)))
  )
  select r.id, r.username, r.display_name, r.bio, r.followers_count,
    r.is_verified, r.verification_badge_type, r.avatar_key, r.score
  from ranked r order by r.score desc, r.followers_count desc, r.username, r.id
  limit greatest(1, least(coalesce(max_results, 20), 50));
$$;
revoke all on function public.social_user_suggestions(text, integer) from public, anon;
grant execute on function public.social_user_suggestions(text, integer) to authenticated;

alter table public.social_posts add column if not exists audio_selection jsonb;
grant insert (audio_selection) on public.social_posts to authenticated;
alter table public.social_posts add constraint social_posts_audio_selection_valid check (
  audio_selection is null or (
    jsonb_typeof(audio_selection) = 'object'
    and audio_selection ?& array['trackId','title','artist','startMs','durationMs']
    and (audio_selection->>'trackId') ~ '^[a-z0-9-]{1,80}$'
    and char_length(audio_selection->>'title') between 1 and 120
    and char_length(audio_selection->>'artist') between 1 and 100
    and jsonb_typeof(audio_selection->'startMs') = 'number'
    and jsonb_typeof(audio_selection->'durationMs') = 'number'
    and (audio_selection->>'startMs')::numeric >= 0
    and (audio_selection->>'durationMs')::numeric between 1000 and 180000
  )
);
create index if not exists social_posts_audio_track on public.social_posts
  ((audio_selection->>'trackId')) where audio_selection is not null;

alter table public.social_posts drop constraint social_posts_body_length;
alter table public.social_posts add constraint social_posts_body_length check (
  char_length(btrim(body)) <= 2000 and (char_length(btrim(body)) >= 1
    or quote_post_id is not null or media_count > 0 or audio_selection is not null)
);

create table if not exists public.social_saved_audio (
  owner_id uuid not null references public.social_profiles(id) on delete cascade,
  track_id text not null check (track_id ~ '^[a-z0-9-]{1,80}$'),
  saved_at timestamptz not null default now(),
  primary key(owner_id, track_id)
);
alter table public.social_saved_audio enable row level security;
create policy saved_audio_select_own on public.social_saved_audio for select to authenticated
  using(owner_id = (select auth.uid()));
create policy saved_audio_insert_own on public.social_saved_audio for insert to authenticated
  with check(owner_id = (select auth.uid()));
create policy saved_audio_delete_own on public.social_saved_audio for delete to authenticated
  using(owner_id = (select auth.uid()));
revoke all on public.social_saved_audio from anon, authenticated;
grant select, insert, delete on public.social_saved_audio to authenticated;

create or replace function public.social_audio_usage(track_ids text[])
returns table(track_id text, uses bigint)
language sql stable security invoker set search_path = public, pg_temp
as $$
  select audio_selection->>'trackId', count(*)
  from public.social_posts
  where audio_selection is not null and visibility = 'public' and circle_id is null
    and parent_post_id is null and post_status = 'published'
    and audio_selection->>'trackId' = any(track_ids[1:50])
  group by audio_selection->>'trackId';
$$;
revoke all on function public.social_audio_usage(text[]) from public;
grant execute on function public.social_audio_usage(text[]) to anon, authenticated;
notify pgrst, 'reload schema';
