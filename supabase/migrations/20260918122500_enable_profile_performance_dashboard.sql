begin;

create table if not exists public.social_profile_views (
  profile_id uuid not null references public.social_profiles(id) on delete cascade,
  viewer_id uuid not null references public.social_profiles(id) on delete cascade,
  viewed_on date not null default current_date,
  viewed_at timestamptz not null default now(),
  primary key (profile_id, viewer_id, viewed_on)
);

create index if not exists social_profile_views_profile_date_idx
  on public.social_profile_views (profile_id, viewed_on desc);

alter table public.social_profile_views enable row level security;
alter table public.social_profile_views force row level security;

revoke all on table public.social_profile_views from public, anon, authenticated;
grant insert on table public.social_profile_views to authenticated;
grant select, insert, update, delete on table public.social_profile_views to service_role;

drop policy if exists social_profile_views_insert_meaningful on public.social_profile_views;
create policy social_profile_views_insert_meaningful
  on public.social_profile_views for insert to authenticated
  with check (
    viewer_id = (select auth.uid())
    and profile_id <> (select auth.uid())
    and viewed_on = current_date
    and exists (
      select 1
      from public.social_profiles target
      where target.id = profile_id
        and target.is_discoverable = true
    )
  );

create table if not exists public.social_creator_daily_metrics (
  user_id uuid not null references public.social_profiles(id) on delete cascade,
  metric_date date not null,
  profile_views bigint not null default 0,
  content_views bigint not null default 0,
  engagements bigint not null default 0,
  follows_gained bigint not null default 0,
  follows_lost bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, metric_date),
  constraint social_creator_daily_metrics_profile_views_nonnegative check (profile_views >= 0),
  constraint social_creator_daily_metrics_content_views_nonnegative check (content_views >= 0),
  constraint social_creator_daily_metrics_engagements_nonnegative check (engagements >= 0),
  constraint social_creator_daily_metrics_follows_gained_nonnegative check (follows_gained >= 0),
  constraint social_creator_daily_metrics_follows_lost_nonnegative check (follows_lost >= 0)
);

alter table public.social_creator_daily_metrics enable row level security;
alter table public.social_creator_daily_metrics force row level security;

revoke all on table public.social_creator_daily_metrics from public, anon, authenticated;
grant select on table public.social_creator_daily_metrics to authenticated;
grant select, insert, update, delete on table public.social_creator_daily_metrics to service_role;

drop policy if exists social_creator_daily_metrics_select_owner on public.social_creator_daily_metrics;
create policy social_creator_daily_metrics_select_owner
  on public.social_creator_daily_metrics for select to authenticated
  using (user_id = (select auth.uid()));

create or replace function private.bump_social_creator_metric(
  target_user_id uuid,
  target_date date,
  target_metric text,
  delta bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $metric$
begin
  if target_user_id is null or target_date is null or delta = 0 then
    return;
  end if;

  insert into public.social_creator_daily_metrics (user_id, metric_date)
  values (target_user_id, target_date)
  on conflict (user_id, metric_date) do nothing;

  update public.social_creator_daily_metrics
  set profile_views = greatest(0, profile_views + case when target_metric = 'profile_views' then delta else 0 end),
      content_views = greatest(0, content_views + case when target_metric = 'content_views' then delta else 0 end),
      engagements = greatest(0, engagements + case when target_metric = 'engagements' then delta else 0 end),
      follows_gained = greatest(0, follows_gained + case when target_metric = 'follows_gained' then delta else 0 end),
      follows_lost = greatest(0, follows_lost + case when target_metric = 'follows_lost' then delta else 0 end),
      updated_at = now()
  where user_id = target_user_id
    and metric_date = target_date;
end;
$metric$;

revoke all on function private.bump_social_creator_metric(uuid, date, text, bigint) from public, anon, authenticated;

create or replace function private.track_social_profile_view_metric()
returns trigger
language plpgsql
security definer
set search_path = ''
as $profile_metric$
begin
  perform private.bump_social_creator_metric(new.profile_id, new.viewed_on, 'profile_views', 1);
  return new;
end;
$profile_metric$;

revoke all on function private.track_social_profile_view_metric() from public, anon, authenticated;

drop trigger if exists track_social_profile_view_metric on public.social_profile_views;
create trigger track_social_profile_view_metric
after insert on public.social_profile_views
for each row execute function private.track_social_profile_view_metric();

create or replace function private.track_social_post_view_daily_metric()
returns trigger
language plpgsql
security definer
set search_path = ''
as $post_metric$
declare
  owner_id uuid;
begin
  select post.author_id into owner_id
  from public.social_posts post
  where post.id = new.post_id;

  if owner_id is not null and owner_id <> new.viewer_id then
    perform private.bump_social_creator_metric(owner_id, new.viewed_at::date, 'content_views', 1);
  end if;
  return new;
end;
$post_metric$;

revoke all on function private.track_social_post_view_daily_metric() from public, anon, authenticated;

drop trigger if exists track_social_post_view_daily_metric on public.social_post_views;
create trigger track_social_post_view_daily_metric
after insert on public.social_post_views
for each row execute function private.track_social_post_view_daily_metric();

create or replace function private.track_social_reaction_daily_metric()
returns trigger
language plpgsql
security definer
set search_path = ''
as $reaction_metric$
declare
  row_data public.social_post_reactions%rowtype;
  owner_id uuid;
  direction bigint;
begin
  row_data := case when tg_op = 'DELETE' then old else new end;
  direction := case when tg_op = 'DELETE' then -1 else 1 end;

  select post.author_id into owner_id
  from public.social_posts post
  where post.id = row_data.post_id;

  if owner_id is not null and owner_id <> row_data.user_id then
    perform private.bump_social_creator_metric(owner_id, row_data.created_at::date, 'engagements', direction);
  end if;
  return coalesce(new, old);
end;
$reaction_metric$;

revoke all on function private.track_social_reaction_daily_metric() from public, anon, authenticated;

drop trigger if exists track_social_reaction_daily_metric on public.social_post_reactions;
create trigger track_social_reaction_daily_metric
after insert or delete on public.social_post_reactions
for each row execute function private.track_social_reaction_daily_metric();

create or replace function private.track_social_repost_daily_metric()
returns trigger
language plpgsql
security definer
set search_path = ''
as $repost_metric$
declare
  row_data public.social_reposts%rowtype;
  owner_id uuid;
  direction bigint;
begin
  row_data := case when tg_op = 'DELETE' then old else new end;
  direction := case when tg_op = 'DELETE' then -1 else 1 end;

  select post.author_id into owner_id
  from public.social_posts post
  where post.id = row_data.post_id;

  if owner_id is not null and owner_id <> row_data.user_id then
    perform private.bump_social_creator_metric(owner_id, row_data.created_at::date, 'engagements', direction);
  end if;
  return coalesce(new, old);
end;
$repost_metric$;

revoke all on function private.track_social_repost_daily_metric() from public, anon, authenticated;

drop trigger if exists track_social_repost_daily_metric on public.social_reposts;
create trigger track_social_repost_daily_metric
after insert or delete on public.social_reposts
for each row execute function private.track_social_repost_daily_metric();

create or replace function private.track_social_reply_daily_metric()
returns trigger
language plpgsql
security definer
set search_path = ''
as $reply_metric$
declare
  owner_id uuid;
  was_visible boolean := false;
  is_visible boolean := false;
begin
  if tg_op = 'INSERT' then
    if new.parent_post_id is null then return new; end if;
    owner_id := new.audience_owner_id;
    is_visible := new.deleted_at is null and new.post_status = 'published' and new.moderation_state <> 'removed';
    if owner_id is not null and owner_id <> new.author_id and is_visible then
      perform private.bump_social_creator_metric(owner_id, new.created_at::date, 'engagements', 1);
    end if;
    return new;
  end if;

  if new.parent_post_id is null then return new; end if;
  owner_id := new.audience_owner_id;
  was_visible := old.deleted_at is null and old.post_status = 'published' and old.moderation_state <> 'removed';
  is_visible := new.deleted_at is null and new.post_status = 'published' and new.moderation_state <> 'removed';

  if owner_id is not null and owner_id <> new.author_id and was_visible <> is_visible then
    perform private.bump_social_creator_metric(owner_id, new.created_at::date, 'engagements', case when is_visible then 1 else -1 end);
  end if;
  return new;
end;
$reply_metric$;

revoke all on function private.track_social_reply_daily_metric() from public, anon, authenticated;

drop trigger if exists track_social_reply_daily_metric on public.social_posts;
create trigger track_social_reply_daily_metric
after insert or update of deleted_at, post_status, moderation_state on public.social_posts
for each row execute function private.track_social_reply_daily_metric();

create or replace function private.track_social_follow_daily_metric()
returns trigger
language plpgsql
security definer
set search_path = ''
as $follow_metric$
begin
  if tg_op = 'INSERT' then
    if new.followed_id <> new.follower_id then
      perform private.bump_social_creator_metric(new.followed_id, new.created_at::date, 'follows_gained', 1);
    end if;
    return new;
  end if;

  if old.followed_id <> old.follower_id then
    perform private.bump_social_creator_metric(old.followed_id, current_date, 'follows_lost', 1);
  end if;
  return old;
end;
$follow_metric$;

revoke all on function private.track_social_follow_daily_metric() from public, anon, authenticated;

drop trigger if exists track_social_follow_daily_metric on public.social_follows;
create trigger track_social_follow_daily_metric
after insert or delete on public.social_follows
for each row execute function private.track_social_follow_daily_metric();

create or replace function public.record_social_profile_view(target_username text)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $record_profile_view$
declare
  target_id uuid;
  inserted_rows integer := 0;
begin
  if (select auth.uid()) is null then return false; end if;

  select profile.id into target_id
  from public.social_profiles profile
  where profile.username = lower(btrim(target_username))
    and profile.is_discoverable = true
  limit 1;

  if target_id is null or target_id = (select auth.uid()) then return false; end if;

  insert into public.social_profile_views (profile_id, viewer_id, viewed_on)
  values (target_id, (select auth.uid()), current_date)
  on conflict (profile_id, viewer_id, viewed_on) do nothing;

  get diagnostics inserted_rows = row_count;
  return inserted_rows > 0;
end;
$record_profile_view$;

revoke all on function public.record_social_profile_view(text) from public, anon;
grant execute on function public.record_social_profile_view(text) to authenticated, service_role;

insert into public.social_creator_daily_metrics (user_id, metric_date, content_views)
select post.author_id, view.viewed_at::date, count(*)::bigint
from public.social_post_views view
join public.social_posts post on post.id = view.post_id
where post.author_id <> view.viewer_id
group by post.author_id, view.viewed_at::date
on conflict (user_id, metric_date) do update
set content_views = excluded.content_views,
    updated_at = now();

with engagement_rows as (
  select post.author_id as user_id, reaction.created_at::date as metric_date
  from public.social_post_reactions reaction
  join public.social_posts post on post.id = reaction.post_id
  where post.author_id <> reaction.user_id
  union all
  select post.author_id, repost.created_at::date
  from public.social_reposts repost
  join public.social_posts post on post.id = repost.post_id
  where post.author_id <> repost.user_id
  union all
  select reply.audience_owner_id, reply.created_at::date
  from public.social_posts reply
  where reply.parent_post_id is not null
    and reply.audience_owner_id is not null
    and reply.audience_owner_id <> reply.author_id
    and reply.deleted_at is null
    and reply.post_status = 'published'
    and reply.moderation_state <> 'removed'
), totals as (
  select user_id, metric_date, count(*)::bigint as engagements
  from engagement_rows
  group by user_id, metric_date
)
insert into public.social_creator_daily_metrics (user_id, metric_date, engagements)
select user_id, metric_date, engagements from totals
on conflict (user_id, metric_date) do update
set engagements = excluded.engagements,
    updated_at = now();

insert into public.social_creator_daily_metrics (user_id, metric_date, follows_gained)
select followed_id, created_at::date, count(*)::bigint
from public.social_follows
group by followed_id, created_at::date
on conflict (user_id, metric_date) do update
set follows_gained = excluded.follows_gained,
    updated_at = now();

do $realtime$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'social_creator_daily_metrics'
  ) then
    alter publication supabase_realtime add table public.social_creator_daily_metrics;
  end if;
end;
$realtime$;

comment on table public.social_profile_views is
  'Privacy-preserving daily unique authenticated profile views; viewer identities are never exposed to profile owners.';
comment on table public.social_creator_daily_metrics is
  'Owner-only daily creator analytics used by the real-time SautiLink profile performance dashboard.';
comment on function public.record_social_profile_view(text) is
  'Records at most one authenticated non-owner profile view per viewer, profile and day.';

commit;
